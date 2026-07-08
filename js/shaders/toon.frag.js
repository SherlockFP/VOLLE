// Toon fragment shader — 3-step cel shading + rim light
export const toonFragmentShader = `
uniform vec3 uColor;
uniform vec3 uLightDir;
uniform float uRimPower;

varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec2 vUv;

void main() {
    vec3 normal = normalize(vNormal);
    vec3 lightDir = normalize(uLightDir);

    // Soft cel shading — brighter bands, gentle steps for a sweet cartoon look.
    float NdotL = dot(normal, lightDir);
    float intensity;
    if (NdotL > 0.5) {
        intensity = 1.0;
    } else if (NdotL > 0.0) {
        intensity = 0.82;
    } else if (NdotL > -0.35) {
        intensity = 0.62;
    } else {
        intensity = 0.5;
    }

    // Warm/cool shadow tint instead of flat darkening — more storybook.
    vec3 warmLit = uColor * intensity;
    vec3 coolShadow = uColor * vec3(0.75, 0.8, 1.0);
    vec3 color = mix(coolShadow, warmLit, smoothstep(0.0, 1.0, intensity));

    // Soft rim light for that plush toy edge glow.
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float rim = 1.0 - max(dot(viewDir, normal), 0.0);
    rim = pow(rim, uRimPower) * 0.12;
    color += vec3(0.9, 0.95, 1.0) * rim;

    // Gentle saturation lift so colors feel candy-bright.
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(luma), color, 1.12);

    gl_FragColor = vec4(color, 1.0);
}
`;

// Outline fragment — solid black
export const outlineFragmentShader = `
void main() {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
}
`;
