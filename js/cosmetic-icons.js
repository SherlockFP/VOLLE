// Lightweight, DOM-built shop silhouettes.  This intentionally accepts only a
// cosmetic category and two validated hex colours; names/descriptions never
// become markup or attributes.

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICON_TYPES = new Set([
    'cape', 'pet', 'shoes', 'aura', 'impact', 'hat', 'mask', 'wings',
    'backpack', 'banner', 'trail', 'finisher', 'gloves'
]);
const ICON_STYLE_VARIANTS = Object.freeze({
    hat: new Set(['headset', 'sport_visor', 'antennas']),
    backpack: new Set(['court_bag', 'popcorn', 'star_pack']),
    cape: new Set(['pennants']),
    shoes: new Set(['court_sneakers']),
    wings: new Set(['comet_fins']),
    // Both catalog axolotls use the block body and side-gill mesh in
    // cosmetic-models.js.  Giving that mesh a matching shop silhouette avoids
    // promising a generic round companion for the Tidal Drift Ray.
    pet: new Set(['axolotl', 'satellite'])
});

export const COSMETIC_ICON_TYPES = Object.freeze([...ICON_TYPES]);

export function sanitizeIconColor(value, fallback = '#67e8f9') {
    const color = typeof value === 'string' ? value.trim() : '';
    return /^#[0-9a-f]{6}$/i.test(color) || /^#[0-9a-f]{3}$/i.test(color)
        ? color
        : fallback;
}

export function cosmeticIconType(item = {}) {
    const type = item?.type === 'hitEffect' ? 'impact' : item?.type;
    return ICON_TYPES.has(type) ? type : 'aura';
}

export function cosmeticIconDescriptor(item = {}) {
    const colors = Array.isArray(item?.colors) ? item.colors : [];
    const type = cosmeticIconType(item);
    const style = typeof item?.style === 'string' && ICON_STYLE_VARIANTS[type]?.has(item.style)
        ? item.style
        : null;
    return Object.freeze({
        type,
        style,
        primary: sanitizeIconColor(colors[0], '#67e8f9'),
        secondary: sanitizeIconColor(colors[1], '#1e3a8a')
    });
}

function element(doc, name, attributes = {}) {
    const node = doc.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
}

function shape(svg, doc, name, attributes) {
    svg.append(element(doc, name, attributes));
}

function line(svg, doc, x1, y1, x2, y2, color, width = 4) {
    shape(svg, doc, 'path', { d: `M${x1} ${y1}L${x2} ${y2}`, stroke: color, 'stroke-width': width, 'stroke-linecap': 'round', fill: 'none' });
}

