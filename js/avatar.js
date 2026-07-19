const ATLAS_SIZE = 64;
const FACE_SIZE = 8;
const EDITOR_PIXEL = 64;

export const HEAD_FRONT = Object.freeze({ x: 8, y: 8, width: 8, height: 8 });

export const AVATAR_MODELS = Object.freeze({
    classic: Object.freeze({
        id: 'classic',
        textureWidth: ATLAS_SIZE,
        textureHeight: ATLAS_SIZE,
        head: Object.freeze({ width: 8, height: 8, depth: 8 }),
        body: Object.freeze({ width: 8, height: 12, depth: 4 }),
        arm: Object.freeze({ width: 4, height: 12, depth: 4 }),
        leg: Object.freeze({ width: 4, height: 12, depth: 4 })
    }),
    slim: Object.freeze({
        id: 'slim',
        textureWidth: ATLAS_SIZE,
        textureHeight: ATLAS_SIZE,
        head: Object.freeze({ width: 8, height: 8, depth: 8 }),
        body: Object.freeze({ width: 8, height: 12, depth: 4 }),
        arm: Object.freeze({ width: 3, height: 12, depth: 4 }),
        leg: Object.freeze({ width: 4, height: 12, depth: 4 })
    })
});

const skin = (id, name, price, model, team, head, body, arms, legs) =>
    Object.freeze({ id, name, price, model, team, head, body, arms, legs });

export const AVATAR_SKINS = Object.freeze({
    default: skin('default', 'Custom Canvas', 0, 'classic', null, '#ffd8a8', '#cc3333', '#cc3333', '#222244'),
    neon: skin('neon', 'Neon Runner', 250, 'slim', null, '#66ffaa', '#aa44ff', '#4488ff', '#111122'),
    samurai: skin('samurai', 'Cyber Samurai', 350, 'classic', null, '#ffd8a8', '#222222', '#aa3333', '#444444'),
    frost: skin('frost', 'Frost Guard', 300, 'classic', null, '#ffffff', '#4488ff', '#88ccff', '#224477'),
    astro: skin('astro', 'Astro Courier', 420, 'slim', null, '#d7f1ff', '#253d76', '#6ecbff', '#19264d'),
    arcade: skin('arcade', 'Arcade Ace', 380, 'classic', null, '#ffd2b0', '#21b8d6', '#ff5f9e', '#263057'),
    moss: skin('moss', 'Moss Golem', 450, 'classic', null, '#b7d695', '#456b47', '#719c58', '#304936'),
    blue_default: skin('blue_default', 'Blue Default', 0, 'classic', 'blue', '#ffd8a8', '#3355cc', '#3355cc', '#172b70'),
    red_guard: skin('red_guard', 'Red Guard', 0, 'classic', 'red', '#ffd8a8', '#cc3333', '#a82424', '#651c2a')
});

export const TEAM_SKIN_IDS = Object.freeze({ blue: 'blue_default', red: 'red_guard' });

const PALETTE = [
    '#000000', '#ffffff', '#ff4444', '#4488ff', '#44dd44', '#ffaa00', '#aa44ff', '#ff66aa',
    '#88ccff', '#ffd8a8', '#8b4513', '#dddddd', '#ff8844', '#66ffaa', '#ffdd44', '#888888'
];

const FRONT_UV = Object.freeze({
    head: Object.freeze({ x: 8, y: 8, width: 8, height: 8 }),
    body: Object.freeze({ x: 20, y: 20, width: 8, height: 12 }),
    leftArm: Object.freeze({ x: 36, y: 52, width: 4, height: 12 }),
    rightArm: Object.freeze({ x: 44, y: 20, width: 4, height: 12 }),
    leftLeg: Object.freeze({ x: 20, y: 52, width: 4, height: 12 }),
    rightLeg: Object.freeze({ x: 4, y: 20, width: 4, height: 12 })
});

const resolveSkin = value => {
    if (typeof value === 'string') return AVATAR_SKINS[value] || AVATAR_SKINS.default;
    return value?.id && AVATAR_SKINS[value.id] ? AVATAR_SKINS[value.id] : AVATAR_SKINS.default;
};

const resolveModel = value => {
    const id = typeof value === 'string' ? value : value?.id;
    return AVATAR_MODELS[id] || AVATAR_MODELS.classic;
};

