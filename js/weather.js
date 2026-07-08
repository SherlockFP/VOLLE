// weather.js — Rain, snow, and storm (rain + lightning) particle system.
import * as THREE from 'three';

export class WeatherSystem {
    constructor(scene, arenaBounds) {
        this.scene = scene;
        this.bounds = arenaBounds;
        this.maxY = arenaBounds.maxY || 30;
        this.type = 'none';
        this.group = new THREE.Group();
        this.scene.add(this.group);

        // Rain state
        this.rainCount = 3000;
        this.rainGeo = null;
        this.rainMat = null;
        this.rainMesh = null;
        this.rainSpeeds = null;

        // Snow state
        this.snowCount = 1200;
        this.snowGeo = null;
        this.snowMat = null;
        this.snowMesh = null;

        // Lightning state
        this.lightningMesh = null;
        this.lightningTimer = 0;
        this.lightningInterval = 3 + Math.random() * 5;
        this.flashIntensity = 0;
        this._thunderPlayed = false;
        this._thunderCtx = null;
    }

    setWeather(type) {
        this.clear();
        this.type = type;
        if (type === 'rain' || type === 'storm') this._initRain();
        if (type === 'snow') this._initSnow();
        if (type === 'storm') this._initLightning();
    }

    _initRain() {
        const count = this.rainCount;
        const positions = new Float32Array(count * 2 * 3); // 2 verts per streak
        this.rainSpeeds = new Float32Array(count);
        const b = this.bounds;

        for (let i = 0; i < count; i++) {
            const x = b.minX + Math.random() * (b.maxX - b.minX);
            const z = b.minZ + Math.random() * (b.maxZ - b.minZ);
            const y = Math.random() * this.maxY;
            const len = 0.3 + Math.random() * 0.4;
            const i6 = i * 6;
            positions[i6] = x;
            positions[i6 + 1] = y;
            positions[i6 + 2] = z;
            positions[i6 + 3] = x;
            positions[i6 + 4] = y + len;
            positions[i6 + 5] = z;
            this.rainSpeeds[i] = 35 + Math.random() * 15;
        }

        this.rainGeo = new THREE.BufferGeometry();
        this.rainGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        this.rainMat = new THREE.LineBasicMaterial({
            color: 0x8899cc, transparent: true, opacity: 0.5
        });
        this.rainMesh = new THREE.LineSegments(this.rainGeo, this.rainMat);
        this.group.add(this.rainMesh);
    }

    _initSnow() {
        const count = this.snowCount;
        const positions = new Float32Array(count * 3);
        const b = this.bounds;

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            positions[i3] = b.minX + Math.random() * (b.maxX - b.minX);
            positions[i3 + 1] = Math.random() * this.maxY;
            positions[i3 + 2] = b.minZ + Math.random() * (b.maxZ - b.minZ);
        }

