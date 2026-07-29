// Finisher vertex shader — one shell displaced four different ways by uVariant
export const finisherVertexShader = `
uniform float uTime;
uniform float uProgress;
uniform float uIntensity;
uniform int uVariant;

varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec2 vUv;
varying float vRadius;

// Inline hash — keeps this file dependency-free (no noise lib import).
float hash31(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vRadius = length(position);

    vec3 pos = position;
    float shard = hash31(normalize(position) * 4.0);

    if (uVariant == 0) {
        // dark-eater — implosion: the shell collapses toward the core, rim last.
        float collapse = 1.0 - uProgress * 0.85;
        pos *= collapse;
        pos += normal * sin(uProgress * 12.0 + shard * 6.28318) * 0.08 * uIntensity;
    } else if (uVariant == 1) {
        // crimson-blade — shards fly outward at per-shard speeds.
        float speed = 0.6 + shard * 1.9;
        pos += normal * uProgress * speed * uIntensity;
    } else if (uVariant == 2) {
        // cyber-nexus — quantised expansion, snaps outward in discrete steps.
        float steps = 6.0;
        float q = floor(uProgress * steps) / steps;
        pos += normal * q * 1.4 * uIntensity;
        pos.y += sin(uTime * 8.0 + floor(position.y * 6.0)) * 0.05 * uProgress;
    } else {
        // phantom-strike — soft dispersion with an upward wisp drift.
        pos += normal * uProgress * 0.9 * (0.4 + shard) * uIntensity;
        pos.y += uProgress * uProgress * 1.2;
    }

    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;
