// chaos.js — Eglence/Chaos ozellikleri: tornado hazard, gravity flip, chaos round
import * as THREE from 'three';

export class ChaosManager {
    constructor(arena, scene) {
        this.arena = arena;
        this.scene = scene;
        this.tornadoes = [];
        this.gravityFlipTimer = 0;
        this.gravityFlipped = false;
        this.active = false;
    }

    startRound() {
        this.clear();
        this.active = true;
    }

    clear() {
        for (const t of this.tornadoes) {
            this.scene.remove(t.mesh);
            t.mesh.geometry.dispose();
            t.mesh.material.dispose();
        }
        this.tornadoes = [];
        if (this.gravityFlipped) this.flipGravity(false);
        this.gravityFlipTimer = 0;
        this.active = false;
    }

    updateGravityFlip(dt, game) {
        this.gravityFlipTimer += dt;
        if (this.gravityFlipTimer >= 30) {
            this.gravityFlipTimer = 0;
            this.flipGravity(!this.gravityFlipped, game);
        }
    }

    flipGravity(flipped, game) {
        this.gravityFlipped = flipped;
        const g = flipped ? 14 : -14;
        if (game?.ball) game.ball.gravity = g;
        if (game?.player) game.player.gravity = g;
        game?.bots?.forEach(b => { b.gravity = g; });
        if (game?.ui) game.ui.showMessage?.(flipped ? '🔄 GRAVITY FLIPPED!' : '🔄 Gravity normal', 2000);
    }

    spawnTornado() {
        const b = this.arena.bounds;
        const x = b.minX + 5 + Math.random() * (b.maxX - b.minX - 10);
        const z = b.minZ + 5 + Math.random() * (b.maxZ - b.minZ - 10);
        const radius = 4 + Math.random() * 3;
        const strength = 25 + Math.random() * 20;
        const life = 10 + Math.random() * 8;

        const geo = new THREE.ConeGeometry(radius * 0.3, 8, 12, 1, true);
        const mat = new THREE.MeshBasicMaterial({ color: 0x88aaff, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, 4, z);
        this.scene.add(mesh);

        this.tornadoes.push({ mesh, x, z, radius, strength, life, age: 0, rotation: 0 });
    }

    updateTornadoes(dt, ball) {
        for (let i = this.tornadoes.length - 1; i >= 0; i--) {
            const t = this.tornadoes[i];
            t.life -= dt;
            t.rotation += dt * 5;
            t.mesh.rotation.y = t.rotation;
            const fade = Math.min(1, t.life / 3);
            t.mesh.material.opacity = 0.3 * fade;

            if (ball?.active) {
                const dx = t.x - ball.position.x;
                const dz = t.z - ball.position.z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                if (dist < t.radius && dist > 0.1) {
                    const force = (1 - dist / t.radius) * t.strength * dt;
                    const angle = Math.atan2(dz, dx) + Math.PI / 2;
                    ball.velocity.x += Math.cos(angle) * force;
                    ball.velocity.z += Math.sin(angle) * force;
                    ball.velocity.y += force * 0.3;
                }
            }

            if (t.life <= 0) {
                this.scene.remove(t.mesh);
                t.mesh.geometry.dispose();
                t.mesh.material.dispose();
                this.tornadoes.splice(i, 1);
            }
        }
    }

    maybeSpawnTornado(dt, chancePerSec = 0.05) {
        if (!this.active) return;
        if (Math.random() < chancePerSec * dt && this.tornadoes.length < 3) {
            this.spawnTornado();
        }
    }

    update(dt, game) {
        if (!this.active) return;
        this.updateGravityFlip(dt, game);
        this.updateTornadoes(dt, game?.ball);
        this.maybeSpawnTornado(dt);
    }
}

export const CHAOS_MODES = {
    pinball: {
        id: 'pinball', name: 'Pinball', emoji: '🎰',
        desc: 'Super elastik duvarlar, top cikamiyor, hiz katlanir!',
        mutators: { ballSpeedMul: 1.5, speedRampMul: 1.5, pinballBounce: true }
    },
    tornado: {
        id: 'tornado', name: 'Tornado', emoji: '🌪️',
        desc: 'Courtta donen hortumlar topu cekip firlatir!',
        mutators: {}
    },
    gravity_flip: {
        id: 'gravity_flip', name: 'Gravity Flip', emoji: '🔄',
        desc: 'Her 30 saniyede gravity terst olur!',
        mutators: {}
    },
    chaos: {
        id: 'chaos', name: 'Chaos', emoji: '🎪',
        desc: '3 random affix + tornado + gravity flip. Tam kaos!',
        mutators: {}
    }
};

export const CHAOS_AFFIXES = [
    {
        id: 'split',
        name: '✂️ Split',
        color: 0x44ff88,
        desc: 'Ball splits into 2 on deflect (second ball half speed, 5s life)',
        apply(ball) {
            ball._affixTrailColor = 0x44ff88;
            ball._affixGlowColor = 0x22cc66;
            ball._affixSplit = true;
        }
    },
    {
        id: 'shrink',
        name: '📉 Shrink',
        color: 0xff44aa,
        desc: 'Ball shrinks over time, gets faster as it shrinks',
        apply(ball) {
            ball._affixTrailColor = 0xff44aa;
            ball._affixGlowColor = 0xff3388;
            ball._affixShrink = true;
        }
    },
    {
        id: 'grow',
        name: '📈 Grow',
        color: 0x44aaff,
        desc: 'Ball grows over time, gets slower as it grows',
        apply(ball) {
            ball._affixTrailColor = 0x44aaff;
            ball._affixGlowColor = 0x3388dd;
            ball._affixGrow = true;
        }
    }
];
