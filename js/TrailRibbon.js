import * as THREE from 'three';

export class TrailRibbon {
    constructor(options = {}) {
        this.maxPoints = options.maxPoints || 100;
        this.fadeTime = options.fadeTime || 1.0;
        this.color = options.color || new THREE.Color(1, 1, 1);
        this.texture = options.texture || null;
        this.doubleSide = options.doubleSide !== undefined ? options.doubleSide : true;
        this.billboard = options.billboard || false;
        this.normalAngle = (options.normalAngle || 0) * Math.PI / 180;
        this.camera = null;
        this.points = [];
        this._initGeometry();
        this._initMaterial();
        this._initMesh();
    }

    _initGeometry() {
        this.geometry = new THREE.BufferGeometry();
        const maxVertices = this.maxPoints * 2;
        const maxTriangles = (this.maxPoints - 1) * 2;
        this.positions = new Float32Array(maxVertices * 3);
        this.uvs = new Float32Array(maxVertices * 2);
        this.colors = new Float32Array(maxVertices * 4);
        this.indices = new Uint32Array(maxTriangles * 3);
        this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
        this.geometry.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2));
        this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 4));
        this.geometry.setIndex(new THREE.BufferAttribute(this.indices, 1));
        this.geometry.setDrawRange(0, 0);
    }

    _initMaterial() {
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uTexture: { value: this.texture },
                uUseTexture: { value: this.texture !== null },
                uBaseColor: { value: this.color }
            },
            vertexShader: `
                attribute vec4 color;
                varying vec2 vUv;
                varying vec4 vColor;
                void main() {
                    vUv = uv;
                    vColor = color;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D uTexture;
                uniform bool uUseTexture;
                uniform vec3 uBaseColor;
                varying vec2 vUv;
                varying vec4 vColor;
                void main() {
                    vec4 texColor = uUseTexture ? texture2D(uTexture, vUv) : vec4(1.0);
                    vec3 finalColor = uBaseColor * vColor.rgb * texColor.rgb;
                    float finalAlpha = vColor.a * texColor.a;
                    if (finalAlpha < 0.01) discard;
                    gl_FragColor = vec4(finalColor, finalAlpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            side: this.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
            blending: THREE.NormalBlending
        });
    }

    _initMesh() {
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.frustumCulled = false;
    }

    addPoint(position, width) {
        const point = { position: position.clone(), width: width, age: 0 };
        this.points.push(point);
        if (this.points.length > this.maxPoints) this.points.shift();
        this._updateGeometry();
    }

    update(deltaTime) {
        if (this.points.length === 0) return;
        for (let i = 0; i < this.points.length; i++) this.points[i].age += deltaTime;
        while (this.points.length > 0 && this.points[0].age >= this.fadeTime) this.points.shift();
        this._updateGeometry();
    }

    setCamera(camera) { this.camera = camera; }

    _updateGeometry() {
        const numPoints = this.points.length;
        if (numPoints < 2) { this.geometry.setDrawRange(0, 0); return; }
        const tempVec = new THREE.Vector3();
        const perpVec = new THREE.Vector3();
        const upVec = new THREE.Vector3(0, 1, 0);
        const cameraDir = new THREE.Vector3();
        for (let i = 0; i < numPoints; i++) {
            const point = this.points[i];
            const pos = point.position;
            if (i < numPoints - 1) tempVec.subVectors(this.points[i + 1].position, pos);
            else tempVec.subVectors(pos, this.points[i - 1].position);
            tempVec.normalize();
            if (this.billboard && this.camera) {
                cameraDir.subVectors(this.camera.position, pos).normalize();
                perpVec.crossVectors(tempVec, cameraDir).normalize();
                if (perpVec.lengthSq() < 0.01) perpVec.crossVectors(tempVec, upVec).normalize();
            } else {
                perpVec.crossVectors(tempVec, upVec).normalize();
                if (perpVec.lengthSq() < 0.01) perpVec.crossVectors(tempVec, new THREE.Vector3(1, 0, 0)).normalize();
                if (this.normalAngle !== 0) {
                    const q = new THREE.Quaternion();
                    q.setFromAxisAngle(tempVec, this.normalAngle);
                    perpVec.applyQuaternion(q);
                }
            }
            const halfWidth = point.width * 0.5;
            const li = i * 2, ri = i * 2 + 1;
            this.positions[li * 3] = pos.x - perpVec.x * halfWidth;
            this.positions[li * 3 + 1] = pos.y - perpVec.y * halfWidth;
            this.positions[li * 3 + 2] = pos.z - perpVec.z * halfWidth;
            this.positions[ri * 3] = pos.x + perpVec.x * halfWidth;
            this.positions[ri * 3 + 1] = pos.y + perpVec.y * halfWidth;
            this.positions[ri * 3 + 2] = pos.z + perpVec.z * halfWidth;
            const u = i / (numPoints - 1);
            this.uvs[li * 2] = u; this.uvs[li * 2 + 1] = 0;
            this.uvs[ri * 2] = u; this.uvs[ri * 2 + 1] = 1;
            const alpha = Math.max(0, Math.min(1, 1.0 - point.age / this.fadeTime));
            this.colors[li * 4] = 1; this.colors[li * 4 + 1] = 1; this.colors[li * 4 + 2] = 1; this.colors[li * 4 + 3] = alpha;
            this.colors[ri * 4] = 1; this.colors[ri * 4 + 1] = 1; this.colors[ri * 4 + 2] = 1; this.colors[ri * 4 + 3] = alpha;
        }
        let idx = 0;
        for (let i = 0; i < numPoints - 1; i++) {
            const bl = i * 2, br = i * 2 + 1, tl = (i + 1) * 2, tr = (i + 1) * 2 + 1;
            this.indices[idx++] = bl; this.indices[idx++] = tl; this.indices[idx++] = br;
            this.indices[idx++] = br; this.indices[idx++] = tl; this.indices[idx++] = tr;
        }
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.uv.needsUpdate = true;
        this.geometry.attributes.color.needsUpdate = true;
        this.geometry.index.needsUpdate = true;
        this.geometry.setDrawRange(0, (numPoints - 1) * 6);
        this.geometry.computeBoundingSphere();
    }

    setColor(color) { this.color = color; this.material.uniforms.uBaseColor.value = color; }
    clear() { this.points = []; this.geometry.setDrawRange(0, 0); }
    dispose() { this.geometry.dispose(); this.material.dispose(); if (this.texture) this.texture.dispose(); }
}

export default TrailRibbon;
