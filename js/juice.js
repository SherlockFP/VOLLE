// juice.js — Game feel: hit-stop, screen shake, slow-mo, combo, particle bursts.
// ponytail: tek dosya, game.js/renderer.js/player.js'den çağrılır. En yüksek bağımlılık kaynağı.
import * as THREE from 'three';
import { TrailRibbon } from './TrailRibbon.js';

// Hit-stop: kısa süre dünya donar, impact'i vurgular.
// Screen shake: kamera sallanır.
// Slow-mo: timeScale düşer, dramatik anlar.
// Combo: üst üste deflect'ler çarpan artırır, UI'da gösterilir.
// Particles: hit/spawn/deflect patlamaları.

export class Juice {
    constructor(camera, renderer) {
        this.camera = camera;
        this.renderer = renderer;
        this.scene = renderer?.scene;

        // Hit-stop
        this.hitStopTimer = 0;
        this.hitStopDuration = 0;

        // Screen shake
        this.shakeAmt = 0;
        this.shakeDecay = 8;
        this.shakeOffset = new THREE.Vector3();

        // Slow-mo
        this.timeScale = 1;
        this.slowMoTimer = 0;
        this.slowMoTarget = 1;

        // Combo
        this.combo = 0;
        this.comboTimer = 0;
        this.comboDecay = 4; // saniye
        this.maxCombo = 0;

        // Dash trail ribbon
        this.dashRibbon = new TrailRibbon({ maxPoints: 30, fadeTime: 0.4, color: new THREE.Color(0x44ddff) });
        if (this.scene) this.scene.add(this.dashRibbon.mesh);

        // Particles (pool)
        this.particles = [];
        this.maxParticles = 200;

        // Flash
        this.flashAmt = 0;
        this.screenShakeEnabled = true;
        this.screenFlashEnabled = true;
        this.reducedMotion = false;
    }

    // Hit-stop: dünya N ms donar. Critical hit'lerde 80ms, normal 40ms.
    hitStop(ms = 40) {
        this.hitStopTimer = ms / 1000;
        this.hitStopDuration = ms / 1000;
    }

    // Screen shake: amt kadar kamera sallanır, eksponansiyel sönümlenir.
    shake(amt = 0.3) {
        if (!this.screenShakeEnabled || this.reducedMotion) return;
        this.shakeAmt = Math.max(this.shakeAmt, amt);
    }

    // Slow-mo: timeScale hedefe düşer, timer bitince 1'e geri döner.
    slowMo(scale = 0.3, duration = 0.6) {
        if (this.reducedMotion) return;
        this.slowMoTarget = scale;
        this.slowMoTimer = duration;
    }

    // Combo artır. Her deflect'te çağrılır. Çarpan hasarı/skoru etkiler.
    addCombo() {
        this.combo++;
        this.comboTimer = this.comboDecay;
        this.maxCombo = Math.max(this.maxCombo, this.combo);
        return this.combo;
    }

    resetCombo() {
        this.combo = 0;
        this.comboTimer = 0;
    }

    getComboMultiplier() {
        // 0 combo = 1x, 5 combo = 2x, 10+ = 3x
        return 1 + Math.min(2, this.combo * 0.2);
    }

    // Flash ekran (beyaz/kırmızı). Hit alınca.
    flash(amt = 0.5) {
        if (!this.screenFlashEnabled) return;
        this.flashAmt = Math.max(this.flashAmt, amt);
    }

    // Particle patlaması. pos: Vector3, color: hex, count: adet.
    burst(pos, color = 0xff8844, count = 12, speed = 8) {
        if (!this.scene) return;
        if (this.reducedMotion) count = Math.ceil(count * 0.35);
        for (let i = 0; i < count && this.particles.length < this.maxParticles; i++) {
            const size = 0.08 + Math.random() * 0.14;
            // ponytail: mixed shapes — cubes, spheres, and tetrahedrons for variety
            const shapeRoll = Math.random();
            let geo;
            if (shapeRoll > 0.7) {
                geo = new THREE.TetrahedronGeometry(size * 0.7);
            } else if (shapeRoll > 0.35) {
                geo = new THREE.BoxGeometry(size, size, size);
            } else {
                geo = new THREE.SphereGeometry(size * 0.6, 4, 4);
            }
            // ponytail: slight color variation per particle for richness
            const colorVar = new THREE.Color(color);
            colorVar.offsetHSL((Math.random() - 0.5) * 0.05, 0, (Math.random() - 0.5) * 0.1);
            const mat = new THREE.MeshBasicMaterial({
                color: colorVar,
                transparent: true,
                opacity: 1,
            });
            const p = new THREE.Mesh(geo, mat);
            p.position.copy(pos);
            const angle = Math.random() * Math.PI * 2;
            const elevation = (Math.random() - 0.3) * Math.PI;
            const spd = speed * (0.5 + Math.random() * 0.5);
            const vel = new THREE.Vector3(
                Math.cos(angle) * Math.cos(elevation) * spd,
                Math.sin(elevation) * spd * 0.7 + 3,
                Math.sin(angle) * Math.cos(elevation) * spd
            );
            this.scene.add(p);
            this.particles.push({ mesh: p, vel, life: 0.6 + Math.random() * 0.4, maxLife: 1 });
        }
    }