const shade = (color, factor) => {
    const hex = color.replace('#', '');
    const value = Number.parseInt(hex, 16);
    const channel = shift => Math.max(0, Math.min(255, Math.round(((value >> shift) & 255) * factor)));
    return `#${[channel(16), channel(8), channel(0)].map(c => c.toString(16).padStart(2, '0')).join('')}`;
};

const fill = (pixels, x, y, width, height, color) => {
    for (let py = y; py < y + height; py++) {
        for (let px = x; px < x + width; px++) pixels[py * ATLAS_SIZE + px] = color;
    }
};

const paintBox = (pixels, x, y, width, depth, height, color) => {
    fill(pixels, x + depth, y, width, depth, shade(color, 1.08));
    fill(pixels, x + depth + width, y, width, depth, shade(color, 0.72));
    fill(pixels, x, y + depth, depth, height, shade(color, 0.82));
    fill(pixels, x + depth, y + depth, width, height, color);
    fill(pixels, x + depth + width, y + depth, depth, height, shade(color, 0.9));
    fill(pixels, x + depth * 2 + width, y + depth, width, height, shade(color, 0.76));
};

export function createAvatarAtlas(skinId = 'default') {
    const preset = resolveSkin(skinId);
    const model = resolveModel(preset.model);
    const pixels = Array(ATLAS_SIZE * ATLAS_SIZE).fill(null);
    paintBox(pixels, 0, 0, 8, 8, 8, preset.head);
    paintBox(pixels, 16, 16, 8, 4, 12, preset.body);
    paintBox(pixels, 40, 16, model.arm.width, 4, 12, preset.arms);
    paintBox(pixels, 0, 16, 4, 4, 12, preset.legs);
    paintBox(pixels, 32, 48, model.arm.width, 4, 12, preset.arms);
    paintBox(pixels, 16, 48, 4, 4, 12, preset.legs);
    pixels[11 * ATLAS_SIZE + 10] = '#222222';
    pixels[11 * ATLAS_SIZE + 13] = '#222222';
    return pixels;
}

export function cropAtlasFace(pixels) {
    if (!Array.isArray(pixels) || pixels.length !== ATLAS_SIZE * ATLAS_SIZE) {
        return Array(FACE_SIZE * FACE_SIZE).fill(null);
    }
    const face = [];
    for (let y = 0; y < HEAD_FRONT.height; y++) {
        for (let x = 0; x < HEAD_FRONT.width; x++) {
            face.push(pixels[(HEAD_FRONT.y + y) * ATLAS_SIZE + HEAD_FRONT.x + x] ?? null);
        }
    }
    return face;
}

export function migrateAvatarPixels(pixels) {
    if (!Array.isArray(pixels)) return Array(FACE_SIZE * FACE_SIZE).fill(null);
    if (pixels.length === ATLAS_SIZE * ATLAS_SIZE) return cropAtlasFace(pixels);
    if (pixels.length === FACE_SIZE * FACE_SIZE) return pixels.map(pixel => pixel ?? null);
    if (pixels.length === 16 * 16) {
        return Array.from({ length: FACE_SIZE * FACE_SIZE }, (_, index) => {
            const x = (index % FACE_SIZE) * 2;
            const y = Math.floor(index / FACE_SIZE) * 2;
            return pixels[y * 16 + x] ?? null;
        });
    }
    return Array(FACE_SIZE * FACE_SIZE).fill(null);
}

export function composeAvatarAtlas(base = 'default', overlay = []) {
    const atlas = Array.isArray(base) && base.length === ATLAS_SIZE * ATLAS_SIZE
        ? base.map(pixel => pixel ?? null)
        : createAvatarAtlas(base);
    const face = migrateAvatarPixels(overlay);
    for (let y = 0; y < FACE_SIZE; y++) {
        for (let x = 0; x < FACE_SIZE; x++) {
            const color = face[y * FACE_SIZE + x];
            if (color != null) atlas[(HEAD_FRONT.y + y) * ATLAS_SIZE + HEAD_FRONT.x + x] = color;
        }
    }
    return atlas;
}

export function getTeamPresetSkinId(team) {
    return TEAM_SKIN_IDS[String(team || '').toLowerCase()] || null;
}

