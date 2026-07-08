// avatar.js — Pixel art avatar painter. Canvas tabanlı, basit brush/fill.
// ponytail: stdlib canvas API, tek dosya, store'a dataURL kaydet.
const GRID = 16;
const PIXEL = 24; // display size per pixel
const PALETTE = [
    '#000000','#ffffff','#ff4444','#4488ff','#44dd44','#ffaa00','#aa44ff','#ff66aa',
    '#88ccff','#ffd8a8','#8b4513','#dddddd','#ff8844','#66ffaa','#ffdd44','#888888'
];

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
        if (saved && saved.pixels) return saved.pixels;
        return Array(this.size * this.size).fill(null);
    }

    _bind() {
        const handle = (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const x = Math.floor((e.clientX - rect.left) / this.cell);
            const y = Math.floor((e.clientY - rect.top) / this.cell);
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
        this.store?.set?.('customAvatar', { pixels: this.pixels, dataURL });
        this.onchange?.(dataURL);
    }

    // Skorbord için küçük avatar render (32x32 PNG dataURL)
    toSmallDataURL() {
        const tmp = document.createElement('canvas');
        tmp.width = 32; tmp.height = 32;
        const tctx = tmp.getContext('2d');
        const step = 32 / this.size;
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                const c = this.pixels[y * this.size + x];
                if (c) { tctx.fillStyle = c; tctx.fillRect(x*step, y*step, step+0.5, step+0.5); }
            }
        }
        return tmp.toDataURL();
    }

    static getPalette() { return PALETTE; }
}
