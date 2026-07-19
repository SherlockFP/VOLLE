const DEFAULT_MAX_EVENTS = 1000;
const DEFAULT_MAX_TRAJECTORY_SAMPLES = 256;
const DEFAULT_NAME_LENGTH = 32;
const DEFAULT_ID_LENGTH = 64;
const VALID_TEAMS = new Set(['red', 'blue']);

const finite = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
};

const count = value => Math.max(0, Math.trunc(finite(value)));
const clampLimit = (value, fallback) => Math.max(1, Math.trunc(finite(value, fallback)));

function cleanText(value, fallback, maxLength) {
    if (typeof value !== 'string' && typeof value !== 'number') return fallback;
    const cleaned = String(value)
        .replace(/[\u0000-\u001f\u007f<>]/g, '')
        .trim()
        .slice(0, maxLength);
    return cleaned || fallback;
}

export function sanitizeId(value, fallback = 'unknown') {
    let cleaned = cleanText(value, '', DEFAULT_ID_LENGTH)
        .replace(/[^a-zA-Z0-9_.:@-]/g, '-')
        .replace(/-+/g, '-');
    if (['__proto__', 'constructor', 'prototype'].includes(cleaned.toLowerCase())) {
        cleaned = `_${cleaned}`;
    }
    return cleaned || cleanText(fallback, 'unknown', DEFAULT_ID_LENGTH)
        .replace(/[^a-zA-Z0-9_.:@-]/g, '-') || 'unknown';
}

export function sanitizeName(value, fallback = 'Unknown') {
    return cleanText(value, cleanText(fallback, 'Unknown', DEFAULT_NAME_LENGTH), DEFAULT_NAME_LENGTH);
}

function sanitizeTeam(value) {
    const team = String(value || '').toLowerCase();
    return VALID_TEAMS.has(team) ? team : 'neutral';
}

function sanitizeTier(value) {
    return sanitizeId(String(value || 'normal').toLowerCase(), 'normal').slice(0, 24);
}

function sanitizeValue(value, depth = 0) {
    if (depth > 4 || value == null) return value == null ? null : undefined;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') return cleanText(value, '', 128);
    if (typeof value === 'boolean') return value;
    if (Array.isArray(value)) {
        return value.slice(0, 32)
            .map(item => sanitizeValue(item, depth + 1))
            .filter(item => item !== undefined);
    }
    if (typeof value === 'object') {
        const result = {};
        for (const [rawKey, item] of Object.entries(value).slice(0, 32)) {
            const key = sanitizeId(rawKey, '').slice(0, 48);
            const sanitized = sanitizeValue(item, depth + 1);
            if (key && sanitized !== undefined) result[key] = sanitized;
        }
        return result;
    }
    return undefined;
}

function actorFrom(value, fallbackId = 'unknown') {
    const source = value && typeof value === 'object' ? value : { id: value };
    const id = sanitizeId(
        source.id ?? source.playerId ?? source.actorId ?? source.name,
        fallbackId
    );
    return {
        id,
        name: sanitizeName(source.name, id),
        team: sanitizeTeam(source.team)
    };
}

function emptyStats(actor) {
    return {
        id: actor.id,
        name: actor.name,
        team: actor.team,
        rounds: 0,
        roundWins: 0,
        deflects: 0,
        deflectTiers: {},
        hits: 0,
        damage: 0,
        kos: 0,
        deaths: 0,
        clutches: 0,
        clutchWins: 0
    };
}

function emptyTeam(team) {
    return {
        team,
        rounds: 0,
        roundWins: 0,
        deflects: 0,
        deflectTiers: {},
        hits: 0,
        damage: 0,
        kos: 0,
        deaths: 0,
        clutches: 0,
        clutchWins: 0
    };
}

function addTier(stats, tier) {
    stats.deflectTiers[tier] = count(stats.deflectTiers[tier]) + 1;
}

function point(value, timestamp = 0) {
    const source = value?.position || value || {};
    return {
        t: Math.max(0, finite(value?.t ?? value?.time ?? timestamp)),
        x: finite(source.x),
        y: finite(source.y),
        z: finite(source.z)
    };
}

export function downsampleTrajectory(samples = [], limit = DEFAULT_MAX_TRAJECTORY_SAMPLES) {
    const cap = clampLimit(limit, DEFAULT_MAX_TRAJECTORY_SAMPLES);
    const source = Array.isArray(samples) ? samples.map(sample => point(sample, sample?.t)) : [];
    if (source.length <= cap) return source;
    if (cap === 1) return [source.at(-1)];
    const result = [];
    for (let index = 0; index < cap; index++) {
        result.push(source[Math.round(index * (source.length - 1) / (cap - 1))]);
    }
    return result;
}

