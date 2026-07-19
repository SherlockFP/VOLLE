export function formatMapSize(config = {}) {
    if (typeof config.size === 'string') return config.size;

    const width = Number(config.courtWidth ?? config.size?.x);
    if (!Number.isFinite(width)) return 'medium';
    if (width >= 130) return 'xxl';
    if (width >= 115) return 'large';
    if (width <= 80) return 'small';
    return 'medium';
}
