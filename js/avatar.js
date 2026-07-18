// avatar.js — Pixel art avatar painter. Canvas tabanlı, basit brush/fill.
// ponytail: stdlib canvas API, tek dosya, store'a dataURL kaydet.
const GRID = 64;
const PIXEL = 8;
const PALETTE = [
    '#000000','#ffffff','#ff4444','#4488ff','#44dd44','#ffaa00','#aa44ff','#ff66aa',
    '#88ccff','#ffd8a8','#8b4513','#dddddd','#ff8844','#66ffaa','#ffdd44','#888888'
];

export const AVATAR_SKINS = {
    default: { id: 'default', name: 'Custom Canvas', price: 0, head: '#ffd8a8', body: '#cc3333', arms: '#cc3333', legs: '#222244' },
    neon: { id: 'neon', name: 'Neon Runner', price: 250, head: '#66ffaa', body: '#aa44ff', arms: '#4488ff', legs: '#111122' },
    samurai: { id: 'samurai', name: 'Cyber Samurai', price: 350, head: '#ffd8a8', body: '#222222', arms: '#aa3333', legs: '#444444' },
    frost: { id: 'frost', name: 'Frost Guard', price: 300, head: '#ffffff', body: '#4488ff', arms: '#88ccff', legs: '#224477' }
};

export class AvatarPainter {
    constructor(canvasEl, store) {
        this.canvas = canvasEl;
        this.ctx = canvasEl.getContext('2d');
        this.store = store;
        this.size = GRID;
        this.cell = PIXEL;
        this.canvas.width = this.size * this.cell;
        this.canvas.height = this.size * this.cell;
        this.color = '#ff8844';
        this.tool = 'brush'; // brush | fill | erase
        this.pixels = this._loadOrEmpty();
        this.drawing = false;
        this.onchange = null;
        this._bind();
        this.render();
    }