function addTypeShapes(svg, doc, type, style, primary, secondary) {
    const stroke = { stroke: secondary, 'stroke-width': 3, 'stroke-linejoin': 'round' };
    switch (type) {
        case 'cape':
            if (style === 'pennants') {
                shape(svg, doc, 'path', { d: 'M20 24H44L41 80L32 68L23 80ZM52 24H76L73 80L64 68L55 80Z', fill: primary, ...stroke });
                shape(svg, doc, 'rect', { x: 17, y: 18, width: 62, height: 8, rx: 3, fill: secondary });
                shape(svg, doc, 'path', { d: 'M32 35L38 42L32 49L26 42ZM64 35L70 42L64 49L58 42Z', fill: secondary });
                break;
            }
            shape(svg, doc, 'path', { d: 'M25 17H71L77 74L48 64L19 74Z', fill: primary, ...stroke });
            shape(svg, doc, 'path', { d: 'M32 24L48 57L64 24', fill: 'none', stroke: secondary, 'stroke-width': 4, 'stroke-linecap': 'round' });
            break;
        case 'pet':
            if (style === 'satellite') {
                line(svg, doc, 16, 51, 80, 51, primary, 5);
                for (const x of [10, 65]) {
                    shape(svg, doc, 'rect', { x, y: 37, width: 21, height: 29, fill: secondary, stroke: primary, 'stroke-width': 2 });
                    line(svg, doc, x + 10, 38, x + 10, 65, primary, 2);
                    line(svg, doc, x + 1, 51, x + 20, 51, primary, 2);
                }
                line(svg, doc, 48, 37, 48, 24, secondary, 3);
                shape(svg, doc, 'path', { d: 'M36 20H60L48 28Z', fill: primary, ...stroke });
                shape(svg, doc, 'rect', { x: 35, y: 36, width: 26, height: 29, rx: 3, fill: primary, ...stroke });
                shape(svg, doc, 'circle', { cx: 42, cy: 48, r: 3, fill: '#fff6e5' });
                shape(svg, doc, 'circle', { cx: 54, cy: 48, r: 3, fill: '#fff6e5' });
                break;
            }
            if (style === 'axolotl') {
                shape(svg, doc, 'path', { d: 'M20 43H68L80 52L68 61H20Z', fill: primary, ...stroke });
                shape(svg, doc, 'path', { d: 'M24 42L17 29L29 34M24 61L17 74L29 69M63 42L70 29L76 37M63 61L70 74L76 66', fill: primary, ...stroke });
                shape(svg, doc, 'circle', { cx: 39, cy: 48, r: 3.5, fill: secondary }); shape(svg, doc, 'circle', { cx: 39, cy: 57, r: 3.5, fill: secondary });
                break;
            }
            shape(svg, doc, 'path', { d: 'M19 53C19 32 32 23 48 25C65 23 77 33 77 53C75 68 63 75 48 75C33 75 21 68 19 53Z', fill: primary, ...stroke });
            shape(svg, doc, 'path', { d: 'M27 31L31 16L40 27M56 27L65 16L68 34', fill: primary, ...stroke });
            shape(svg, doc, 'circle', { cx: 38, cy: 50, r: 4, fill: secondary }); shape(svg, doc, 'circle', { cx: 59, cy: 50, r: 4, fill: secondary });
            break;
        case 'shoes':
            if (style === 'court_sneakers') {
                for (const x of [9, 51]) {
                    shape(svg, doc, 'path', { d: `M${x + 3} 42H${x + 18}L${x + 24} 54L${x + 33} 58V70H${x}V52Z`, fill: primary, ...stroke });
                    line(svg, doc, x + 1, 72, x + 33, 72, secondary, 5);
                    line(svg, doc, x + 2, 44, x + 2, 37, secondary, 4);
                    line(svg, doc, x + 12, 50, x + 22, 50, '#fff6e5', 3);
                    line(svg, doc, x + 15, 56, x + 26, 56, '#fff6e5', 3);
                }
                break;
            }
            shape(svg, doc, 'path', { d: 'M12 59H42L48 72H12Z', fill: primary, ...stroke });
            shape(svg, doc, 'path', { d: 'M50 59H78L84 72H50Z', fill: primary, ...stroke });
            line(svg, doc, 18, 65, 40, 65, secondary, 3); line(svg, doc, 56, 65, 78, 65, secondary, 3);
            break;
        case 'aura':
            shape(svg, doc, 'circle', { cx: 48, cy: 48, r: 28, fill: 'none', stroke: primary, 'stroke-width': 7 });
            shape(svg, doc, 'circle', { cx: 48, cy: 48, r: 15, fill: 'none', stroke: secondary, 'stroke-width': 4, 'stroke-dasharray': '6 5' });
            shape(svg, doc, 'circle', { cx: 77, cy: 40, r: 5, fill: primary });
            break;
        case 'impact':
            shape(svg, doc, 'path', { d: 'M48 11L56 36L83 25L63 46L83 61L55 58L48 84L40 59L13 70L34 48L13 32L40 37Z', fill: primary, ...stroke });
            shape(svg, doc, 'circle', { cx: 48, cy: 48, r: 9, fill: secondary });
            break;
        case 'hat':
            if (style === 'sport_visor') {
                shape(svg, doc, 'ellipse', { cx: 48, cy: 39, rx: 26, ry: 10, fill: 'none', stroke: secondary, 'stroke-width': 8 });
                shape(svg, doc, 'path', { d: 'M23 44C31 52 65 52 73 44L84 59C70 78 26 78 12 59Z', fill: primary, ...stroke });
                shape(svg, doc, 'rect', { x: 43, y: 39, width: 10, height: 7, rx: 2, fill: primary });
                break;
            }
            if (style === 'antennas') {
                shape(svg, doc, 'ellipse', { cx: 48, cy: 59, rx: 29, ry: 10, fill: 'none', stroke: secondary, 'stroke-width': 7 });
                line(svg, doc, 24, 53, 28, 28, secondary, 4);
                line(svg, doc, 72, 53, 68, 28, secondary, 4);
                shape(svg, doc, 'circle', { cx: 28, cy: 24, r: 9, fill: primary, ...stroke });
                shape(svg, doc, 'circle', { cx: 68, cy: 24, r: 9, fill: primary, ...stroke });
                break;
            }
            if (style === 'headset') {
                shape(svg, doc, 'path', { d: 'M24 53V43C24 17 72 17 72 43V53', fill: 'none', stroke: secondary, 'stroke-width': 7, 'stroke-linecap': 'round' });
                shape(svg, doc, 'path', { d: 'M28 47H39V65H28ZM57 47H68V65H57Z', fill: primary, ...stroke });
                shape(svg, doc, 'path', { d: 'M68 60C76 61 77 67 72 70H62', fill: 'none', stroke: secondary, 'stroke-width': 4, 'stroke-linecap': 'round' });
                break;
            }
            shape(svg, doc, 'path', { d: 'M22 48C22 27 34 17 49 17C64 17 73 30 73 48Z', fill: primary, ...stroke });
            shape(svg, doc, 'path', { d: 'M13 49H83C81 58 68 61 48 61C28 61 15 58 13 49Z', fill: secondary, stroke: primary, 'stroke-width': 3 });
            shape(svg, doc, 'path', { d: 'M70 31C83 34 83 51 73 53', fill: 'none', stroke: primary, 'stroke-width': 5, 'stroke-linecap': 'round' });
            break;
        case 'mask':
            shape(svg, doc, 'path', { d: 'M18 34L34 23H62L78 34L70 68L48 78L26 68Z', fill: primary, ...stroke });
            shape(svg, doc, 'path', { d: 'M27 43H42M54 43H69', stroke: secondary, 'stroke-width': 6, 'stroke-linecap': 'round' });
            shape(svg, doc, 'path', { d: 'M38 62H58', stroke: secondary, 'stroke-width': 4, 'stroke-linecap': 'round' });
            break;
        case 'wings':
            if (style === 'comet_fins') {
                shape(svg, doc, 'path', { d: 'M44 43L27 17L9 26L25 79L42 64ZM52 43L69 17L87 26L71 79L54 64Z', fill: primary, ...stroke });
                shape(svg, doc, 'path', { d: 'M36 45L25 29L19 33L28 63ZM60 45L71 29L77 33L68 63Z', fill: secondary });
                break;
            }
            shape(svg, doc, 'path', { d: 'M46 47C28 17 10 17 14 67C24 61 34 62 46 78Z', fill: primary, ...stroke });
            shape(svg, doc, 'path', { d: 'M50 47C68 17 86 17 82 67C72 61 62 62 50 78Z', fill: primary, ...stroke });
            line(svg, doc, 28, 41, 42, 56, secondary, 3); line(svg, doc, 68, 41, 54, 56, secondary, 3);
            break;
        case 'backpack':
            if (style === 'popcorn') {
                shape(svg, doc, 'path', { d: 'M23 37H73L65 80H31Z', fill: primary, ...stroke });
                line(svg, doc, 37, 43, 40, 75, secondary, 5);
                line(svg, doc, 59, 43, 56, 75, secondary, 5);
                for (const [cx, cy] of [[29, 33], [43, 32], [64, 33], [37, 22], [56, 23]]) {
                    shape(svg, doc, 'circle', { cx, cy, r: 10, fill: '#fff6e5', stroke: secondary, 'stroke-width': 2 });
                }
                line(svg, doc, 23, 40, 73, 40, secondary, 5);
                break;
            }
            if (style === 'star_pack') {
                shape(svg, doc, 'path', { d: 'M40 21V16H56V21', fill: 'none', stroke: secondary, 'stroke-width': 4 });
                shape(svg, doc, 'path', { d: 'M48 18L58 37L81 40L64 56L68 80L48 68L28 80L32 56L15 40L38 37Z', fill: primary, ...stroke });
                shape(svg, doc, 'circle', { cx: 48, cy: 52, r: 10, fill: secondary });
                line(svg, doc, 72, 59, 78, 66, secondary, 3);
                shape(svg, doc, 'path', { d: 'M79 65L85 72L79 79L73 72Z', fill: secondary });
                break;
            }
            if (style === 'court_bag') {
                shape(svg, doc, 'rect', { x: 16, y: 36, width: 64, height: 31, rx: 13, fill: primary, ...stroke });
                shape(svg, doc, 'circle', { cx: 19, cy: 52, r: 12, fill: secondary, stroke: primary, 'stroke-width': 3 });
                shape(svg, doc, 'circle', { cx: 77, cy: 52, r: 12, fill: secondary, stroke: primary, 'stroke-width': 3 });
                shape(svg, doc, 'rect', { x: 35, y: 47, width: 26, height: 15, rx: 3, fill: secondary, stroke: primary, 'stroke-width': 3 });
                shape(svg, doc, 'path', { d: 'M34 36V27H62V36', fill: 'none', stroke: secondary, 'stroke-width': 5, 'stroke-linecap': 'round' });
                break;
            }
            shape(svg, doc, 'path', { d: 'M26 29C26 20 34 15 48 15C62 15 70 20 70 29V76H26Z', fill: primary, ...stroke });
            shape(svg, doc, 'rect', { x: 33, y: 45, width: 30, height: 20, rx: 4, fill: secondary, stroke: primary, 'stroke-width': 3 });
            shape(svg, doc, 'path', { d: 'M34 28V19H62V28', fill: 'none', stroke: secondary, 'stroke-width': 4 });
            break;
        case 'banner':
            line(svg, doc, 23, 16, 23, 80, secondary, 5);
            shape(svg, doc, 'path', { d: 'M25 20H75V61L61 55L48 62L35 55L25 59Z', fill: primary, ...stroke });
            shape(svg, doc, 'path', { d: 'M41 31L48 27L55 31L53 40L48 45L43 40Z', fill: secondary });
            break;
        case 'trail':
            shape(svg, doc, 'path', { d: 'M13 62C28 30 44 76 57 43C65 23 75 31 84 16', fill: 'none', stroke: primary, 'stroke-width': 9, 'stroke-linecap': 'round' });
            shape(svg, doc, 'path', { d: 'M14 76C30 47 43 87 55 62C66 40 75 50 83 39', fill: 'none', stroke: secondary, 'stroke-width': 4, 'stroke-linecap': 'round' });
            break;
        case 'finisher':
            shape(svg, doc, 'path', { d: 'M48 12L56 37L82 28L64 48L82 67L55 59L48 84L39 60L14 67L32 48L15 29L40 37Z', fill: primary, ...stroke });
            shape(svg, doc, 'path', { d: 'M44 31H53L50 46H61L42 68L46 51H35Z', fill: secondary });
            break;
        case 'gloves':
            shape(svg, doc, 'path', { d: 'M17 69V48L23 31L29 49V23L36 23V47L40 18H47L47 47L53 23H60V49L65 33L71 36V61L62 76H29Z', fill: primary, ...stroke });
            shape(svg, doc, 'path', { d: 'M27 58H62', stroke: secondary, 'stroke-width': 4, 'stroke-linecap': 'round' });
            break;
    }
}

export function createCosmeticIcon(item = {}, doc = globalThis.document) {
    if (!doc?.createElementNS) return null;
    const { type, style, primary, secondary } = cosmeticIconDescriptor(item);
    const svg = element(doc, 'svg', {
        class: `cosmetic-item-icon cosmetic-item-icon-${type}${style ? ` cosmetic-item-icon-${style}` : ''}`,
        viewBox: '0 0 96 96', width: '96', height: '96', role: 'img', 'aria-hidden': 'true', focusable: 'false'
    });
    shape(svg, doc, 'circle', { cx: 48, cy: 48, r: 43, fill: secondary, opacity: '.16' });
    addTypeShapes(svg, doc, type, style, primary, secondary);
    return svg;
}

export function appendCosmeticIcon(container, item = {}) {
    if (!container?.append || !container.ownerDocument) return null;
    container.querySelector?.('.cosmetic-item-icon')?.remove();
    const icon = createCosmeticIcon(item, container.ownerDocument);
    if (icon) container.append(icon);
    return icon;
}
