// spectator.js - target cameras, noclip free-roam, coach ping, seated stands view
import { SEATED_EYE_HEIGHT } from './spectator-seats.js'

export const CAMERA_MODES = Object.freeze({
    FIRST_PERSON: 'first-person',
    CHASE: 'chase',
    FREE_ROAM: 'free-roam',
    STANDS: 'stands'
})

// Joined spectators (lobby "Spectate"): watch a player's POV / chase, or sit in the
// sideline stands, or fly a Source-style noclip camera. The free camera is a camera
// only: it has no body, no collider and cannot touch the ball.
export const JOINED_SPECTATOR_MODES = Object.freeze([
    CAMERA_MODES.FIRST_PERSON, CAMERA_MODES.CHASE, CAMERA_MODES.FREE_ROAM, CAMERA_MODES.STANDS
])
// Look-around limits while seated, relative to facing the court.
export const STANDS_YAW_LIMIT = 1.3
export const STANDS_PITCH_MIN = -0.75
export const STANDS_PITCH_MAX = 0.45
const POV_FORWARD_OFFSET = 0.55
const SEAT_HOP_SECONDS = 0.35
const SEAT_HOP_HEIGHT = 0.6

export function clampStandsLook(yaw, pitch, seatYaw) {
    const base = finite(seatYaw)
    let delta = finite(yaw) - base
    delta = Math.atan2(Math.sin(delta), Math.cos(delta))
    return {
        yaw: base + clamp(delta, -STANDS_YAW_LIMIT, STANDS_YAW_LIMIT),
        pitch: clamp(finite(pitch), STANDS_PITCH_MIN, STANDS_PITCH_MAX)
    }
}

// Remote players carry their eye height in position.y (~1.7); bots stand at y=0.
export function povEyeOffset(target) {
    if (Number.isFinite(target?.eyeHeight)) return target.eyeHeight
    return finite(target?.position?.y) > 0.6 ? 0.1 : 1.55
}

const CAMERA_MODE_SET = new Set(Object.values(CAMERA_MODES))
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)) }
function finite(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback }

export function computeFreeCamMovement(state, keys, dt) {
    const yaw = finite(state.yaw)
    const pitch = finite(state.pitch)
    const cp = Math.cos(pitch)
    const forward = { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp }
    const right = { x: -forward.z, y: 0, z: forward.x }
    let x = 0
    let y = 0
    let z = 0
    if (keys.w || keys.arrowup) { x += forward.x; y += forward.y; z += forward.z }
    if (keys.s || keys.arrowdown) { x -= forward.x; y -= forward.y; z -= forward.z }
    if (keys.d || keys.arrowright) { x += right.x; z += right.z }
    if (keys.a || keys.arrowleft) { x -= right.x; z -= right.z }
    if (keys.e || keys[' ']) y += 1
    if (keys.q || keys.control) y -= 1
    const length = Math.hypot(x, y, z)
    if (length > 1) { x /= length; y /= length; z /= length }
    const boost = keys.shift ? finite(state.boost, 3) : 1
    const distance = Math.max(0, finite(dt)) * Math.max(0, finite(state.speed, 20)) * boost
    return {
        delta: { x: x * distance, y: y * distance, z: z * distance },
        forward,
        yaw,
        pitch,
        noclip: state.noclip !== false
    }
}

export class SpectatorClass {
    constructor() {
        this.active = false
        this.game = null
        this.camera = null
        this.targets = []
        this.targetIdx = 0
        this.cameraMode = CAMERA_MODES.CHASE
        this.chaseDistance = 7
        this.freeCam = false
        this.noclip = true
        this.freeCamSpeed = 20
        this.freeCamBoost = 3
        this.onTargetChange = null
        this.onModeChange = null
        this.onFreeCamMove = null
        this.yaw = 0
        this.pitch = 0
        this.keys = {}
        this._lastMouseX = null
        this._lastMouseY = null
        this._bound = false
        this._pings = []
        this.allowedModes = null   // null = every mode (dead-player spectate / replay)
        this.seat = null           // stands anchor { x, y, z, yaw }
        this._seatPos = { x: 0, y: 0, z: 0 }
        this._hopFrom = { x: 0, y: 0, z: 0 }
        this._hopT = 0
    }

