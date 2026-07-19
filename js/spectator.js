// spectator.js - target cameras, noclip free-roam, coach ping
export const CAMERA_MODES = Object.freeze({
    FIRST_PERSON: 'first-person',
    CHASE: 'chase',
    FREE_ROAM: 'free-roam'
})

const CAMERA_MODE_SET = new Set(Object.values(CAMERA_MODES))
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback

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
        this._bound = false
        this._pings = []
    }

    enter(game, options = {}) {
        this.exit()
        this.game = game
        this.camera = game?.player?.camera || game?.camera || null
        this.targets = this._gatherTargets()
        this.targetIdx = clamp(finite(options.targetIndex), 0, Math.max(0, this.targets.length - 1))
        this.active = true
        this.setCameraMode(options.mode || CAMERA_MODES.CHASE)
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
        return (targets || []).filter(target => target?.position)
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
        if (!CAMERA_MODE_SET.has(mode)) return false
        const changed = this.cameraMode !== mode
        this.cameraMode = mode
        this.freeCam = mode === CAMERA_MODES.FREE_ROAM
        if (this.active && this.freeCam) this._attachInput()
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
            freeCamState: this.getFreeCamState()
        }
    }

    update(dt) {
        if (!this.active || !this.camera) return
        this._updatePings(dt)
        if (this.cameraMode === CAMERA_MODES.FREE_ROAM) {
            this._updateFreeCam(dt)
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
        const eyeHeight = finite(target.eyeHeight, 1.6)
        this.camera.position.set(position.x, position.y + eyeHeight, position.z)
        if (target.camera?.quaternion && this.camera.quaternion?.copy) {
            this.camera.quaternion.copy(target.camera.quaternion)
            return
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
        const yaw = finite(target.yaw ?? target.euler?.y ?? target.rotation?.y)
        const distance = 7
        this.camera.position.set(
            position.x + Math.sin(yaw) * distance,
            position.y + 4,
            position.z + Math.cos(yaw) * distance
        )
        this.camera.lookAt(position.x, position.y + 1, position.z)
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
            if (event.movementX == null) return
            this.yaw -= event.movementX * 0.0025
            this.pitch = clamp(this.pitch - event.movementY * 0.0025, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05)
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
    }

    async _handleContextMenu(event) {
        if (!this.freeCam || !this.camera || !this.game?.arena) return
        event.preventDefault()
        const THREE = await import('three')
        if (!this.active || !this.freeCam || !this.game?.arena) return
        const raycaster = new THREE.Raycaster()
        const mouse = new THREE.Vector2(
            (event.clientX / window.innerWidth) * 2 - 1,
            -(event.clientY / window.innerHeight) * 2 + 1
        )
        raycaster.setFromCamera(mouse, this.camera)
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
        const hit = new THREE.Vector3()
        const denominator = raycaster.ray.direction.dot(plane.normal)
        if (Math.abs(denominator) <= 1e-6) return
        const distance = -(raycaster.ray.origin.dot(plane.normal) + plane.constant) / denominator
        if (distance <= 0) return
        hit.copy(raycaster.ray.origin).add(raycaster.ray.direction.clone().multiplyScalar(distance))
        const bounds = this.game.arena.bounds
        if (hit.x > bounds.minX && hit.x < bounds.maxX && hit.z > bounds.minZ && hit.z < bounds.maxZ) {
            await this._spawnPing(hit, THREE)
        }
    }

    async _spawnPing(position, THREE) {
        if (!this.game?.arena) return
        THREE ||= await import('three')
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.5, 1, 24),
            new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
        )
        ring.position.set(position.x, 0.05, position.z)
        ring.rotation.x = -Math.PI / 2
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
