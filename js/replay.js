// replay.js — record/playback game events, localStorage persistence
const MAX_EVENTS = 5000
const STORAGE_KEY = 'dodgball_replays_v1'

export class ReplayClass {
    constructor() {
        this.recording = false
        this.events = []
        this.meta = null
        this.startTs = 0
        this.playing = false
        this.rafId = 0
        this._playStart = 0
        this._playIdx = 0
    }

    startRecording(meta) {
        this.recording = true
        this.meta = meta || {}
        this.events = []
        this.startTs = performance.now()
    }

    record(event) {
        if (!this.recording) return
        // ponytail: drop-oldest via shift; O(n) but event rate << cap. Real ring buffer if profiling shows it
        if (this.events.length >= MAX_EVENTS) this.events.shift()
        this.events.push({
            t: performance.now() - this.startTs,
            type: event.type,
            data: event.data
        })
    }

    stopRecording() {
        this.recording = false
        const duration = this.events.length ? this.events[this.events.length - 1].t : 0
        return { meta: this.meta, events: this.events.slice(), duration }
    }

    play(replay, callbacks) {
        this.stopPlayback()
        const events = replay.events || []
        this._playIdx = 0
        this._playStart = performance.now()
        this.playing = true
        const tick = () => {
            if (!this.playing) return
            const elapsed = performance.now() - this._playStart
            while (this._playIdx < events.length && events[this._playIdx].t <= elapsed) {
                const e = events[this._playIdx++]
                const cb = callbacks[e.type]
                if (cb) cb(e.data, e.t)
            }
            if (this._playIdx < events.length) this.rafId = requestAnimationFrame(tick)
            else this.playing = false
        }
        this.rafId = requestAnimationFrame(tick)
    }

    stopPlayback() {
        this.playing = false
        if (this.rafId) cancelAnimationFrame(this.rafId)
        this.rafId = 0
    }

    save(replay) {
        // ponytail: keep last 10; append then slice(-10)
        const all = this.loadAll()
        all.push(replay)
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all.slice(-10))) } catch { /* quota */ }
    }

    loadAll() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
    }

    exportJSON(replay) { return JSON.stringify(replay) }

    importJSON(str) {
        const r = JSON.parse(str)
        if (!r || !Array.isArray(r.events)) throw new Error('Invalid replay JSON')
        return r
    }
}

export const Replay = new ReplayClass()

// ?debug self-check
if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')) {
    const assert = (c, m) => { if (!c) throw new Error('Replay self-check failed: ' + m) }
    Replay.startRecording({ map: 'test', mode: 'casual' })
    Replay.record({ type: 'spawn', data: { x: 1 } })
    Replay.record({ type: 'deflect', data: { p: 2 } })
    Replay.record({ type: 'hit', data: { who: 'a' } })
    const r = Replay.stopRecording()
    assert(r.meta.map === 'test', 'meta')
    assert(r.events.length === 3, 'event count ' + r.events.length)
    assert(r.events[0].type === 'spawn', 'first event type')
    assert(r.events[2].type === 'hit', 'last event type')
    assert(r.duration >= 0, 'duration')

    const fired = []
    Replay.play(r, {
        spawn: d => fired.push(['spawn', d.x]),
        deflect: d => fired.push(['deflect', d.p]),
        hit: d => fired.push(['hit', d.who])
    })
    setTimeout(() => {
        assert(fired.length === 3, 'playback fired ' + fired.length)
        assert(fired[0][0] === 'spawn' && fired[2][0] === 'hit', 'playback order')
        Replay.stopPlayback()

        const r2 = Replay.importJSON(Replay.exportJSON(r))
        assert(r2.events.length === 3, 'import count')

        // ponytail: save/load roundtrip only when localStorage usable; restores state to avoid polluting
        const hasLS = (() => { try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return true } catch { return false } })()
        if (hasLS) {
            const before = Replay.loadAll()
            Replay.save(r)
            const after = Replay.loadAll()
            assert(after.length === before.length + 1, 'save grew list ' + after.length)
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(before)) } catch {}
        }
        console.log('Replay self-check OK', fired)
    }, 100)
}
