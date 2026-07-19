// renderer.js — Three.js setup + toon material factory + bloom post-processing
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { toonVertexShader, outlineVertexShader } from './shaders/toon.vert.js';
import { toonFragmentShader, outlineFragmentShader } from './shaders/toon.frag.js';

export class Renderer {
    constructor(container) {
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.setClearColor(0x6fdfd9);
        container.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.Fog(0x6fdfd9, 60, 180);

        // Main light
        this.sun = new THREE.DirectionalLight(0xfff4e6, 1.8);
        this.sun.position.set(15, 30, 10);
        this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(2048, 2048);
        this.sun.shadow.camera.near = 0.5;
        this.sun.shadow.camera.far = 120;
        this.sun.shadow.camera.left = -40;
        this.sun.shadow.camera.right = 40;
        this.sun.shadow.camera.top = 40;
        this.sun.shadow.camera.bottom = -40;
        this.scene.add(this.sun);

        this.scene.add(new THREE.AmbientLight(0x8899cc, 0.6));

        // Hemisphere light — soft sky/ground bounce for a plush cartoon look
        this.scene.add(new THREE.HemisphereLight(0xbfe6ff, 0xffd8a8, 0.45));

        // Bloom post-processing — lazy-init on first render with camera
        this._composer = null;
        this._camera = null;
        this._bloom = null;
        this._quality = 'medium';
        this._qualityPixelRatioCap = 1.5;
        this._renderScale = 1;
        this._targetResolution = null;
        this._viewport = { width: window.innerWidth, height: window.innerHeight };
    }

    _initComposer(camera) {
        if (this._composer) return;
        this._camera = camera;
        this._composer = new EffectComposer(this.renderer);
        this._composer.addPass(new RenderPass(this.scene, camera));
        // ponytail: reduced bloom so center-screen glow doesn't trail the mouse
        const bloom = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            0.08,  // strength (was 0.15)
            0.3,  // radius
            0.3   // threshold (was 0.1 — only bright things bloom)
        );
        this._bloom = bloom;
        this._composer.addPass(bloom);
        this._composer.addPass(new OutputPass());
        this.setQuality(this._quality);
    }

    // Public so main.js can call composer.setSize on window resize
    updateSize(w, h) {
        this._viewport.width = Math.max(1, w);
        this._viewport.height = Math.max(1, h);
        this._applyPixelRatio();
        this.renderer.setSize(w, h);
        this._composer?.setSize(w, h);
    }

    setResolutionTarget(width, height) {
        this._targetResolution = Number.isFinite(width) && Number.isFinite(height)
            ? { width: Math.max(320, width), height: Math.max(240, height) }
            : null;
        this._applyPixelRatio();
        this.updateSize(this._viewport.width, this._viewport.height);
    }

    setRenderScale(scale = 1) {
        this._renderScale = Math.min(1.5, Math.max(0.5, Number(scale) || 1));
        this._applyPixelRatio();
        this.updateSize(this._viewport.width, this._viewport.height);
    }

    _applyPixelRatio() {
        const targetRatio = this._targetResolution
            ? Math.min(
                this._targetResolution.width / this._viewport.width,
                this._targetResolution.height / this._viewport.height
            )
            : window.devicePixelRatio;
        const ratio = Math.min(this._qualityPixelRatioCap, targetRatio * this._renderScale);
        this.renderer.setPixelRatio(Math.max(0.1, ratio));
    }

    bloomStrength(v) {
        // Find the bloom pass and update strength
        if (!this._composer) return;
        for (const p of this._composer.passes) {
            if (p instanceof UnrealBloomPass) p.strength = v;
        }
    }

    setQuality(quality = 'medium') {
        this._quality = ['low', 'medium', 'high'].includes(quality) ? quality : 'medium';
        const config = {
            low: { pixelRatio: 1, shadows: false, bloom: 0 },
            medium: { pixelRatio: 1.5, shadows: true, bloom: 0.05 },
            high: { pixelRatio: 2, shadows: true, bloom: 0.08 }
        }[this._quality];
        this._qualityPixelRatioCap = config.pixelRatio;
        this._applyPixelRatio();
        this.renderer.shadowMap.enabled = config.shadows;
        if (this._bloom) this._bloom.strength = config.bloom;
    }

    createToonMaterial(color) {
        return new THREE.ShaderMaterial({
            vertexShader: toonVertexShader,
            fragmentShader: toonFragmentShader,
            uniforms: {
                uColor: { value: new THREE.Color(color) },
                uLightDir: { value: new THREE.Vector3(0.5, 1.0, 0.3).normalize() },
                uRimPower: { value: 5.0 }
            }
        });
    }

    createOutlineMesh(geometry, scale = 1.05) {
        const mat = new THREE.ShaderMaterial({
            vertexShader: outlineVertexShader,
            fragmentShader: outlineFragmentShader,
            uniforms: { outlineThickness: { value: 0.055 } },
            side: THREE.BackSide
        });
        const mesh = new THREE.Mesh(geometry, mat);
        mesh.scale.setScalar(scale);
        return mesh;
    }

    render(camera) {
        this._initComposer(camera);
        this._composer.render();
        if (this._vignetteScene && this._vignetteMesh?.material.uniforms.uIntensity.value > 0.01) {
            this.renderer.autoClear = false;
            this.renderer.clearDepth();
            this.renderer.render(this._vignetteScene, this._vignetteCam);
            this.renderer.autoClear = true;
        }
    }

    _initVignette() {
        if (this._vignetteMesh) return;
        const geo = new THREE.PlaneGeometry(2, 2);
        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uIntensity: { value: 0 },
                uColor: { value: new THREE.Color(0xff0000) },
            },
            vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position,1.0); }`,
            fragmentShader: `
                varying vec2 vUv;
                uniform float uIntensity;
                uniform vec3 uColor;
                void main(){
                    vec2 center = vUv - 0.5;
                    float dist = length(center);
                    float vig = smoothstep(0.3, 0.8, dist) * uIntensity;
                    gl_FragColor = vec4(uColor, vig);
                }`,
            transparent: true,
            depthTest: false,
            depthWrite: false,
        });
        this._vignetteMesh = new THREE.Mesh(geo, mat);
        this._vignetteMesh.frustumCulled = false;
        this._vignetteScene = new THREE.Scene();
        this._vignetteScene.add(this._vignetteMesh);
        this._vignetteCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    }

    setVignette(intensity) {
        this._initVignette();
        if (this._vignetteMesh) this._vignetteMesh.material.uniforms.uIntensity.value = intensity;
    }

    get domElement() {
        return this.renderer.domElement;
    }
}