export function layoutAvatarPreview(modelId = 'classic', scale = 1, padding = 1) {
    const model = resolveModel(modelId);
    const unit = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const pad = Number.isFinite(padding) && padding >= 0 ? padding : 0;
    const silhouetteWidth = model.arm.width * 2 + model.body.width;
    const contentHeight = model.head.height + model.body.height + model.leg.height;
    const bodyX = pad + model.arm.width;
    const centerX = pad + silhouetteWidth / 2;
    const bodyY = pad + model.head.height;
    const legY = bodyY + model.body.height;
    const part = (name, x, y, width, height) => {
        const uv = FRONT_UV[name];
        const atlas = name.endsWith('Arm') ? Object.freeze({ ...uv, width: model.arm.width }) : uv;
        return Object.freeze({
            name,
            x: x * unit,
            y: y * unit,
            width: width * unit,
            height: height * unit,
            atlas
        });
    };
    return Object.freeze({
        model: model.id,
        projection: 'front',
        width: (silhouetteWidth + pad * 2) * unit,
        height: (contentHeight + pad * 2) * unit,
        parts: Object.freeze([
            part('head', centerX - model.head.width / 2, pad, model.head.width, model.head.height),
            part('leftArm', bodyX - model.arm.width, bodyY, model.arm.width, model.arm.height),
            part('body', bodyX, bodyY, model.body.width, model.body.height),
            part('rightArm', bodyX + model.body.width, bodyY, model.arm.width, model.arm.height),
            part('leftLeg', centerX - model.leg.width, legY, model.leg.width, model.leg.height),
            part('rightLeg', centerX, legY, model.leg.width, model.leg.height)
        ])
    });
}

export const getAvatarPreviewLayout = layoutAvatarPreview;

export class AvatarPainter {
    constructor(canvasEl, store) {
        this.canvas = canvasEl;
        this.ctx = canvasEl.getContext('2d');
        this.store = store;
        this.size = FACE_SIZE;
        this.cell = EDITOR_PIXEL;
        this.canvas.width = this.size * this.cell;
        this.canvas.height = this.size * this.cell;
        this.color = '#ff8844';
        this.tool = 'brush';
        const saved = this.store?.get?.('customAvatar');
        const equipped = this.store?.get?.('equippedAvatarSkin');
        this.skinId = AVATAR_SKINS[saved?.baseSkinId]?.id
            || AVATAR_SKINS[saved?.skinId]?.id
            || AVATAR_SKINS[equipped]?.id
            || 'default';
        this.pixels = migrateAvatarPixels(saved?.overlay || saved?.pixels);
        this.drawing = false;
        this.onchange = null;
        this._bind();
        this.render();
    }

    _bind() {
        const handle = e => {
            const rect = this.canvas.getBoundingClientRect();
            const x = Math.floor((e.clientX - rect.left) * this.canvas.width / rect.width / this.cell);
            const y = Math.floor((e.clientY - rect.top) * this.canvas.height / rect.height / this.cell);
            if (x < 0 || x >= this.size || y < 0 || y >= this.size) return;
            if (this.tool === 'fill') this._floodFill(x, y, this.color);
            else this.pixels[y * this.size + x] = this.tool === 'erase' ? null : this.color;
            this.render();
        };
        this.canvas.addEventListener('mousedown', e => {
            this.drawing = true;
            handle(e);
        });
        this.canvas.addEventListener('mousemove', e => {
            if (this.drawing) handle(e);
        });
        globalThis.window?.addEventListener('mouseup', () => {
            if (!this.drawing) return;
            this.drawing = false;
            this._save();
        });
        this.canvas.addEventListener('mouseleave', () => {
            if (!this.drawing) return;
            this.drawing = false;
            this._save();
        });
    }

    _floodFill(x, y, newColor) {
        const visible = cropAtlasFace(this.getAtlasPixels());
        const target = visible[y * this.size + x];
        if (target === newColor) return;
        const stack = [[x, y]];
        const visited = new Set();
        while (stack.length) {
            const [cx, cy] = stack.pop();
            const index = cy * this.size + cx;
            if (cx < 0 || cx >= this.size || cy < 0 || cy >= this.size || visited.has(index)) continue;
            visited.add(index);
            if (visible[index] !== target) continue;
            this.pixels[index] = newColor;
            stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
        }
    }

