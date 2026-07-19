import {
    MAX_MAP_PROPS,
    PRIMITIVE_TYPES,
    addMapProp,
    deleteMapProp,
    normalizeMapConfig
} from './map-config.js';

const TOOLS = Object.freeze(['select', 'add', 'delete']);

export function getMapViewport(config, canvasWidth, canvasHeight, padding = 16) {
    const normalized = normalizeMapConfig(config);
    const width = Math.max(1, canvasWidth - padding * 2);
    const height = Math.max(1, canvasHeight - padding * 2);
    const scale = Math.min(
        width / normalized.dimensions.width,
        height / normalized.dimensions.length
    );
    const courtWidth = normalized.dimensions.width * scale;
    const courtHeight = normalized.dimensions.length * scale;
    return {
        scale,
        left: (canvasWidth - courtWidth) / 2,
        top: (canvasHeight - courtHeight) / 2,
        width: courtWidth,
        height: courtHeight
    };
}

export function worldToCanvas(config, canvasWidth, canvasHeight, x, z, padding = 16) {
    const viewport = getMapViewport(config, canvasWidth, canvasHeight, padding);
    return {
        x: viewport.left + viewport.width / 2 + x * viewport.scale,
        y: viewport.top + viewport.height / 2 + z * viewport.scale
    };
}

export function canvasToWorld(config, canvasWidth, canvasHeight, x, y, padding = 16) {
    const viewport = getMapViewport(config, canvasWidth, canvasHeight, padding);
    const dimensions = normalizeMapConfig(config).dimensions;
    return {
        x: Math.min(dimensions.width / 2, Math.max(
            -dimensions.width / 2,
            (x - viewport.left - viewport.width / 2) / viewport.scale
        )),
        z: Math.min(dimensions.length / 2, Math.max(
            -dimensions.length / 2,
            (y - viewport.top - viewport.height / 2) / viewport.scale
        ))
    };
}

function propRadius(prop) {
    if (prop.type === 'box') return Math.max(prop.size.width, prop.size.depth) / 2;
    return prop.size.radius;
}

export function hitTestProp(prop, x, z, tolerance = 0) {
    const dx = x - prop.position.x;
    const dz = z - prop.position.z;
    if (prop.type === 'box') {
        return Math.abs(dx) <= prop.size.width / 2 + tolerance
            && Math.abs(dz) <= prop.size.depth / 2 + tolerance;
    }
    return Math.hypot(dx, dz) <= propRadius(prop) + tolerance;
}

export function findMapPropAt(config, x, z, tolerance = 0) {
    const props = normalizeMapConfig(config).props;
    for (let index = props.length - 1; index >= 0; index--) {
        if (hitTestProp(props[index], x, z, tolerance)) return props[index];
    }
    return null;
}

