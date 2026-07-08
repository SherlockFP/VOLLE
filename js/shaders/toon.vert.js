// Toon vertex shader — passes normal + worldPos to frag
export const toonVertexShader = `
varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec2 vUv;

void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

// Outline vertex shader — inflate along normals
export const outlineVertexShader = `
uniform float outlineThickness;

void main() {
    vec3 inflated = position + normal * outlineThickness;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(inflated, 1.0);
}
`;