    // Joined spectators: restrict modes (no free roam) - pass null to lift.
    setAllowedModes(modes) {
        this.allowedModes = Array.isArray(modes) ? modes.filter(mode => CAMERA_MODE_SET.has(mode)) : null
        if (this.allowedModes && !this.allowedModes.includes(this.cameraMode)) {
            this.setCameraMode(this.allowedModes[0])
        }
        return this.allowedModes
    }

    isModeAllowed(mode) {
        return CAMERA_MODE_SET.has(mode) && (!this.allowedModes || this.allowedModes.includes(mode))
    }

    // Seat the stands camera. A seat change is a short hop (arc) instead of a cut.
    setSeat(seat, { instant = false } = {}) {
        if (!seat || ![seat.x, seat.y, seat.z].every(Number.isFinite)) return false
        const first = !this.seat
        const sameSide = !first && Math.sign(this.seat.x) === Math.sign(seat.x)
        if (!first && !instant && this.cameraMode === CAMERA_MODES.STANDS) {
            this._hopFrom.x = this._seatPos.x
            this._hopFrom.y = this._seatPos.y
            this._hopFrom.z = this._seatPos.z
            this._hopT = SEAT_HOP_SECONDS
        } else {
            this._hopT = 0
            this._seatPos.x = seat.x
            this._seatPos.y = seat.y
            this._seatPos.z = seat.z
        }
        this.seat = { x: seat.x, y: seat.y, z: seat.z, yaw: finite(seat.yaw) }
        if (first || !sameSide) {
            this.yaw = this.seat.yaw
            this.pitch = -0.18
        }
        this._notify()
        return true
    }

    clearSeat() {
        this.seat = null
        this._hopT = 0
    }

    // Small in-place jump while seated (Space) - purely visual.
    hop() {
        if (this.cameraMode !== CAMERA_MODES.STANDS || !this.seat || this._hopT > 0) return false
        this._hopFrom.x = this.seat.x
        this._hopFrom.y = this.seat.y
        this._hopFrom.z = this.seat.z
        this._hopT = SEAT_HOP_SECONDS
        return true
    }

    // C for joined spectators: POV → chase → free roam → stands → POV (skips unavailable modes).
    cycleCameraMode() {
        const order = [CAMERA_MODES.FIRST_PERSON, CAMERA_MODES.CHASE, CAMERA_MODES.FREE_ROAM, CAMERA_MODES.STANDS]
        const start = Math.max(0, order.indexOf(this.cameraMode))
        for (let step = 1; step <= order.length; step++) {
            const next = order[(start + step) % order.length]
            if (!this.isModeAllowed(next) || (next === CAMERA_MODES.STANDS && !this.seat)) continue
            if (next === CAMERA_MODES.FREE_ROAM) this.noclip = true
            return this.setCameraMode(next)
        }
        return this.cameraMode
    }

    toggleStands() {
        return this.setCameraMode(this.cameraMode === CAMERA_MODES.STANDS
            ? CAMERA_MODES.FIRST_PERSON
            : CAMERA_MODES.STANDS)
    }

    enter(game, options = {}) {
        this.exit()
        this.game = game
        this.camera = game?.player?.camera || game?.camera || null
        this.targets = this._gatherTargets()
        this.targetIdx = clamp(finite(options.targetIndex), 0, Math.max(0, this.targets.length - 1))
        const targetYaw = this.getTarget()?.yaw ?? this.getTarget()?.euler?.y
        this.yaw = finite(targetYaw, this.yaw)
        this.active = true
        this.setCameraMode(options.mode || CAMERA_MODES.FREE_ROAM)
        if (typeof document !== 'undefined' && document.pointerLockElement && document.exitPointerLock) {
            document.exitPointerLock()
        }
        this._notify()
        return this.getState()
    }

