// Main-menu global chat client: polls /api/chat/global while the menu is open,
// posts text and host lobby invites with the lobby identity (account or guest).
export const GLOBAL_CHAT_POLL_MS = 3000;
export const GLOBAL_CHAT_KEEP = 100;

export class GlobalChatClient {
    constructor({ fetchImpl = globalThis.fetch?.bind(globalThis), getToken = async () => '', onUpdate = () => {} } = {}) {
        this.fetch = fetchImpl;
        this.getToken = getToken;
        this.onUpdate = onUpdate;
        this.messages = [];
        this.latestId = 0;
        this.available = true;
        this._timer = null;
        this._inflight = false;
    }

    start() {
        if (this._timer) return;
        this.poll();
        this._timer = setInterval(() => this.poll(), GLOBAL_CHAT_POLL_MS);
    }

    stop() {
        clearInterval(this._timer);
        this._timer = null;
    }

    // Merges newer messages; returns the ones that were new.
    ingest(list = []) {
        const known = new Set(this.messages.map(message => message.id));
        const fresh = (Array.isArray(list) ? list : []).filter(message => Number.isInteger(message?.id) && !known.has(message.id));
        if (!fresh.length) return [];
        this.messages = [...this.messages, ...fresh].sort((a, b) => a.id - b.id).slice(-GLOBAL_CHAT_KEEP);
        this.latestId = Math.max(this.latestId, ...fresh.map(message => message.id));
        return fresh;
    }

    async poll() {
        if (this._inflight || !this.fetch) return;
        this._inflight = true;
        try {
            const response = await this.fetch(`/api/chat/global?after=${this.latestId}`, { cache: 'no-store' });
            if (!response.ok) throw new Error(String(response.status));
            const data = await response.json();
            const fresh = this.ingest(data?.messages);
            const wasAvailable = this.available;
            this.available = true;
            if (fresh.length || !wasAvailable) this.onUpdate(this.messages, fresh);
        } catch {
            if (this.available) { this.available = false; this.onUpdate(this.messages, []); }
        } finally {
            this._inflight = false;
        }
    }

    async _post(body) {
        if (!this.fetch) return { ok: false, code: 'offline' };
        const token = await this.getToken();
        if (!token) return { ok: false, code: 'sign_in_required' };
        try {
            const response = await this.fetch('/api/chat/global', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify(body)
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) return { ok: false, code: data.code || `http_${response.status}` };
            const fresh = this.ingest([data.message]);
            if (fresh.length) this.onUpdate(this.messages, fresh);
            return { ok: true, message: data.message };
        } catch {
            return { ok: false, code: 'offline' };
        }
    }

    send(text) {
        const clean = String(text ?? '').trim();
        if (!clean) return Promise.resolve({ ok: false, code: 'empty' });
        return this._post({ text: clean.slice(0, 200) });
    }

    shareLobby(code) {
        return this._post({ inviteCode: String(code ?? '') });
    }
}
