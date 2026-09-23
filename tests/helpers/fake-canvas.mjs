// tests/helpers/fake-canvas.mjs — a no-op 2D canvas + `document` stand-in so
// build-time CanvasTexture code (arena floors, js/map-art/) can run under Node.
// Every context method is a no-op; the few that must return something
// (gradients, measureText, getImageData) return inert objects.
export function createFakeCanvas() {
    const canvas = { width: 0, height: 0, style: {} };
    const inert = { addColorStop() {} };
    const target = {
        canvas,
        createLinearGradient: () => inert,
        createRadialGradient: () => inert,
        createPattern: () => inert,
        measureText: text => ({ width: String(text).length * 10 }),
        getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
        putImageData() {}
    };
    const ctx = new Proxy(target, {
        get(obj, key) {
            if (key in obj) return obj[key];
            return () => {};
        },
        set(obj, key, value) {
            obj[key] = value;
            return true;
        }
    });
    canvas.getContext = () => ctx;
    return canvas;
}

export function installFakeDocument() {
    if (globalThis.document) return false;
    globalThis.document = {
        createElement: tag => (tag === 'canvas' ? createFakeCanvas() : { style: {} }),
        documentElement: { style: { setProperty() {} } }
    };
    return true;
}