    exit(reason = 'stopped') {
        const wasActive = this.active
        this.active = false
        this._detachInput()
        this._clearPings()
        this.keys = {}
        this._lastMouseX = null
        this._lastMouseY = null
        if (wasActive) {
            this.onStop?.(reason)
            this._notify()
        }
        return wasActive
    }

    stop(reason) {
        return this.exit(reason)
    }

    handleEscape(event) {
        if (event?.key !== 'Escape' && event?.code !== 'Escape') return false
        if (!this.active) return false
        event.preventDefault?.()
        this.exit('escape')
        return true
    }

    _clearPings() {
        for (const ping of this._pings) {
            this.game?.arena?.remove?.(ping.mesh)
            ping.mesh.geometry?.dispose?.()
            ping.mesh.material?.dispose?.()
        }
        this._pings = []
    }

    _gatherTargets() {
        if (!this.game) return []
        const targets = this.game.getAllTargets ? this.game.getAllTargets() : [this.game.player]
        // A joined spectator's own (never-alive) player is not someone to watch.
        const withPosition = (targets || []).filter(target => target?.position
            && !(this.game.localSpectator && target === this.game.player))
        if (!this.allowedModes) return withPosition
        const alive = withPosition.filter(target => target.alive !== false)
        return alive.length ? alive : withPosition
    }

    refreshTargets() {
        const current = this.targets[this.targetIdx]
        const currentId = current?.id ?? current?.name
        this.targets = this._gatherTargets()
        const preserved = this.targets.findIndex(target => target === current ||
            (currentId != null && (target.id ?? target.name) === currentId))
        this.targetIdx = preserved >= 0 ? preserved : clamp(this.targetIdx, 0, Math.max(0, this.targets.length - 1))
        return this.targets
    }

    nextTarget() {
        this.refreshTargets()
        if (!this.targets.length) return null
        this.targetIdx = (this.targetIdx + 1) % this.targets.length
        this.yaw = finite(this.getTarget()?.yaw ?? this.getTarget()?.euler?.y, this.yaw)
        this._notify()
        return this.getTarget()
    }

    cycleTarget() {
        return this.nextTarget()
    }

    prevTarget() {
        this.refreshTargets()
        if (!this.targets.length) return null
        this.targetIdx = (this.targetIdx - 1 + this.targets.length) % this.targets.length
        this.yaw = finite(this.getTarget()?.yaw ?? this.getTarget()?.euler?.y, this.yaw)
        this._notify()
        return this.getTarget()
    }

    getTarget() {
        return this.targets[this.targetIdx] || null
    }

    getTargetName() {
        const target = this.getTarget()
        if (!target) return 'none'
        if (target === this.game?.player) return this.game.playerName || target.name || 'You'
        return target.name || target.id || 'unknown'
    }

    setCameraMode(mode) {
        if (!this.isModeAllowed(mode)) return false
        if (mode === CAMERA_MODES.STANDS && !this.seat) return false
        const changed = this.cameraMode !== mode
        this.cameraMode = mode
        this.freeCam = mode === CAMERA_MODES.FREE_ROAM
        if (this.active) this._attachInput()
        else this._detachInput()
        if (changed) {
            this.onModeChange?.(mode, this.getState())
            this._notify()
        }
        return mode
    }

    setFreeCam(enabled) {
        return this.setCameraMode(enabled ? CAMERA_MODES.FREE_ROAM : CAMERA_MODES.CHASE)
    }

    handlePointerButton(event) {
        if (!this.active) return false
        if (event?.button === 0) this.nextTarget()
        else if (event?.button === 2) this.prevTarget()
        else return false
        event.preventDefault?.()
        return true
    }

