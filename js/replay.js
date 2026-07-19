// replay.js - record/playback game events, localStorage persistence
const MAX_EVENTS = 5000
const STORAGE_KEY = 'dodgball_replays_v1'
const SNAPSHOT_INTERVAL = 250

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const round = value => Math.round(finite(value) * 100) / 100
const point = value => value ? { x: round(value.x), y: round(value.y), z: round(value.z) } : null

function playerSnapshot(value, fallbackId = '') {
    if (!value) return null
    const position = point(value.position || value)
    if (!position) return null
    const id = String(value.id ?? value.name ?? fallbackId).slice(0, 32)
    const result = {
        id,
        name: String(value.name ?? id).slice(0, 32),
        team: value.team === 'blue' ? 'blue' : 'red',
        alive: value.alive !== false,
        ...position
    }
    const yaw = finite(value.yaw ?? value.rotation?.y, NaN)
    const pitch = finite(value.pitch ?? value.rotation?.x, NaN)
    if (Number.isFinite(yaw)) result.yaw = round(yaw)
    if (Number.isFinite(pitch)) result.pitch = round(pitch)
    return result
}

export function normalizeReplaySnapshot(snapshot = {}) {
    const local = playerSnapshot(snapshot.player, 'player')
    const hasCanonicalPlayers = Array.isArray(snapshot.players)
    const source = hasCanonicalPlayers
        ? snapshot.players
        : (Array.isArray(snapshot.actors) ? snapshot.actors : [])
    const hasLocalIdentity = snapshot.player && (
        snapshot.player.id != null ||
        snapshot.player.name != null ||
        snapshot.player.team != null ||
        snapshot.player.position != null
    )
    const players = []
    const seen = new Set()
    const candidates = [
        ...(local && (!hasCanonicalPlayers || hasLocalIdentity) ? [local] : []),
        ...source.map((value, index) => playerSnapshot(value, `player-${index}`))
    ]
    for (const candidate of candidates) {
        if (!candidate) continue
        const key = candidate.id || `position:${candidate.x}:${candidate.y}:${candidate.z}`
        if (seen.has(key)) continue
        seen.add(key)
        players.push(candidate)
        if (players.length >= 32) break
    }
    const camera = snapshot.camera ? {
        position: point(snapshot.camera.position || snapshot.camera),
        yaw: round(snapshot.camera.yaw),
        pitch: round(snapshot.camera.pitch)
    } : null
    const actors = hasCanonicalPlayers && Array.isArray(snapshot.actors)
        ? snapshot.actors.map((value, index) => playerSnapshot(value, `actor-${index}`)).filter(Boolean)
        : players.filter(value => !local || value.id !== local.id)
    return {
        ball: point(snapshot.ball),
        player: local ? { x: local.x, y: local.y, z: local.z } : point(snapshot.player),
        players,
        // Legacy consumers still receive actors.
        actors,
        camera
    }
}

export function renderReplaySnapshot(snapshot, adapters = {}, timestamp = 0) {
    const normalized = normalizeReplaySnapshot(snapshot)
    adapters.ball?.(normalized.ball, timestamp, normalized)
    adapters.player?.(normalized.player, timestamp, normalized)
    adapters.players?.(normalized.players, timestamp, normalized)
    adapters.camera?.(normalized.camera, timestamp, normalized)
    adapters.snapshot?.(normalized, timestamp)
    return normalized
}

function lowerBound(events, time) {
    let low = 0
    let high = events.length
    while (low < high) {
        const mid = (low + high) >>> 1
        if (events[mid].t <= time) low = mid + 1
        else high = mid
    }
    return low
}

export class ReplayClass {
    constructor(options = {}) {
        this._now = options.now || (() => performance.now())
        this._requestFrame = options.requestFrame || (callback => requestAnimationFrame(callback))
        this._cancelFrame = options.cancelFrame || (id => cancelAnimationFrame(id))
        this.recording = false
        this.events = []
        this.meta = null
        this.startTs = 0
        this.playing = false
        this.paused = false
        this.rafId = 0
        this.playbackSpeed = 1
        this.playbackTime = 0
        this._playStart = 0
        this._playIdx = 0
        this._playEvents = []
        this._callbacks = {}
        this._duration = 0
    }

    startRecording(meta) {
        this.recording = true
        this.meta = meta || {}
        this.events = []
        this.startTs = this._now()
        this._lastSnapshotTs = -Infinity
    }

    record(event) {
        if (!this.recording) return
        if (this.events.length >= MAX_EVENTS) this.events.shift()
        this.events.push({
            t: this._now() - this.startTs,
            type: event.type,
            data: event.data
        })
    }

    recordSnapshot(snapshot) {
        if (!this.recording) return
        const now = this._now() - this.startTs
        if (now - this._lastSnapshotTs < SNAPSHOT_INTERVAL) return
        this._lastSnapshotTs = now
        this.record({ type: 'snapshot', data: normalizeReplaySnapshot(snapshot) })
    }

    stopRecording() {
        this.recording = false
        const duration = this.events.length ? this.events[this.events.length - 1].t : 0
        return { meta: this.meta, events: this.events.slice(), duration }
    }

    play(replay, callbacks = {}, options = {}) {
        this.stopPlayback()
        this._playEvents = Array.isArray(replay?.events) ? replay.events : []
        this._callbacks = callbacks || {}
        this._duration = Math.max(finite(replay?.duration), this._playEvents.at(-1)?.t || 0)
        this.playbackSpeed = clamp(finite(options.speed, 1), 0.05, 16)
        this.playbackTime = clamp(finite(options.startTime), 0, this._duration)
        const startsMidReplay = options.startTime != null && this.playbackTime > 0
        this._playIdx = startsMidReplay ? lowerBound(this._playEvents, this.playbackTime) : 0
        this._playStart = this._now()
        this.playing = true
        this.paused = Boolean(options.paused)
        if (startsMidReplay) this._renderCurrentSnapshot()
        if (!this.paused) this._schedule()
        return this.getPlaybackState()
    }

