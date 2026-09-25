// Play of the Game, inline: plays the clip in a small stage inside the report,
// with its own renderer, scene and replay clock. Nothing here touches the game
// state, the main scene or the main camera, so it is safe online while the lobby
// votes on a rematch; the next match start disposes it.
import * as THREE from 'three';
import { ReplayClass } from './replay.js';
import { ReplayView } from './replay-view.js';

const CHASE_BACK = 6.5;
const CHASE_UP = 3.6;
const LOOK_AHEAD = 5;

// Where the camera sits for one frame: behind the focus player (yaw = where they
// face, three.js -Z forward), else high over the court looking at the ball.
export function potgCameraPose(focus, ball) {
    if (focus) {
        const yaw = Number(focus.yaw) || 0;
        const fx = -Math.sin(yaw);
        const fz = -Math.cos(yaw);
        return {
            position: { x: focus.x - fx * CHASE_BACK, y: focus.y + CHASE_UP, z: focus.z - fz * CHASE_BACK },
            target: { x: focus.x + fx * LOOK_AHEAD, y: focus.y + 1.2, z: focus.z + fz * LOOK_AHEAD }
        };
    }
    const b = ball || { x: 0, y: 1, z: 0 };
    return { position: { x: b.x, y: 26, z: b.z + 22 }, target: { x: b.x, y: b.y, z: b.z } };
}

function buildCourt(scene, { courtWidth = 80, courtLength = 110, redSide = 1 } = {}) {
    const half = new THREE.PlaneGeometry(courtWidth, courtLength / 2);
    half.rotateX(-Math.PI / 2);
    const red = new THREE.Mesh(half, new THREE.MeshLambertMaterial({ color: 0x7a2a33 }));
    const blue = new THREE.Mesh(half, new THREE.MeshLambertMaterial({ color: 0x23406e }));
    red.position.z = redSide * courtLength / 4;
    blue.position.z = -redSide * courtLength / 4;
    const line = new THREE.Mesh(new THREE.BoxGeometry(courtWidth, 0.05, 0.4), new THREE.MeshBasicMaterial({ color: 0xe9f3f6 }));
    line.position.y = 0.03;
    const court = new THREE.Group();
    court.add(red, blue, line);
    scene.add(court);
    return court;
}

export function createPotgStage(container, { onKill = null } = {}) {
    let renderer = null;
    let scene = null;
    let camera = null;
    let view = null;
    let ball = null;
    let court = null;
    let clock = null;
    let disposed = false;
    let snapped = false;
    const goal = new THREE.Vector3();

    const disposeTree = root => root?.traverse(child => {
        child.geometry?.dispose?.();
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose?.());
        else child.material?.dispose?.();
    });

    const ensure = () => {
        if (renderer || disposed || !container) return !!renderer;
        const width = Math.max(160, container.clientWidth || 320);
        const height = Math.max(90, container.clientHeight || 180);
        try {
            renderer = new THREE.WebGLRenderer({ antialias: true });
        } catch {
            return false;
        }
        renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
        renderer.setSize(width, height, false);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0b1220);
        scene.fog = new THREE.Fog(0x0b1220, 50, 140);
        camera = new THREE.PerspectiveCamera(60, width / height, 0.2, 400);
        scene.add(new THREE.HemisphereLight(0xdff6ff, 0x1a1420, 1.8));
        const sun = new THREE.DirectionalLight(0xfff3e0, 1.8);
        sun.position.set(20, 40, 10);
        scene.add(sun);
        ball = new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffa347 }));
        ball.visible = false;
        scene.add(ball);
        view = new ReplayView(scene);
        container.appendChild(renderer.domElement);
        return true;
    };

    const frame = (snapshot, focusName) => {
        if (!renderer || disposed) return;
        const actors = view.apply(snapshot);
        if (snapshot?.ball) {
            ball.visible = true;
            ball.position.set(snapshot.ball.x, snapshot.ball.y, snapshot.ball.z);
        }
        const focus = focusName ? actors.find(actor => actor.name === focusName) : null;
        const pose = potgCameraPose(focus ? { ...focus.group.position, yaw: focus.yaw } : null, snapshot?.ball);
        goal.set(pose.position.x, pose.position.y, pose.position.z);
        if (snapped) camera.position.lerp(goal, 0.25);
        else camera.position.copy(goal);
        snapped = true;
        camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
        renderer.render(scene, camera);
    };

    // clip: an extracted replay (events + duration); focus: the player's name.
    const play = (clip, { focus = '', court: courtSize = {} } = {}) => {
        if (!ensure()) return false;
        stop();
        if (court) {
            scene.remove(court);
            disposeTree(court);
        }
        court = buildCourt(scene, courtSize);
        view.clear();
        snapped = false;
        clock = new ReplayClass();
        clock.play(clip, {
            renderSnapshot: snapshot => frame(snapshot, focus),
            kill: data => onKill?.(data),
            complete: () => { clock = null; }
        });
        return true;
    };

    const stop = () => {
        clock?.stopPlayback();
        clock = null;
    };

    const dispose = () => {
        if (disposed) return;
        stop();
        disposed = true;
        view?.clear();
        disposeTree(scene);
        if (renderer) {
            renderer.dispose();
            renderer.domElement.remove();
        }
        renderer = scene = camera = view = ball = court = null;
    };

    return { play, stop, dispose, get playing() { return !!clock; } };
}