    handleWheel(event) {
        if (!this.active) return false
        if (this.cameraMode === CAMERA_MODES.STANDS) {
            event?.preventDefault?.()
            return true
        }
        const delta = Number(event?.deltaY) || 0
        this.chaseDistance = clamp(this.chaseDistance + Math.sign(delta) * 1.15, 0.5, 14)
        this.setCameraMode(this.chaseDistance <= 1 ? CAMERA_MODES.FIRST_PERSON : CAMERA_MODES.CHASE)
        event?.preventDefault?.()
        this._notify()
        return true
    }

    setNoclip(enabled) {
        this.noclip = Boolean(enabled)
        return this.noclip
    }

    setFreeCamState(state = {}) {
        this.yaw = finite(state.yaw, this.yaw)
        this.pitch = clamp(finite(state.pitch, this.pitch), -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05)
        this.freeCamSpeed = Math.max(0, finite(state.speed, this.freeCamSpeed))
        if (state.noclip !== undefined) this.noclip = Boolean(state.noclip)
        if (state.position && this.camera?.position) {
            this.camera.position.set?.(state.position.x, state.position.y, state.position.z)
            if (!this.camera.position.set) Object.assign(this.camera.position, state.position)
        }
        return this.getFreeCamState()
    }

    getFreeCamState() {
        return {
            position: this.camera?.position ? {
                x: finite(this.camera.position.x),
                y: finite(this.camera.position.y),
                z: finite(this.camera.position.z)
            } : null,
            yaw: this.yaw,
            pitch: this.pitch,
            speed: this.freeCamSpeed,
            noclip: this.noclip
        }
    }

    getState() {
        return {
            active: this.active,
            mode: this.cameraMode,
            freeCam: this.freeCam,
            targetIndex: this.targetIdx,
            target: this.getTarget(),
            targetName: this.getTargetName(),
            freeCamState: this.getFreeCamState(),
            ...(this.allowedModes ? { context: 'joined' } : {})
        }
    }

    update(dt) {
        if (!this.active || !this.camera) return
        this._updatePings(dt)
        if (this.cameraMode === CAMERA_MODES.FREE_ROAM) {
            this._updateFreeCam(dt)
            return
        }
        if (this.cameraMode === CAMERA_MODES.STANDS) {
            this._updateStands(dt)
            return
        }
        this.refreshTargets()
        const target = this.getTarget()
        if (!target?.position) return
        if (this.cameraMode === CAMERA_MODES.FIRST_PERSON) this._updateFirstPerson(target)
        else this._updateChase(target)
    }

    _updateFirstPerson(target) {
        const position = target.position
        const eyeHeight = this.allowedModes ? povEyeOffset(target) : finite(target.eyeHeight, 1.6)
        this.camera.position.set(position.x, position.y + eyeHeight, position.z)
        if (target.camera?.quaternion && this.camera.quaternion?.copy) {
            this.camera.quaternion.copy(target.camera.quaternion)
            return
        }
        if (this.allowedModes) {
            // Remote humans stream their aim; bots (no aim stream) watch the ball.
            // The eye is pushed just in front of the face so the watched player's own
            // head mesh never fills the screen.
            const aim = target.aimDir
            const isBot = target.isBotEntity === true || typeof target.tryDeflect === 'function'
            let dx = 0
            let dy = 0
            let dz = 0
            const ball = this.game?.ball?.position
            if (!isBot && aim && Number.isFinite(aim.x) && (aim.x * aim.x + aim.y * aim.y + aim.z * aim.z) > 0.25) {
                dx = aim.x; dy = aim.y; dz = aim.z
            } else if (ball && Number.isFinite(ball.x) && this.game?.ball?.active !== false
                && Math.hypot(ball.x - position.x, ball.z - position.z) > 2.5) {
                dx = ball.x - this.camera.position.x
                dy = ball.y - this.camera.position.y
                dz = ball.z - this.camera.position.z
            } else {
                // No live ball to track: face the opponents' half (red defends z < 0).
                dz = target.team === 'blue' ? -1 : 1
            }
            const length = Math.hypot(dx, dy, dz)
            if (length > 1e-4) {
                dx /= length; dy /= length; dz /= length
                this.camera.position.set(
                    this.camera.position.x + dx * POV_FORWARD_OFFSET,
                    this.camera.position.y + dy * POV_FORWARD_OFFSET,
                    this.camera.position.z + dz * POV_FORWARD_OFFSET
                )
                this.camera.lookAt(this.camera.position.x + dx, this.camera.position.y + dy, this.camera.position.z + dz)
                return
            }
        }
        const yaw = finite(target.yaw ?? target.euler?.y ?? target.rotation?.y)
        const pitch = finite(target.pitch ?? target.euler?.x ?? target.rotation?.x)
        const cp = Math.cos(pitch)
        this.camera.lookAt(
            position.x - Math.sin(yaw) * cp,
            position.y + eyeHeight + Math.sin(pitch),
            position.z - Math.cos(yaw) * cp
        )
    }