    hitBurst(pos) {
        this.burst(pos, 0xffaa44, 20, 12);
        this.shake(0.35);
        this.sparks(pos, 0xffee44, 6);
    }

    killBurst(pos) {
        // ponytail: layered burst — red core + orange ring + gold sparks
        this.burst(pos, 0xff3333, 35, 16);
        this.burst(pos.clone().add(new THREE.Vector3(0, 0.5, 0)), 0xffaa00, 20, 10);
        this.burst(pos.clone().add(new THREE.Vector3(0, 0.3, 0)), 0xffdd44, 12, 8);
        this.sparks(pos, 0xff6644, 12);
        this.shake(0.7);
        this.slowMo(0.25, 0.5);
    }

    // Spark patlaması — ince uzun çizgiler (deflect anı).
    sparks(pos, color = 0xffee44, count = 8) {
        if (!this.scene) return;
        for (let i = 0; i < count && this.particles.length < this.maxParticles; i++) {
            const geo = new THREE.CylinderGeometry(0.02, 0.02, 0.6, 4);
            const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
            const p = new THREE.Mesh(geo, mat);
            p.position.copy(pos);
            const vel = new THREE.Vector3(
                (Math.random() - 0.5) * 14,
                Math.random() * 10 + 3,
                (Math.random() - 0.5) * 14
            );
            this.scene.add(p);
            this.particles.push({ mesh: p, vel, life: 0.4, maxLife: 0.4, gravity: -8, spark: true });
        }
    }

    // Ring shockwave — yatay genişleyen halka (spike/impact).
    shockwave(pos, color = 0xff8844) {
        if (!this.scene) return;
        const geo = new THREE.RingGeometry(0.3, 0.5, 24);
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
        const ring = new THREE.Mesh(geo, mat);
        ring.position.copy(pos);
        ring.rotation.x = -Math.PI / 2;
        this.scene.add(ring);
        this.particles.push({ mesh: ring, vel: new THREE.Vector3(), life: 0.5, maxLife: 0.5, gravity: 0, ring: true, scaleRate: 20 });
        // ponytail: secondary smaller ring for layered effect
        const geo2 = new THREE.RingGeometry(0.2, 0.35, 16);
        const mat2 = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
        const ring2 = new THREE.Mesh(geo2, mat2);
        ring2.position.copy(pos);
        ring2.rotation.x = -Math.PI / 2;
        this.scene.add(ring2);
        this.particles.push({ mesh: ring2, vel: new THREE.Vector3(), life: 0.35, maxLife: 0.35, gravity: 0, ring: true, scaleRate: 15 });
    }

    // Genji-tarzı deflect slash — dikey yarım halka, hızla genişler ve solar
    slashEffect(pos, dir, color = 0x00ffee) {
        if (!this.scene) return;
        const geo = new THREE.RingGeometry(0.4, 0.7, 16, 1, 0, Math.PI);
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
        const arc = new THREE.Mesh(geo, mat);
        arc.position.copy(pos);
        // Hedefe baksın
        if (dir) arc.lookAt(pos.clone().add(dir));
        else arc.rotation.x = -Math.PI / 2;
        this.scene.add(arc);
        this.particles.push({ mesh: arc, vel: new THREE.Vector3(), life: 0.35, maxLife: 0.35, gravity: 0, ring: true, scaleRate: 12 });
    }