    _loadOrEmpty() {
        const saved = this.store?.get?.('customAvatar');
        if (saved?.pixels?.length === GRID * GRID) return saved.pixels;
        if (saved?.pixels?.length === 16 * 16) {
            const pixels = Array(GRID * GRID).fill(null);
            for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) pixels[(y + 8) * GRID + (x + 8)] = saved.pixels[y * 16 + x];
            return pixels;
        }
        return Array(this.size * this.size).fill(null);
    }

    _bind() {
        const handle = (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;
            const x = Math.floor((e.clientX - rect.left) * scaleX / this.cell);
            const y = Math.floor((e.clientY - rect.top) * scaleY / this.cell);
            if (x < 0 || x >= this.size || y < 0 || y >= this.size) return;
            if (this.tool === 'fill') this._floodFill(x, y, this.color);
            else if (this.tool === 'erase') this.pixels[y * this.size + x] = null;
            else this.pixels[y * this.size + x] = this.color;
            this.render();
        };
        this.canvas.addEventListener('mousedown', e => { this.drawing = true; handle(e); });
        this.canvas.addEventListener('mousemove', e => { if (this.drawing) handle(e); });
        window.addEventListener('mouseup', () => { this.drawing = false; this._save(); });
        this.canvas.addEventListener('mouseleave', () => { if (this.drawing) { this.drawing = false; this._save(); } });
    }

    _floodFill(x, y, newColor) {
        const idx = y * this.size + x;
        const target = this.pixels[idx];
        if (target === newColor) return;
        const stack = [[x, y]];
        while (stack.length) {
            const [cx, cy] = stack.pop();
            if (cx < 0 || cx >= this.size || cy < 0 || cy >= this.size) continue;
            const ci = cy * this.size + cx;
            if (this.pixels[ci] !== target) continue;
            this.pixels[ci] = newColor;
            stack.push([cx+1, cy], [cx-1, cy], [cx, cy+1], [cx, cy-1]);
        }
    }

    setColor(c) { this.color = c; }
    setTool(t) { this.tool = t; }
    clear() { this.pixels.fill(null); this.render(); this._save(); }

    render() {
        const ctx = this.ctx;
        // Grid bg
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                const c = this.pixels[y * this.size + x];
                if (c) {
                    ctx.fillStyle = c;
                    ctx.fillRect(x * this.cell, y * this.cell, this.cell, this.cell);
                }
                // grid line
                ctx.strokeStyle = 'rgba(255,255,255,0.05)';
                ctx.strokeRect(x * this.cell, y * this.cell, this.cell, this.cell);
            }
        }
        this.onchange?.(this.canvas.toDataURL());
    }

    _save() {
        const dataURL = this.canvas.toDataURL();
        this.store?.set?.('customAvatar', { pixels: this.pixels, dataURL, model: 'classic' });
        this.store?.set?.('equippedAvatarSkin', 'default');
        this.onchange?.(dataURL);
    }

    applyPreset(skinId) {
        const skin = AVATAR_SKINS[skinId];
        if (!skin) return false;
        this.pixels.fill(null);
        const fill = (x0, y0, x1, y1, color) => {
            for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.pixels[y * this.size + x] = color;
        };
        fill(8, 8, 16, 16, skin.head);
        fill(20, 20, 28, 32, skin.body);
        fill(44, 20, 48, 32, skin.arms);
        fill(4, 20, 12, 32, skin.legs);
        this.render();
        this._save();
        this.store?.set?.('equippedAvatarSkin', skinId);
        return true;
    }

    // Skorbord için küçük avatar render (32x32 PNG dataURL)
    toSmallDataURL() {
        const tmp = document.createElement('canvas');
        tmp.width = 32; tmp.height = 32;
        const tctx = tmp.getContext('2d');
        const step = 32 / this.size;
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                const c = this.pixels[(y + 8) * this.size + (x + 8)];
                if (c) { tctx.fillStyle = c; tctx.fillRect(x*step, y*step, step+0.5, step+0.5); }
            }
        }
        return tmp.toDataURL();
    }

    // 3D karakter önizlemesi (Minecraft-style, canvas 2D)
    renderPreview(previewCanvas, teamColor = '#cc3333') {
        if (!previewCanvas) return;
        const S = 10; // scale: her avatar pikseli = 10px
        const W = 16 * S;  // 160
        const H = 22 * S;  // 220
        previewCanvas.width = W;
        previewCanvas.height = H;
        const ctx = previewCanvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        // Bg
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, W, H);
        const cx = W / 2; // center x

        // Head (avatar yüzü)
        const headW = 16 * S / 10 * 8; // avatar'ı 80% scale ile kafaya oturt
        const headH = 16 * S / 10 * 8;
        const headX = cx - headW / 2;
        const headY = 0;
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                const c = this.pixels[y * this.size + x];
                if (c) {
                    ctx.fillStyle = c;
                    const px = headX + (x / 16) * headW;
                    const py = headY + (y / 16) * headH;
                    const pw = Math.ceil((x + 1) / 16 * headW) - Math.ceil(x / 16 * headW);
                    const ph = Math.ceil((y + 1) / 16 * headH) - Math.ceil(y / 16 * headH);
                    ctx.fillRect(Math.round(px), Math.round(py), pw || 1, ph || 1);
                }
            }
        }
        // Head outline
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(headX), Math.round(headY), Math.round(headW), Math.round(headH));

        // Body
        const bW = 10 * S / 10 * 8;
        const bH = 8 * S / 10 * 8;
        const bX = cx - bW / 2;
        const bY = 9 * S / 10 * 8;
        ctx.fillStyle = teamColor;
        ctx.fillRect(Math.round(bX), Math.round(bY), Math.round(bW), Math.round(bH));
        ctx.strokeRect(Math.round(bX), Math.round(bY), Math.round(bW), Math.round(bH));

        // Arms
        const aW = 2 * S / 10 * 8;
        const aH = 7 * S / 10 * 8;
        // Left arm
        ctx.fillStyle = teamColor;
        ctx.fillRect(Math.round(bX - aW), Math.round(bY), Math.round(aW), Math.round(aH));
        ctx.strokeRect(Math.round(bX - aW), Math.round(bY), Math.round(aW), Math.round(aH));
        // Right arm
        ctx.fillRect(Math.round(bX + bW), Math.round(bY), Math.round(aW), Math.round(aH));
        ctx.strokeRect(Math.round(bX + bW), Math.round(bY), Math.round(aW), Math.round(aH));

        // Legs
        const lW = 3 * S / 10 * 8;
        const lH = 5 * S / 10 * 8;
        const lY = bY + bH;
        ctx.fillStyle = teamColor;
        // Left leg
        const lLX = cx - lW - 1;
        ctx.fillRect(Math.round(lLX), Math.round(lY), Math.round(lW), Math.round(lH));
        ctx.strokeRect(Math.round(lLX), Math.round(lY), Math.round(lW), Math.round(lH));
        // Right leg
        ctx.fillRect(Math.round(cx + 1), Math.round(lY), Math.round(lW), Math.round(lH));
        ctx.strokeRect(Math.round(cx + 1), Math.round(lY), Math.round(lW), Math.round(lH));
    }

    static getPalette() { return PALETTE; }
}