function drawProp(ctx, prop, point, scale) {
    ctx.fillStyle = prop.color;
    ctx.beginPath();
    if (prop.type === 'box') {
        ctx.rect(
            point.x - prop.size.width * scale / 2,
            point.y - prop.size.depth * scale / 2,
            prop.size.width * scale,
            prop.size.depth * scale
        );
    } else if (prop.type === 'cone') {
        const radius = prop.size.radius * scale;
        ctx.moveTo(point.x, point.y - radius);
        ctx.lineTo(point.x + radius, point.y + radius);
        ctx.lineTo(point.x - radius, point.y + radius);
        ctx.closePath();
    } else {
        ctx.arc(point.x, point.y, prop.size.radius * scale, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
}

export function renderMapTopDown(ctx, config, selectedId = null) {
    if (!ctx?.canvas) throw new TypeError('A 2D canvas context is required');
    const normalized = normalizeMapConfig(config);
    const { canvas } = ctx;
    const viewport = getMapViewport(normalized, canvas.width, canvas.height);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = normalized.colors.sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = normalized.colors.floorRed;
    ctx.fillRect(viewport.left, viewport.top, viewport.width / 2, viewport.height);
    ctx.fillStyle = normalized.colors.floorBlue;
    ctx.fillRect(
        viewport.left + viewport.width / 2,
        viewport.top,
        viewport.width / 2,
        viewport.height
    );
    ctx.strokeStyle = normalized.colors.wall;
    ctx.lineWidth = 4;
    ctx.strokeRect(viewport.left, viewport.top, viewport.width, viewport.height);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(viewport.left + viewport.width / 2, viewport.top);
    ctx.lineTo(viewport.left + viewport.width / 2, viewport.top + viewport.height);
    ctx.stroke();

    for (const prop of normalized.props) {
        const point = worldToCanvas(
            normalized,
            canvas.width,
            canvas.height,
            prop.position.x,
            prop.position.z
        );
        drawProp(ctx, prop, point, viewport.scale);
        if (prop.id === selectedId) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(point.x, point.y, Math.max(6, propRadius(prop) * viewport.scale + 4), 0, Math.PI * 2);
            ctx.stroke();
        }
    }
    return normalized;
}

export class MapEditorController {
    constructor(canvas, config = {}, options = {}) {
        if (!canvas?.getContext || !canvas?.addEventListener) {
            throw new TypeError('A canvas element is required');
        }
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        if (!this.ctx) throw new TypeError('Canvas 2D context is unavailable');
        this.config = normalizeMapConfig(config);
        this.tool = 'select';
        this.primitive = 'box';
        this.selectedId = null;
        this.onChange = options.onChange || null;
        this.onSelectionChange = options.onSelectionChange || null;
        this.keyboardTarget = options.keyboardTarget
            ?? (typeof window === 'undefined' ? null : window);
        this._nextId = this.config.props.length + 1;
        this._click = event => this._handleClick(event);
        this._keydown = event => {
            const target = event.target;
            if (target?.matches?.('input, textarea, select, [contenteditable="true"]')) return;
            if (this.canvas.closest?.('.screen')?.classList.contains('hidden')) return;
            if ((event.key === 'Delete' || event.key === 'Backspace') && this.selectedId) {
                event.preventDefault?.();
                this.deleteSelected();
            }
        };
        this.canvas.addEventListener('click', this._click);
        this.keyboardTarget?.addEventListener?.('keydown', this._keydown);
        this.render();
    }

    setConfig(config) {
        this.config = normalizeMapConfig(config);
        if (!this.config.props.some(prop => prop.id === this.selectedId)) this._select(null);
        this._nextId = this.config.props.length + 1;
        this.render();
        return this.getConfig();
    }

    getConfig() {
        return normalizeMapConfig(this.config);
    }

    setTool(tool) {
        if (!TOOLS.includes(tool)) throw new RangeError(`Unknown map editor tool: ${tool}`);
        this.tool = tool;
        return this;
    }

    setPrimitive(type) {
        if (!PRIMITIVE_TYPES.includes(type)) throw new RangeError(`Unknown primitive: ${type}`);
        this.primitive = type;
        return this;
    }

    addPropAt(x, z, overrides = {}) {
        if (this.config.props.length >= MAX_MAP_PROPS) return null;
        let id;
        do id = `prop-${this._nextId++}`;
        while (this.config.props.some(prop => prop.id === id));
        const before = this.config.props.length;
        this.config = addMapProp(this.config, {
            ...overrides,
            id,
            type: this.primitive,
            position: { ...overrides.position, x, z }
        });
        if (this.config.props.length === before) return null;
        const added = this.config.props[this.config.props.length - 1];
        this._select(added.id);
        this._changed();
        return added;
    }

    selectAt(x, z) {
        const tolerance = 5 / getMapViewport(
            this.config,
            this.canvas.width,
            this.canvas.height
        ).scale;
        const prop = findMapPropAt(this.config, x, z, tolerance);
        this._select(prop?.id ?? null);
        this.render();
        return prop;
    }

    deleteSelected() {
        if (!this.selectedId) return false;
        const before = this.config.props.length;
        this.config = deleteMapProp(this.config, this.selectedId);
        if (this.config.props.length === before) return false;
        this._select(null);
        this._changed();
        return true;
    }

    render() {
        renderMapTopDown(this.ctx, this.config, this.selectedId);
    }

    destroy() {
        this.canvas.removeEventListener('click', this._click);
        this.keyboardTarget?.removeEventListener?.('keydown', this._keydown);
    }

    _eventPoint(event) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (event.clientX - rect.left) * this.canvas.width / rect.width,
            y: (event.clientY - rect.top) * this.canvas.height / rect.height
        };
    }

    _handleClick(event) {
        const point = this._eventPoint(event);
        const world = canvasToWorld(
            this.config,
            this.canvas.width,
            this.canvas.height,
            point.x,
            point.y
        );
        if (this.tool === 'add') this.addPropAt(world.x, world.z);
        else if (this.tool === 'delete') {
            const prop = this.selectAt(world.x, world.z);
            if (prop) this.deleteSelected();
        } else {
            this.selectAt(world.x, world.z);
        }
    }

    _select(id) {
        if (this.selectedId === id) return;
        this.selectedId = id;
        this.onSelectionChange?.(id);
    }

    _changed() {
        this.render();
        this.onChange?.(this.getConfig());
    }
}
