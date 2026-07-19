import test from 'node:test'
import assert from 'node:assert/strict'

const memory = new Map()
globalThis.localStorage = {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, String(value))
}

const {
    ReplayClass,
    normalizeReplaySnapshot,
    renderReplaySnapshot
} = await import('../js/replay.js')
const {
    CAMERA_MODES,
    SpectatorClass,
    computeFreeCamMovement
} = await import('../js/spectator.js')

function fakeClock() {
    let now = 0
    let nextId = 1
    const frames = new Map()
    return {
        now: () => now,
        requestFrame: callback => {
            const id = nextId++
            frames.set(id, callback)
            return id
        },
        cancelFrame: id => frames.delete(id),
        advance(ms) {
            now += ms
            const pending = [...frames.values()]
            frames.clear()
            pending.forEach(callback => callback(now))
        }
    }
}

function fakeCamera() {
    const position = {
        x: 0,
        y: 0,
        z: 0,
        set(x, y, z) { this.x = x; this.y = y; this.z = z }
    }
    return {
        position,
        lookAtCalls: [],
        lookAt(...args) { this.lookAtCalls.push(args) }
    }
}

test('snapshot normalization includes local and remote players while retaining legacy actors', () => {
    const snapshot = normalizeReplaySnapshot({
        ball: { x: 1.234, y: 2, z: 3 },
        player: { id: 'local', name: 'Ada', team: 'blue', position: { x: 4, y: 5, z: 6 } },
        actors: [{ id: 'bot', name: 'Bot', team: 'red', x: 7, y: 8, z: 9, yaw: 1.234 }]
    })
    assert.equal(snapshot.ball.x, 1.23)
    assert.deepEqual(snapshot.players.map(player => player.id), ['local', 'bot'])
    assert.equal(snapshot.players[1].yaw, 1.23)
    assert.equal(snapshot.actors.length, 1)

    const rendered = []
    renderReplaySnapshot(snapshot, {
        ball: ball => rendered.push(['ball', ball.x]),
        players: players => rendered.push(['players', players.length])
    })
    assert.deepEqual(rendered, [['ball', 1.23], ['players', 2]])
})

test('playback pause, speed, seek, completion, and escape stop are deterministic', () => {
    const clock = fakeClock()
    const replay = new ReplayClass(clock)
    const fired = []
    const snapshots = []
    const data = {
        duration: 1000,
        events: [
            { t: 0, type: 'hit', data: { id: 0 } },
            { t: 100, type: 'hit', data: { id: 1 } },
            { t: 400, type: 'snapshot', data: { players: [{ id: 'p', x: 1, y: 2, z: 3 }] } },
            { t: 900, type: 'hit', data: { id: 2 } }
        ]
    }

    replay.play(data, {
        hit: value => fired.push(value.id),
        renderSnapshot: value => snapshots.push(value.players[0].id)
    })
    clock.advance(100)
    assert.deepEqual(fired, [0, 1])
    assert.equal(replay.pausePlayback(), true)
    clock.advance(500)
    assert.equal(replay.getPlaybackState().time, 100)
    assert.equal(replay.setPlaybackSpeed(2), 2)
    assert.equal(replay.resumePlayback(), true)
    clock.advance(150)
    assert.equal(replay.getPlaybackState().time, 400)
    assert.deepEqual(snapshots, ['p'])

    assert.equal(replay.seek(850), 850)
    assert.deepEqual(snapshots, ['p', 'p'])
    clock.advance(25)
    assert.deepEqual(fired, [0, 1, 2])
    clock.advance(50)
    assert.equal(replay.playing, false)

    replay.play(data, {})
    let prevented = false
    assert.equal(replay.handleEscape({ key: 'Escape', preventDefault: () => { prevented = true } }), true)
    assert.equal(prevented, true)
    assert.equal(replay.playing, false)
    assert.equal(replay.stopPlayback(), false)
})

test('recordSnapshot throttles and records canonical players', () => {
    const clock = fakeClock()
    const replay = new ReplayClass(clock)
    replay.startRecording()
    replay.recordSnapshot({
        player: { id: 'local', team: 'blue', x: 1, y: 2, z: 3 },
        players: [{ id: 'remote', team: 'red', position: { x: 4, y: 5, z: 6 } }]
    })
    clock.advance(100)
    replay.recordSnapshot({ players: [] })
    assert.equal(replay.events.length, 1)
    assert.deepEqual(replay.events[0].data.players.map(player => player.id), ['local', 'remote'])
})

test('spectator supports first-person, chase, target cycling, and safe stop', () => {
    const camera = fakeCamera()
    const local = { id: 'local', camera, position: { x: 1, y: 2, z: 3 }, yaw: 0 }
    const bot = { id: 'bot', name: 'Bot', position: { x: 10, y: 0, z: 5 }, yaw: Math.PI / 2 }
    const game = { player: local, playerName: 'Ada', getAllTargets: () => [local, bot] }
    const spectator = new SpectatorClass()

    spectator.enter(game, { mode: CAMERA_MODES.FIRST_PERSON })
    spectator.update(0.016)
    assert.deepEqual([camera.position.x, camera.position.y, camera.position.z], [1, 3.6, 3])
    assert.equal(spectator.nextTarget(), bot)
    spectator.setCameraMode(CAMERA_MODES.CHASE)
    spectator.update(0.016)
    assert.equal(camera.position.x, 17)
    assert.equal(spectator.prevTarget(), local)

    let prevented = false
    assert.equal(spectator.handleEscape({ code: 'Escape', preventDefault: () => { prevented = true } }), true)
    assert.equal(prevented, true)
    assert.equal(spectator.active, false)
    assert.equal(spectator.stop(), false)
})

test('free-roam movement is normalized, noclip-aware, and hookable', () => {
    const diagonal = computeFreeCamMovement(
        { yaw: 0, pitch: 0, speed: 10, boost: 2, noclip: true },
        { w: true, d: true, shift: true },
        1
    )
    assert.ok(Math.abs(Math.hypot(diagonal.delta.x, diagonal.delta.y, diagonal.delta.z) - 20) < 1e-9)
    assert.equal(diagonal.noclip, true)

    const camera = fakeCamera()
    const player = { camera, position: { x: 0, y: 0, z: 0 } }
    const spectator = new SpectatorClass()
    spectator.enter({ player, getAllTargets: () => [player] }, { mode: CAMERA_MODES.FREE_ROAM })
    spectator.keys.w = true
    spectator.onFreeCamMove = movement => ({
        delta: { x: movement.delta.x, y: 5, z: movement.delta.z }
    })
    spectator.update(0.5)
    assert.equal(camera.position.y, 5)
    assert.equal(camera.position.z, -10)
    assert.equal(spectator.getFreeCamState().noclip, true)
})