export function buildHeatmap(samples = [], options = {}) {
    const columns = Math.min(128, clampLimit(options.columns ?? options.width, 16));
    const rows = Math.min(128, clampLimit(options.rows ?? options.height, 16));
    const points = Array.isArray(samples) ? samples.map(sample => point(sample, sample?.t)) : [];
    const requested = options.bounds || {};
    const xs = points.map(sample => sample.x);
    const zs = points.map(sample => sample.z);
    let minX = finite(requested.minX, xs.length ? Math.min(...xs) : 0);
    let maxX = finite(requested.maxX, xs.length ? Math.max(...xs) : minX + 1);
    let minZ = finite(requested.minZ, zs.length ? Math.min(...zs) : 0);
    let maxZ = finite(requested.maxZ, zs.length ? Math.max(...zs) : minZ + 1);
    if (maxX <= minX) maxX = minX + 1;
    if (maxZ <= minZ) maxZ = minZ + 1;
    const cells = Array.from({ length: rows }, () => Array(columns).fill(0));
    let total = 0;
    let max = 0;
    for (const sample of points) {
        if (sample.x < minX || sample.x > maxX || sample.z < minZ || sample.z > maxZ) continue;
        const column = Math.min(columns - 1, Math.floor((sample.x - minX) / (maxX - minX) * columns));
        const row = Math.min(rows - 1, Math.floor((sample.z - minZ) / (maxZ - minZ) * rows));
        cells[row][column]++;
        total++;
        max = Math.max(max, cells[row][column]);
    }
    return {
        columns,
        rows,
        bounds: { minX, maxX, minZ, maxZ },
        cells,
        max,
        total
    };
}

function mvpScore(player) {
    const tierBonus = Object.entries(player.deflectTiers)
        .reduce((total, [tier, amount]) => total + amount * (
            tier === 'perfect' ? 4 : tier === 'great' ? 3 : tier === 'good' ? 2 : 1
        ), 0);
    return player.kos * 100
        + player.clutchWins * 75
        + player.roundWins * 25
        + player.hits * 10
        + tierBonus
        + player.damage;
}

export class MatchAnalytics {
    constructor(options = {}) {
        this.maxEvents = clampLimit(options.maxEvents, DEFAULT_MAX_EVENTS);
        this.maxTrajectorySamples = clampLimit(
            options.maxTrajectorySamples ?? options.maxSamples,
            DEFAULT_MAX_TRAJECTORY_SAMPLES
        );
        this._now = typeof options.now === 'function' ? options.now : () => Date.now();
        this.reset();
    }

    reset() {
        this.startedAt = finite(this._now());
        this.events = [];
        this.trajectory = [];
        this.players = new Map();
        this.teams = new Map([
            ['red', emptyTeam('red')],
            ['blue', emptyTeam('blue')],
            ['neutral', emptyTeam('neutral')]
        ]);
        return this;
    }

    _player(value, fallbackId = 'unknown') {
        const actor = actorFrom(value, fallbackId);
        let stats = this.players.get(actor.id);
        if (!stats) {
            stats = emptyStats(actor);
            this.players.set(actor.id, stats);
        } else {
            if (actor.name !== actor.id || stats.name === stats.id) stats.name = actor.name;
            if (actor.team !== 'neutral') stats.team = actor.team;
        }
        return stats;
    }

    _team(team) {
        return this.teams.get(sanitizeTeam(team));
    }

    _add(type, data = {}, timestamp) {
        const previous = this.events.at(-1)?.t || 0;
        const supplied = timestamp ?? data.t ?? data.time;
        const elapsed = supplied == null ? finite(this._now()) - this.startedAt : finite(supplied);
        const event = {
            t: Math.max(previous, 0, elapsed),
            type: sanitizeId(String(type || 'event').toLowerCase(), 'event').slice(0, 32),
            data: sanitizeValue(data) || {}
        };
        this.events.push(event);
        if (this.events.length > this.maxEvents) {
            this.events.splice(0, this.events.length - this.maxEvents);
        }
        return event;
    }

    recordEvent(type, data = {}, timestamp) {
        switch (String(type || '').toLowerCase()) {
            case 'round': return this.recordRound(data, timestamp);
            case 'deflect': return this.recordDeflect(data, timestamp);
            case 'hit': return this.recordHit(data, timestamp);
            case 'ko':
            case 'kill': return this.recordKO(data, timestamp);
            case 'clutch': return this.recordClutch(data, timestamp);
            case 'trajectory':
            case 'sample': return this.recordTrajectory(data, timestamp);
            default: return this._add(type, data, timestamp);
        }
    }

    recordRound(data = {}, timestamp) {
        const winner = sanitizeTeam(data.winner ?? data.winnerTeam ?? data.team);
        const participants = Array.isArray(data.players) ? data.players : [];
        for (const team of ['red', 'blue']) this._team(team).rounds++;
        if (winner !== 'neutral') this._team(winner).roundWins++;
        for (const participant of participants) {
            const player = this._player(participant);
            player.rounds++;
            if (player.team === winner) player.roundWins++;
        }
        return this._add('round', {
            round: count(data.round ?? data.number),
            winner,
            players: participants.map(value => actorFrom(value))
        }, timestamp);
    }