    // Dash trail — hızlı hareket izi
    dashTrail(pos, dir, color = 0x44ddff) {
        if (!this.scene) return;
        this.dashRibbon.setColor(new THREE.Color(color));
        for (let i = 0; i < 8; i++) {
            const p = pos.clone().add(dir.clone().multiplyScalar(-i * 0.25));
            this.dashRibbon.addPoint(p, 0.3 - i * 0.03);
        }
    }

    // Ana update — her frame çağrılır. dt: gerçek delta time.
    // Returns: effectiveDt (slow-mo + hit-stop uygulanmış delta).
    update(dt) {
        // Dash ribbon fade
        this.dashRibbon?.update(dt);

        // Hit-stop: süre dolana kadar time'ı dondur
        if (this.hitStopTimer > 0) {
            this.hitStopTimer -= dt;
            return 0; // dünya donar
        }

        // Slow-mo: timeScale'i hedefe yumuşakça götür
        if (this.slowMoTimer > 0) {
            this.slowMoTimer -= dt;
            this.timeScale += (this.slowMoTarget - this.timeScale) * 0.15;
            if (this.slowMoTimer <= 0) this.slowMoTarget = 1;
        } else {
            this.timeScale += (1 - this.timeScale) * 0.1;
        }
        const effectiveDt = dt * this.timeScale;

        // Screen shake — kamera offset
        if (this.shakeAmt > 0.001) {
            this.shakeOffset.set(
                (Math.random() - 0.5) * this.shakeAmt,
                (Math.random() - 0.5) * this.shakeAmt,
                (Math.random() - 0.5) * this.shakeAmt
            );
            if (this.camera) this.camera.position.add(this.shakeOffset);
            this.shakeAmt *= Math.exp(-this.shakeDecay * dt);
        } else if (this.shakeOffset.lengthSq() > 0 && this.camera) {
            // ponytail: shake bitince offset'i geri çıkar (kaymasın)
            this.camera.position.sub(this.shakeOffset);
            this.shakeOffset.set(0, 0, 0);
        }

        // Combo decay
        if (this.comboTimer > 0) {
            this.comboTimer -= dt;
            if (this.comboTimer <= 0) this.resetCombo();
        }

        // Flash decay
        if (this.flashAmt > 0) this.flashAmt = Math.max(0, this.flashAmt - dt * 3);

        // Particles
        this.updateParticles(effectiveDt);

        return effectiveDt;
    }

    updateParticles(dt) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.life -= dt;
            if (p.ring) {
                const s = 1 + (1 - p.life / p.maxLife) * p.scaleRate;
                p.mesh.scale.setScalar(s);
                p.mesh.material.opacity = Math.max(0, p.life / p.maxLife);
            } else {
                p.vel.y += (p.gravity || -12) * dt;
                p.mesh.position.add(p.vel.clone().multiplyScalar(dt));
                p.mesh.material.opacity = Math.max(0, p.life / p.maxLife);
                if (p.spark) {
                    // spark'lar velocity yönüne dönsün
                    p.mesh.lookAt(p.mesh.position.clone().add(p.vel));
                } else {
                    p.mesh.scale.setScalar(Math.max(0.1, p.life / p.maxLife));
                }
                if (p.mesh.position.y < 0) { p.vel.y *= -0.3; p.mesh.position.y = 0; }
            }
            if (p.life <= 0) {
                this.scene.remove(p.mesh);
                p.mesh.geometry.dispose();
                p.mesh.material.dispose();
                this.particles.splice(i, 1);
            }
        }
    }

    updateVignette(playerHp, playerMaxHp) {
        if (!this.renderer) return;
        const hpPct = playerHp / playerMaxHp;
        const intensity = hpPct < 0.3 ? (0.3 - hpPct) * 5 : 0;
        this.renderer.setVignette(intensity);
    }

    // Combo UI için durum
    getComboState() {
        return { combo: this.combo, multiplier: this.getComboMultiplier(), timer: this.comboTimer, max: this.maxCombo };
    }

    reset() {
        this.hitStopTimer = 0;
        this.shakeAmt = 0;
        this.timeScale = 1;
        this.slowMoTimer = 0;
        this.slowMoTarget = 1;
        this.resetCombo();
        this.flashAmt = 0;
        this.particles.forEach(p => {
            this.scene?.remove(p.mesh);
            p.mesh.geometry.dispose();
            p.mesh.material.dispose();
        });
        this.particles = [];
    }
}
