// Finisher fragment shader — four skin-specific looks selected by uVariant
export const finisherFragmentShader = `
uniform float uTime;
uniform float uProgress;
uniform float uIntensity;
uniform int uVariant;
uniform vec3 uColor;

varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec2 vUv;
varying float vRadius;

// --- inline noise (no external GLSL lib; a hash + value noise is all this needs) ---
float hash11(float p) {
    return fract(sin(p * 127.1) * 43758.5453123);
}

float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float hash31(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}

float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash31(i + vec3(0.0, 0.0, 0.0));
    float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
    return mix(
        mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
        mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
        f.z
    );
}

float fbm(vec3 p) {
    return vnoise(p) * 0.5 + vnoise(p * 2.03) * 0.25 + vnoise(p * 4.01) * 0.125;
}

void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    // Fresnel rim — shared by every variant, each uses it differently.
    float fresnel = 1.0 - max(dot(viewDir, normal), 0.0);

    vec3 col = uColor;
    float alpha = 0.0;

    if (uVariant == 0) {
        // ===== dark-eater: void implosion =====
        // A growing black core swallows the shell; only a violet rim survives.
        float core = smoothstep(0.15, 0.75, uProgress);
        float rim = pow(fresnel, 2.2);
        // Streaks dragged inward as progress rises.
        float streak = fbm(normal * 5.0 + vec3(0.0, 0.0, -uProgress * 4.0));
        float swallow = 1.0 - core * (1.0 - rim);
        col = uColor * (rim * 2.4 + streak * 0.35) * swallow;
        // Dark core: subtract luminance so it reads as absence of light, not fog.
        col -= vec3(core * (1.0 - rim) * 0.6);
        col = max(col, vec3(0.0));
        alpha = clamp(rim * 1.6 + core * 0.55 + streak * 0.2, 0.0, 1.0);
    } else if (uVariant == 1) {
        // ===== crimson-blade: blood burst =====
        // Angular wedges of hot shard, white at the core, red at the tips.
        float ang = atan(vWorldPos.z - 0.0, vWorldPos.x - 0.0);
        float wedge = hash11(floor(ang * 6.0) + floor(vUv.y * 5.0) * 13.0);
        float shard = step(0.35, wedge);
        float coreFall = 1.0 - smoothstep(0.0, 0.9, uProgress);
        vec3 hot = mix(uColor, vec3(1.0, 0.95, 0.9), coreFall * 0.85);
        // Spatter droplets thrown off the leading edge.
        float spatter = step(0.72, fbm(normal * 9.0 + uTime * 1.5));
        col = hot * (0.7 + shard * 1.5 + spatter * 1.2) * (0.5 + fresnel);
        alpha = clamp((shard * 0.75 + spatter * 0.6 + fresnel * 0.5) * (1.0 - uProgress * 0.7), 0.0, 1.0);
    } else if (uVariant == 2) {
        // ===== cyber-nexus: digital dissolve =====
        // Grid quantisation + scanlines + horizontal glitch bands.
        vec2 grid = floor(vUv * 40.0) / 40.0;
        float band = floor(vUv.y * 18.0);
        float glitch = step(0.78, hash21(vec2(band, floor(uTime * 14.0))));
        vec2 guv = vUv + vec2(glitch * (hash11(band) - 0.5) * 0.25, 0.0);
        float scan = 0.55 + 0.45 * sin(guv.y * 160.0 - uTime * 22.0);
        // Dissolve: quantised cells vanish once their threshold passes uProgress.
        float cell = hash21(grid * 41.0);
        float alive = step(uProgress, cell);
        // Cyan core with a magenta chroma split on the glitching bands.
        col = mix(uColor, vec3(1.0, 0.25, 0.8), glitch * 0.55);
        col *= scan * (1.0 + fresnel * 1.8);
        col += uColor * step(0.985, fract(guv.x * 40.0)) * 1.5;
        alpha = clamp((alive * 0.8 + glitch * 0.4 + fresnel * 0.5) * scan, 0.0, 1.0);
    } else {
        // ===== phantom-strike: ghost fade =====
        // Soft grey wisps drifting up, purely additive, no hard edges anywhere.
        float wisp = fbm(vec3(vUv * 4.0, uTime * 0.6) + vec3(0.0, -uTime * 0.9, 0.0));
        float soft = pow(fresnel, 1.4);
        float disperse = smoothstep(0.0, 1.0, uProgress);
        col = uColor * (soft * 2.6 + wisp * 1.4);
        // Cool the wisps slightly as they dissipate so they read as vapour.
        col = mix(col, col * vec3(0.85, 0.9, 1.05), disperse);
        alpha = clamp((soft * 0.95 + wisp * 0.6) * (1.0 - disperse * disperse), 0.0, 1.0);
    }

    // Shared envelope: every variant fades in fast and out clean, so the effect
    // always self-terminates even if the host stops ticking mid-flight.
    float env = sin(clamp(uProgress, 0.0, 1.0) * 3.14159265);
    alpha *= env * uIntensity;
    if (alpha < 0.01) discard;

    gl_FragColor = vec4(col * uIntensity, alpha);
}
`;
