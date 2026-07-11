// spectator.js — cycle camera between players, optional free cam, coach ping
import * as THREE from 'three';
export class SpectatorClass {
    constructor() {
        this.active = false
        this.game = null
        this.camera = null
        this.targets = []
        this.targetIdx = 0
        this.freeCam = false
        this.onTargetChange = null
        this.yaw = 0
        this.pitch = 0
        this.keys = {}
        this._bound = false
        this._pings = [] // { mesh, timer }
    }

    enter(game) {
        this.game = game
        this._clearPings()
        // ponytail: camera lives on Player in this codebase; fallback for alt wiring
        this.camera = game.player?.camera || game.camera || null
        this.targets = this._gatherTargets()
        this.targetIdx = 0
        this.freeCam = false
        this.active = true
        if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock()
        this._notify()
    }

    exit() {
        this.active = false
        this._detachInput()
        this._clearPings()
    }

    _clearPings() {
        for (const p of this._pings) {
            this.game?.arena?.remove(p.mesh)
            p.mesh.geometry.dispose()
            p.mesh.material.dispose()
        }
        this._pings = []
    }

    _gatherTargets() {
        // ponytail: getAllTargets returns [player, ...bots]; both expose .position
        return this.game.getAllTargets ? this.game.getAllTargets() : [this.game.player]
    }

    cycleTarget() {
        if (!this.targets.length) return
        this.targetIdx = (this.targetIdx + 1) % this.targets.length
        this._notify()
    }

    prevTarget() {
        if (!this.targets.length) return
        this.targetIdx = (this.targetIdx - 1 + this.targets.length) % this.targets.length
        this._notify()
    }

    getTargetName() {
        const t = this.targets[this.targetIdx]
        if (!t) return 'none'
        // ponytail: human player has no .name in this codebase; game.playerName holds it
        if (t === this.game.player) return this.game.playerName || 'You'
        return t.name || 'unknown'
    }

    setFreeCam(bool) {
        this.freeCam = bool
        if (bool) this._attachInput(); else this._detachInput()
    }

    update(dt) {
        if (!this.active || !this.camera) return
        this._updatePings(dt)
        if (this.freeCam) { this._updateFreeCam(dt); return }
        const t = this.targets[this.targetIdx]
        if (!t || !t.position) return
        const p = t.position
        // ponytail: fixed chase offset, no smoothing; add lerp if jitter appears at high speed
        this.camera.position.set(p.x, p.y + 4, p.z + 7)
        this.camera.lookAt(p.x, p.y, p.z)
    }

