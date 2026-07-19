const MAX_EVENTS = 80;

export const ALLOWED_TRANSITIONS = Object.freeze({
    MENU: ['LOBBY', 'SOCIAL_HUB'],
    LOBBY: ['MENU', 'COUNTDOWN', 'SOCIAL_HUB'],
    COUNTDOWN: ['PLAYING', 'LOBBY', 'MENU', 'PAUSED'],
    PLAYING: ['ROUND_END', 'CELEBRATION', 'GAME_OVER', 'PAUSED', 'MENU'],
    ROUND_END: ['PLAYING', 'COUNTDOWN', 'GAME_OVER', 'MENU', 'PAUSED'],
    CELEBRATION: ['GAME_OVER', 'MENU', 'PAUSED'],
    GAME_OVER: ['LOBBY', 'COUNTDOWN', 'MENU', 'PAUSED'],
    PAUSED: ['PLAYING', 'ROUND_END', 'COUNTDOWN', 'GAME_OVER', 'CELEBRATION', 'SOCIAL_HUB', 'MENU'],
    SOCIAL_HUB: ['MENU', 'LOBBY', 'PAUSED']
});

export class RuntimeSafety {
    constructor(limit = MAX_EVENTS) {
        this.limit = Math.max(10, Number(limit) || MAX_EVENTS);
        this.events = [];
        this.installed = false;
    }

    log(type, details = {}) {
        const event = { at: Date.now(), type: String(type), details };
        this.events.push(event);
        if (this.events.length > this.limit) this.events.shift();
        return event;
    }

    auditTransition(from, to) {
        const valid = from === to || (ALLOWED_TRANSITIONS[from] || []).includes(to);
        this.log(valid ? 'state' : 'invalid-state', { from, to });
        return valid;
    }

    install(target = globalThis) {
        if (this.installed || !target?.addEventListener) return;
        this.installed = true;
        target.addEventListener('error', event => this.log('error', {
            message: event.message,
            source: event.filename,
            line: event.lineno,
            column: event.colno
        }));
        target.addEventListener('unhandledrejection', event => this.log('promise', {
            message: String(event.reason?.message || event.reason || 'Unhandled rejection')
        }));
    }

    report(context = {}) {
        return {
            generatedAt: Date.now(),
            userAgent: globalThis.navigator?.userAgent || 'node',
            context,
            events: this.events.slice()
        };
    }
}

export const RuntimeLog = new RuntimeSafety();