    recordDeflect(data = {}, timestamp) {
        const player = this._player(data.player ?? data.actor ?? data, 'unknown');
        const tier = sanitizeTier(data.tier);
        player.deflects++;
        addTier(player, tier);
        const team = this._team(player.team);
        team.deflects++;
        addTier(team, tier);
        return this._add('deflect', {
            playerId: player.id,
            name: player.name,
            team: player.team,
            tier
        }, timestamp);
    }

    recordHit(data = {}, timestamp) {
        const attacker = this._player(data.attacker ?? data.player ?? data, 'unknown');
        const victim = data.victim == null ? null : actorFrom(data.victim, 'unknown');
        const damage = Math.max(0, finite(data.damage ?? data.amount));
        attacker.hits++;
        attacker.damage += damage;
        const team = this._team(attacker.team);
        team.hits++;
        team.damage += damage;
        return this._add('hit', {
            attackerId: attacker.id,
            victimId: victim?.id || null,
            team: attacker.team,
            damage
        }, timestamp);
    }

    recordKO(data = {}, timestamp) {
        const attacker = this._player(data.attacker ?? data.killer ?? data.player ?? data, 'unknown');
        const victimSource = data.victim ?? data.target;
        const victim = victimSource == null ? null : this._player(victimSource, 'unknown');
        attacker.kos++;
        this._team(attacker.team).kos++;
        if (victim) {
            victim.deaths++;
            this._team(victim.team).deaths++;
        }
        return this._add('ko', {
            attackerId: attacker.id,
            victimId: victim?.id || null,
            team: attacker.team
        }, timestamp);
    }

    recordClutch(data = {}, timestamp) {
        const player = this._player(data.player ?? data.actor ?? data, 'unknown');
        const won = data.won !== false && data.success !== false;
        player.clutches++;
        this._team(player.team).clutches++;
        if (won) {
            player.clutchWins++;
            this._team(player.team).clutchWins++;
        }
        return this._add('clutch', {
            playerId: player.id,
            team: player.team,
            won,
            opponents: count(data.opponents ?? data.against)
        }, timestamp);
    }

    recordTrajectory(position = {}, timestamp) {
        const sample = point(position, timestamp ?? finite(this._now()) - this.startedAt);
        const previous = this.trajectory.at(-1);
        if (previous) sample.t = Math.max(previous.t, sample.t);
        this.trajectory.push(sample);
        if (this.trajectory.length > this.maxTrajectorySamples) {
            this.trajectory = downsampleTrajectory(this.trajectory, this.maxTrajectorySamples);
        }
        return { ...sample };
    }

    sampleTrajectory(position, timestamp) {
        return this.recordTrajectory(position, timestamp);
    }

    getTimeline() {
        return this.events.map(event => ({
            t: event.t,
            type: event.type,
            data: sanitizeValue(event.data)
        }));
    }

    getPlayerStats() {
        return [...this.players.values()]
            .map(player => ({ ...player, deflectTiers: { ...player.deflectTiers } }))
            .sort((a, b) => a.id.localeCompare(b.id));
    }

    getTeamStats() {
        return [...this.teams.values()]
            .filter(team => team.team !== 'neutral' || Object.values(team).some(value => Number(value) > 0))
            .map(team => ({ ...team, deflectTiers: { ...team.deflectTiers } }))
            .sort((a, b) => a.team.localeCompare(b.team));
    }

    getMVP() {
        const ranked = this.getPlayerStats().sort((a, b) =>
            mvpScore(b) - mvpScore(a)
            || b.kos - a.kos
            || b.clutchWins - a.clutchWins
            || b.damage - a.damage
            || b.hits - a.hits
            || b.deflects - a.deflects
            || a.id.localeCompare(b.id)
        );
        if (!ranked.length) return null;
        return { ...ranked[0], mvpScore: mvpScore(ranked[0]) };
    }

    getTrajectory() {
        return this.trajectory.map(sample => ({ ...sample }));
    }

    getHeatmap(options = {}) {
        return buildHeatmap(this.trajectory, options);
    }

    getReport(options = {}) {
        return {
            version: 1,
            duration: Math.max(0, finite(this._now()) - this.startedAt),
            timeline: this.getTimeline(),
            players: this.getPlayerStats(),
            teams: this.getTeamStats(),
            mvp: this.getMVP(),
            trajectory: this.getTrajectory(),
            heatmap: this.getHeatmap(options.heatmap || options)
        };
    }

    report(options) {
        return this.getReport(options);
    }
}

export const createMatchAnalytics = options => new MatchAnalytics(options);