    setColor(color) {
        this.color = color;
    }

    setTool(tool) {
        this.tool = tool;
    }

    clear() {
        this.pixels.fill(null);
        this.render();
        this._save();
    }

    getAtlasPixels() {
        return composeAvatarAtlas(this.skinId, this.pixels);
    }

    _canvasForAtlas() {
        const canvas = this.canvas.ownerDocument?.createElement('canvas')
            || globalThis.document?.createElement('canvas');
        if (!canvas) return null;
        canvas.width = ATLAS_SIZE;
        canvas.height = ATLAS_SIZE;
        const ctx = canvas.getContext('2d');
        const pixels = this.getAtlasPixels();
        for (let y = 0; y < ATLAS_SIZE; y++) {
            for (let x = 0; x < ATLAS_SIZE; x++) {
                const color = pixels[y * ATLAS_SIZE + x];
                if (!color) continue;
                ctx.fillStyle = color;
                ctx.fillRect(x, y, 1, 1);
            }
        }
        return canvas;
    }

    _atlasDataURL() {
        return this._canvasForAtlas()?.toDataURL() || '';
    }

    render() {
        const face = cropAtlasFace(this.getAtlasPixels());
        this.ctx.fillStyle = '#1a1a2e';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                const color = face[y * this.size + x];
                if (color) {
                    this.ctx.fillStyle = color;
                    this.ctx.fillRect(x * this.cell, y * this.cell, this.cell, this.cell);
                }
                this.ctx.strokeStyle = 'rgba(255,255,255,0.08)';
                this.ctx.strokeRect(x * this.cell, y * this.cell, this.cell, this.cell);
            }
        }
        if (this.onchange) this.onchange(this._atlasDataURL());
    }

    _save() {
        const preset = resolveSkin(this.skinId);
        const dataURL = this._atlasDataURL();
        this.store?.set?.('customAvatar', {
            version: 2,
            pixels: this.getAtlasPixels(),
            overlay: this.pixels.slice(),
            dataURL,
            model: preset.model,
            baseSkinId: preset.id,
            skinId: preset.id
        });
        this.store?.set?.('equippedAvatarSkin', preset.id);
        this.onchange?.(dataURL);
    }

    applyPreset(skinId) {
        if (!AVATAR_SKINS[skinId]) return false;
        this.skinId = skinId;
        this.pixels.fill(null);
        this.render();
        this._save();
        return true;
    }

    toSmallDataURL() {
        const canvas = this.canvas.ownerDocument?.createElement('canvas')
            || globalThis.document?.createElement('canvas');
        if (!canvas) return '';
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        const face = cropAtlasFace(this.getAtlasPixels());
        for (let y = 0; y < FACE_SIZE; y++) {
            for (let x = 0; x < FACE_SIZE; x++) {
                const color = face[y * FACE_SIZE + x];
                if (!color) continue;
                ctx.fillStyle = color;
                ctx.fillRect(x * 4, y * 4, 4, 4);
            }
        }
        return canvas.toDataURL();
    }

    renderPreview(previewCanvas) {
        if (!previewCanvas) return;
        const preset = resolveSkin(this.skinId);
        const layout = layoutAvatarPreview(preset.model, 8, 1);
        previewCanvas.width = layout.width;
        previewCanvas.height = layout.height;
        const ctx = previewCanvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, layout.width, layout.height);
        const atlas = this.getAtlasPixels();
        for (const part of layout.parts) {
            const uv = part.atlas;
            const pixelWidth = part.width / uv.width;
            const pixelHeight = part.height / uv.height;
            for (let y = 0; y < uv.height; y++) {
                for (let x = 0; x < uv.width; x++) {
                    const color = atlas[(uv.y + y) * ATLAS_SIZE + uv.x + x];
                    if (!color) continue;
                    ctx.fillStyle = color;
                    ctx.fillRect(
                        part.x + x * pixelWidth,
                        part.y + y * pixelHeight,
                        pixelWidth,
                        pixelHeight
                    );
                }
            }
            ctx.strokeStyle = 'rgba(0,0,0,0.35)';
            ctx.strokeRect(part.x, part.y, part.width, part.height);
        }
    }

    static getPalette() {
        return PALETTE;
    }
}