    _updateChase(target) {
        const position = target.position
        const yaw = this.yaw
        const distance = this.chaseDistance
        const horizontal = Math.cos(this.pitch) * distance
        this.camera.position.set(
            position.x + Math.sin(yaw) * horizontal,
            position.y + 2.35 + Math.sin(this.pitch) * distance,
            position.z + Math.cos(yaw) * horizontal
        )
        this.camera.lookAt(position.x, position.y + 1.25, position.z)
    }

    _updateStands(dt) {
        const seat = this.seat
        if (!seat) return
        const look = clampStandsLook(this.yaw, this.pitch, seat.yaw)
        this.yaw = look.yaw
        this.pitch = look.pitch
        let lift = 0
        if (this._hopT > 0) {
            this._hopT = Math.max(0, this._hopT - Math.max(0, finite(dt)))
            const t = 1 - this._hopT / SEAT_HOP_SECONDS
            this._seatPos.x = this._hopFrom.x + (seat.x - this._hopFrom.x) * t
            this._seatPos.y = this._hopFrom.y + (seat.y - this._hopFrom.y) * t
            this._seatPos.z = this._hopFrom.z + (seat.z - this._hopFrom.z) * t
            lift = Math.sin(t * Math.PI) * SEAT_HOP_HEIGHT
        } else {
            this._seatPos.x = seat.x
            this._seatPos.y = seat.y
            this._seatPos.z = seat.z
        }
        this.camera.position.set(this._seatPos.x, this._seatPos.y + SEATED_EYE_HEIGHT + lift, this._seatPos.z)
        const cp = Math.cos(this.pitch)
        this.camera.lookAt(
            this.camera.position.x - Math.sin(this.yaw) * cp,
            this.camera.position.y + Math.sin(this.pitch),
            this.camera.position.z - Math.cos(this.yaw) * cp
        )
    }

    _updateFreeCam(dt) {
        const movement = computeFreeCamMovement({
            yaw: this.yaw,
            pitch: this.pitch,
            speed: this.freeCamSpeed,
            boost: this.freeCamBoost,
            noclip: this.noclip
        }, this.keys, dt)
        const hookResult = this.onFreeCamMove?.(movement, this.getFreeCamState())
        const delta = hookResult?.delta || movement.delta
        if (hookResult !== false) {
            this.camera.position.x += delta.x
            this.camera.position.y += delta.y
            this.camera.position.z += delta.z
            const bounds = this.game?.arena?.spectatorBounds
            if (bounds) {
                this.camera.position.x = clamp(this.camera.position.x, bounds.minX, bounds.maxX)
                this.camera.position.z = clamp(this.camera.position.z, bounds.minZ, bounds.maxZ)
                if (Number.isFinite(bounds.minY)) this.camera.position.y = Math.max(bounds.minY, this.camera.position.y)
                if (Number.isFinite(bounds.maxY)) this.camera.position.y = Math.min(bounds.maxY, this.camera.position.y)
            }
        }
        const forward = movement.forward
        this.camera.lookAt(
            this.camera.position.x + forward.x,
            this.camera.position.y + forward.y,
            this.camera.position.z + forward.z
        )
        return movement
    }

