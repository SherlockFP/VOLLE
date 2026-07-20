# V3 Asset and Rendering Pipeline

## Model budgets

Budgets are finalized after baseline profiling. Initial limits:

- One gameplay character: maximum four materials.
- One cosmetic attachment: maximum two materials.
- Repeated arena props share materials.
- Collision uses simplified invisible geometry.
- LOD0, LOD1 and LOD2 required for large props.

## Texture rules

- Power-of-two dimensions where useful.
- 1K default for ordinary props.
- 2K reserved for hero assets.
- Shared atlases for repeated small props.
- Team color uses mask data where practical.
- Compressed GPU texture path evaluated before large content production.

## Export rules

- GLTF/GLB.
- Predictable scale and forward axis.
- Applied transforms.
- Stable object names.
- No duplicate materials with numeric suffixes.
- Separate visual and collision nodes.

## Shader rules

- Toon ramp.
- Team rim light.
- Ball heat/fresnel.
- Impact ring.
- Low-quality fallback.
- Shader warm-up for critical gameplay materials.

## Runtime rules

- Shared geometry/materials for particles.
- Instancing for repeated props.
- Object pools for transient effects.
- Dispose abandoned resources.
- Track draw calls, triangles, textures and frame time.