    _schedule() {
        if (!this.playing || this.paused || this.rafId) return
        this.rafId = this._requestFrame(() => {
            this.rafId = 0
            this._tick()
        })
    }

    _tick() {
        if (!this.playing || this.paused) return
        const now = this._now()
        this.playbackTime = clamp(
            this.playbackTime + (now - this._playStart) * this.playbackSpeed,
            0,
            this._duration
        )
        this._playStart = now
        while (this._playIdx < this._playEvents.length && this._playEvents[this._playIdx].t <= this.playbackTime) {
            this._dispatch(this._playEvents[this._playIdx++])
        }
        this._callbacks.time?.(this.playbackTime, this.getPlaybackState())
        if (this._playIdx >= this._playEvents.length && this.playbackTime >= this._duration) {
            const complete = this._callbacks.complete
            this.stopPlayback()
            complete?.()
            return
        }
        this._schedule()
    }

    _dispatch(event) {
        this._callbacks[event.type]?.(event.data, event.t)
        if (event.type === 'snapshot') {
            this._callbacks.players?.(event.data?.players || event.data?.actors || [], event.t, event.data)
            this._callbacks.renderSnapshot?.(normalizeReplaySnapshot(event.data), event.t)
        }
    }

    _renderCurrentSnapshot() {
        for (let i = this._playIdx - 1; i >= 0; i--) {
            const event = this._playEvents[i]
            if (event.type !== 'snapshot') continue
            this._callbacks.snapshot?.(event.data, event.t)
            this._callbacks.players?.(event.data?.players || event.data?.actors || [], event.t, event.data)
            this._callbacks.renderSnapshot?.(normalizeReplaySnapshot(event.data), event.t)
            return event.data
        }
        return null
    }

    pausePlayback() {
        if (!this.playing || this.paused) return false
        this._tick()
        if (!this.playing) return false
        this.paused = true
        if (this.rafId) this._cancelFrame(this.rafId)
        this.rafId = 0
        this._callbacks.pause?.(this.getPlaybackState())
        return true
    }

    resumePlayback() {
        if (!this.playing || !this.paused) return false
        this.paused = false
        this._playStart = this._now()
        this._callbacks.resume?.(this.getPlaybackState())
        this._schedule()
        return true
    }

    togglePause() {
        return this.paused ? this.resumePlayback() : this.pausePlayback()
    }

    seek(time) {
        if (!this.playing) return false
        this.playbackTime = clamp(finite(time), 0, this._duration)
        this._playIdx = lowerBound(this._playEvents, this.playbackTime)
        this._playStart = this._now()
        const snapshot = this._renderCurrentSnapshot()
        this._callbacks.seek?.(this.playbackTime, snapshot, this.getPlaybackState())
        return this.playbackTime
    }

    setPlaybackSpeed(speed) {
        const next = finite(speed, NaN)
        if (!Number.isFinite(next) || next <= 0) return false
        if (this.playing && !this.paused) {
            const now = this._now()
            this.playbackTime = clamp(
                this.playbackTime + (now - this._playStart) * this.playbackSpeed,
                0,
                this._duration
            )
            this._playStart = now
        }
        this.playbackSpeed = clamp(next, 0.05, 16)
        this._callbacks.speed?.(this.playbackSpeed, this.getPlaybackState())
        return this.playbackSpeed
    }

    getPlaybackState() {
        return {
            playing: this.playing,
            paused: this.paused,
            time: this.playbackTime,
            duration: this._duration,
            speed: this.playbackSpeed,
            index: this._playIdx
        }
    }

    stopPlayback(reason = 'stopped') {
        const wasActive = this.playing || this.paused || Boolean(this.rafId)
        this.playing = false
        this.paused = false
        if (this.rafId) this._cancelFrame(this.rafId)
        this.rafId = 0
        if (wasActive) this._callbacks.stop?.(reason, this.getPlaybackState())
        return wasActive
    }

    stop(reason) {
        return this.stopPlayback(reason)
    }

    handleEscape(event) {
        if (event?.key !== 'Escape' && event?.code !== 'Escape') return false
        if (!this.playing && !this.paused) return false
        event.preventDefault?.()
        this.stopPlayback('escape')
        return true
    }

    save(replay) {
        const all = this.loadAll()
        all.push(replay)
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all.slice(-10))) } catch { /* quota */ }
    }

    loadAll() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
    }

    delete(index) {
        const all = this.loadAll()
        if (!Number.isInteger(index) || index < 0 || index >= all.length) return false
        all.splice(index, 1)
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all)) } catch { return false }
        return true
    }

    exportJSON(replay) { return JSON.stringify(replay) }

    importJSON(str) {
        const replay = JSON.parse(str)
        if (!replay || !Array.isArray(replay.events)) throw new Error('Invalid replay JSON')
        if (replay.events.length > MAX_EVENTS) throw new Error('Replay event limit exceeded')
        let previous = -1
        for (const event of replay.events) {
            if (!event || typeof event.type !== 'string' || !Number.isFinite(event.t) || event.t < previous) {
                throw new Error('Invalid replay event')
            }
            previous = event.t
        }
        return replay
    }
}

export const Replay = new ReplayClass()