        this.snowGeo = new THREE.BufferGeometry();
        this.snowGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        this.snowMat = new THREE.PointsMaterial({
            color: 0xffffff, size: 0.2, transparent: true, opacity: 0.85,
            blending: THREE.AdditiveBlending
        });
        this.snowMesh = new THREE.Points(this.snowGeo, this.snowMat);
        this.group.add(this.snowMesh);
    }

    _initLightning() {
        const geo = new THREE.PlaneGeometry(300, 300);
        const mat = new THREE.MeshBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0,
            depthWrite: false, side: THREE.DoubleSide
        });
        this.lightningMesh = new THREE.Mesh(geo, mat);
        this.lightningMesh.position.set(0, this.maxY / 2, 0);
        this.lightningMesh.renderOrder = 999;
        this.group.add(this.lightningMesh);

        this.lightningTimer = 0;
        this.lightningInterval = 3 + Math.random() * 5;
        this.flashIntensity = 0;
        this._thunderPlayed = false;
    }

    update(dt, time) {
        if (this.type === 'none') return;

        if (this.type === 'rain' || this.type === 'storm') this._updateRain(dt);
        if (this.type === 'snow') this._updateSnow(dt, time);
        if (this.type === 'storm') this._updateLightning(dt, time);
    }

    _updateRain(dt) {
        if (!this.rainGeo) return;
        const pos = this.rainGeo.attributes.position.array;
        const b = this.bounds;

        for (let i = 0; i < this.rainCount; i++) {
            const i6 = i * 6;
            pos[i6 + 1] -= this.rainSpeeds[i] * dt;
            pos[i6 + 4] -= this.rainSpeeds[i] * dt;

            if (pos[i6 + 1] < 0) {
                const x = b.minX + Math.random() * (b.maxX - b.minX);
                const z = b.minZ + Math.random() * (b.maxZ - b.minZ);
                const len = 0.3 + Math.random() * 0.4;
                const y = this.maxY + Math.random() * 5;
                pos[i6] = x;
                pos[i6 + 1] = y;
                pos[i6 + 2] = z;
                pos[i6 + 3] = x;
                pos[i6 + 4] = y + len;
                pos[i6 + 5] = z;
            }
        }
        this.rainGeo.attributes.position.needsUpdate = true;
    }

    _updateSnow(dt, time) {
        if (!this.snowGeo) return;
        const pos = this.snowGeo.attributes.position.array;
        const b = this.bounds;

        for (let i = 0; i < this.snowCount; i++) {
            const i3 = i * 3;
            pos[i3 + 1] -= (2 + (i % 3)) * dt;
            pos[i3] += Math.sin(time * 1.5 + i * 0.7) * dt * 0.8;
            pos[i3 + 2] += Math.cos(time * 1.2 + i * 0.5) * dt * 0.6;

            if (pos[i3 + 1] < 0) {
                pos[i3] = b.minX + Math.random() * (b.maxX - b.minX);
                pos[i3 + 1] = this.maxY + Math.random() * 3;
                pos[i3 + 2] = b.minZ + Math.random() * (b.maxZ - b.minZ);
            }
        }
        this.snowGeo.attributes.position.needsUpdate = true;
    }

    _updateLightning(dt, time) {
        if (!this.lightningMesh) return;

        // Fade out ongoing flash
        if (this.flashIntensity > 0) {
            this.flashIntensity -= dt * 5;
            if (this.flashIntensity < 0) this.flashIntensity = 0;
            this.lightningMesh.material.opacity = this.flashIntensity;

            if (this.flashIntensity > 0.3 && !this._thunderPlayed) {
                this._thunderPlayed = true;
                this._playThunder();
            }
        }

        this.lightningTimer += dt;
        if (this.lightningTimer >= this.lightningInterval) {
            this.flashIntensity = 1;
            this.lightningMesh.material.opacity = 1;
            this.lightningTimer = 0;
            this.lightningInterval = 3 + Math.random() * 5;
            this._thunderPlayed = false;
        }
    }

    _playThunder() {
        try {
            if (!this._thunderCtx) {
                this._thunderCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            const ctx = this._thunderCtx;
            const sr = ctx.sampleRate;
            const duration = 0.8;
            const len = Math.floor(sr * duration);
            const buf = ctx.createBuffer(1, len, sr);
            const data = buf.getChannelData(0);
            for (let i = 0; i < len; i++) {
                const t = i / sr;
                const noise = Math.random() * 2 - 1;
                const envelope = Math.exp(-t * 4) * (1 - Math.exp(-t * 30));
                data[i] = noise * envelope * 0.3;
            }
            const source = ctx.createBufferSource();
            source.buffer = buf;
            const gain = ctx.createGain();
            gain.gain.value = 0.06;
            source.connect(gain);
            gain.connect(ctx.destination);
            source.start();
        } catch (_) { /* audio unavailable */ }
    }

    clear() {
        // Remove all children from group, disposing geometries and materials
        for (let i = this.group.children.length - 1; i >= 0; i--) {
            const child = this.group.children[i];
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
            this.group.remove(child);
        }
        this.rainGeo = null;
        this.rainMat = null;
        this.rainMesh = null;
        this.rainSpeeds = null;
        this.snowGeo = null;
        this.snowMat = null;
        this.snowMesh = null;
        this.lightningMesh = null;
        this.flashIntensity = 0;
        this.lightningTimer = 0;
        this.type = 'none';
        // Close audio context if it was created
        if (this._thunderCtx) {
            this._thunderCtx.close().catch(() => {});
            this._thunderCtx = null;
        }
    }
}