    _attachInput() {
        if (this._bound || typeof document === 'undefined') return
        this._onMouseMove = event => {
            if (event.target?.closest?.('[data-spectator-ui]')) {
                const x = Number(event.clientX)
                const y = Number(event.clientY)
                if (Number.isFinite(x)) this._lastMouseX = x
                if (Number.isFinite(y)) this._lastMouseY = y
                return
            }
            const locked = typeof document !== 'undefined' && document.pointerLockElement
            let dx = 0
            let dy = 0
            if (locked) {
                dx = finite(event.movementX)
                dy = finite(event.movementY)
            } else {
                const x = Number(event.clientX)
                const y = Number(event.clientY)
                if (Number.isFinite(x) && Number.isFinite(this._lastMouseX)) dx = x - this._lastMouseX
                if (Number.isFinite(y) && Number.isFinite(this._lastMouseY)) dy = y - this._lastMouseY
                this._lastMouseX = Number.isFinite(x) ? x : this._lastMouseX
                this._lastMouseY = Number.isFinite(y) ? y : this._lastMouseY
            }
            this.yaw -= dx * 0.0025
            this.pitch = clamp(this.pitch - dy * 0.0025, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05)
        }
        this._onKeyDown = event => { this.keys[(event.key || '').toLowerCase()] = true }
        this._onKeyUp = event => { this.keys[(event.key || '').toLowerCase()] = false }
        this._onContext = event => { this._handleContextMenu(event).catch(() => {}) }
        document.addEventListener('mousemove', this._onMouseMove)
        document.addEventListener('keydown', this._onKeyDown)
        document.addEventListener('keyup', this._onKeyUp)
        document.addEventListener('contextmenu', this._onContext)
        this._bound = true
    }

    _detachInput() {
        if (!this._bound || typeof document === 'undefined') return
        document.removeEventListener('mousemove', this._onMouseMove)
        document.removeEventListener('keydown', this._onKeyDown)
        document.removeEventListener('keyup', this._onKeyUp)
        document.removeEventListener('contextmenu', this._onContext)
        this._bound = false
        this.keys = {}
        this._lastMouseX = null
        this._lastMouseY = null
    }

    async _handleContextMenu(event) {
        if (!this.freeCam || !this.camera || !this.game?.arena) return
        event.preventDefault()
        const { groundPointFromClick } = await import('./spectator-ping.js')
        if (!this.active || !this.freeCam || !this.game?.arena) return
        const hit = groundPointFromClick(event.clientX, event.clientY, this.camera)
        if (!hit) return
        const bounds = this.game.arena.bounds
        if (hit.x > bounds.minX && hit.x < bounds.maxX && hit.z > bounds.minZ && hit.z < bounds.maxZ) {
            await this._spawnPing(hit)
        }
    }

    async _spawnPing(position) {
        if (!this.game?.arena) return
        const { createPingMesh } = await import('./spectator-ping.js')
        const ring = createPingMesh(position)
        this.game.arena.add(ring)
        this._pings.push({ mesh: ring, timer: 4 })
    }

    _updatePings(dt) {
        for (let i = this._pings.length - 1; i >= 0; i--) {
            const ping = this._pings[i]
            ping.timer -= dt
            ping.mesh.material.opacity = Math.min(1, ping.timer) * 0.7
            ping.mesh.scale.setScalar(1 + (4 - ping.timer) * 0.5)
            if (ping.timer <= 0) {
                this.game?.arena?.remove?.(ping.mesh)
                ping.mesh.geometry?.dispose?.()
                ping.mesh.material?.dispose?.()
                this._pings.splice(i, 1)
            }
        }
    }

    _notify() {
        this.onTargetChange?.(this.getTargetName(), this.getState())
    }
}

export const Spectator = new SpectatorClass()