    _updateFreeCam(dt) {
        // ponytail: yaw/pitch fly cam, no collision; pure math so no THREE import needed
        const cam = this.camera
        const speed = 20 * dt
        const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch)
        const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw)
        // forward (three default -z, rotated by yaw around Y, pitch around X)
        const fx = -sy * cp, fy = sp, fz = -cy * cp
        // right = forward x up(0,1,0) = (-fz, 0, fx)
        const rx = -fz, rz = fx
        let mx = 0, my = 0, mz = 0
        if (this.keys['w']) { mx += fx; my += fy; mz += fz }
        if (this.keys['s']) { mx -= fx; my -= fy; mz -= fz }
        if (this.keys['d']) { mx += rx; mz += rz }
        if (this.keys['a']) { mx -= rx; mz -= rz }
        // ponytail: no diagonal normalization; ~41% faster diagonally, fine for spectator
        cam.position.x += mx * speed
        cam.position.y += my * speed
        cam.position.z += mz * speed
        cam.lookAt(cam.position.x + fx, cam.position.y + fy, cam.position.z + fz)
    }

    _attachInput() {
        if (this._bound) return
        this._onMouseMove = e => {
            if (e.movementX == null) return
            this.yaw -= e.movementX * 0.0025
            this.pitch -= e.movementY * 0.0025
            const lim = Math.PI / 2 - 0.05
            if (this.pitch > lim) this.pitch = lim
            if (this.pitch < -lim) this.pitch = -lim
        }
        this._onKeyDown = e => { this.keys[e.key.toLowerCase()] = true }
        this._onKeyUp = e => { this.keys[e.key.toLowerCase()] = false }
        this._onContext = e => {
            if (!this.freeCam || !this.camera || !this.game?.arena) return
            e.preventDefault()
            const raycaster = new THREE.Raycaster()
            const mouse = new THREE.Vector2(
                (e.clientX / window.innerWidth) * 2 - 1,
                -(e.clientY / window.innerHeight) * 2 + 1
            )
            raycaster.setFromCamera(mouse, this.camera)
            const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
            const hit = new THREE.Vector3()
            const ray = raycaster.ray
            const denom = ray.direction.dot(plane.normal)
            if (Math.abs(denom) > 1e-6) {
                const t = -(ray.origin.dot(plane.normal) + plane.constant) / denom
                if (t > 0) {
                    hit.copy(ray.origin).add(ray.direction.clone().multiplyScalar(t))
                    if (hit.x > this.game.arena.bounds.minX && hit.x < this.game.arena.bounds.maxX &&
                        hit.z > this.game.arena.bounds.minZ && hit.z < this.game.arena.bounds.maxZ) {
                        this._spawnPing(hit)
                    }
                }
            }
        }
        document.addEventListener('mousemove', this._onMouseMove)
        document.addEventListener('keydown', this._onKeyDown)
        document.addEventListener('keyup', this._onKeyUp)
        document.addEventListener('contextmenu', this._onContext)
        this._bound = true
    }

    _detachInput() {
        if (!this._bound) return
        document.removeEventListener('mousemove', this._onMouseMove)
        document.removeEventListener('keydown', this._onKeyDown)
        document.removeEventListener('keyup', this._onKeyUp)
        document.removeEventListener('contextmenu', this._onContext)
        this._bound = false
        this.keys = {}
    }

    _spawnPing(pos) {
        if (!this.game?.arena) return
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.5, 1, 24),
            new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
        )
        ring.position.set(pos.x, 0.05, pos.z)
        ring.rotation.x = -Math.PI / 2
        this.game.arena.add(ring)
        this._pings.push({ mesh: ring, timer: 4 })
    }

    _updatePings(dt) {
        for (let i = this._pings.length - 1; i >= 0; i--) {
            const p = this._pings[i]
            p.timer -= dt
            p.mesh.material.opacity = Math.min(1, p.timer) * 0.7
            p.mesh.scale.setScalar(1 + (4 - p.timer) * 0.5)
            if (p.timer <= 0) {
                this.game?.arena?.remove(p.mesh)
                p.mesh.geometry.dispose()
                p.mesh.material.dispose()
                this._pings.splice(i, 1)
            }
        }
    }

    _notify() {
        if (this.onTargetChange) this.onTargetChange(this.getTargetName())
    }
}

export const Spectator = new SpectatorClass()

// ?debug self-check
if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')) {
    const assert = (c, m) => { if (!c) throw new Error('Spectator self-check failed: ' + m) }
    const camPos = { x: 0, y: 0, z: 0 }
    camPos.set = function (x, y, z) { this.x = x; this.y = y; this.z = z }
    const cam = { position: camPos, lookAt: () => {} }
    const player = { camera: cam, position: { x: 1, y: 1, z: 1 } }
    const bot1 = { name: 'BotA', position: { x: 2, y: 0, z: 2 } }
    const bot2 = { name: 'BotB', position: { x: 3, y: 0, z: 3 } }
    const game = { player, playerName: 'Tester', camera: cam, getAllTargets: () => [player, bot1, bot2] }

    let changed = null
    Spectator.onTargetChange = n => { changed = n }
    Spectator.enter(game)
    assert(Spectator.active, 'active')
    assert(changed === 'Tester', 'initial target name ' + changed)
    Spectator.cycleTarget()
    assert(Spectator.getTargetName() === 'BotA', 'cycle ' + Spectator.getTargetName())
    Spectator.cycleTarget()
    assert(Spectator.getTargetName() === 'BotB', 'cycle2 ' + Spectator.getTargetName())
    Spectator.prevTarget()
    assert(Spectator.getTargetName() === 'BotA', 'prev ' + Spectator.getTargetName())

    Spectator.update(0.016) // follow cam — should not throw
    assert(camPos.x === 2 && camPos.y === 4 && camPos.z === 9, 'follow cam pos ' + [camPos.x, camPos.y, camPos.z])

    Spectator.setFreeCam(true)
    Spectator.keys['w'] = true
    const beforeX = camPos.x
    Spectator.update(0.016) // free cam forward — should move along fwd
    assert(camPos.x !== beforeX || camPos.z !== beforeX, 'free cam moved')
    Spectator.setFreeCam(false)
    assert(!Spectator._bound, 'input detached on freeCam off')

    Spectator.exit()
    assert(!Spectator.active, 'exit')
    console.log('Spectator self-check OK')
}
