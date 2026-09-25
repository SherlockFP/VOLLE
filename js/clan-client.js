// Server clans client (server/clan-store.js via /api/clans/*). Accounts only:
// without a token every call resolves { ok: false, code: 'sign_in_required' }.
export class ClanClient {
    constructor({ fetchImpl = globalThis.fetch?.bind(globalThis), getToken = () => '' } = {}) {
        this.fetch = fetchImpl;
        this.getToken = getToken;
    }

    async _call(path, { method = 'GET', body = null, auth = true } = {}) {
        if (!this.fetch) return { ok: false, code: 'offline' };
        const headers = {};
        if (auth) {
            const token = await this.getToken();
            if (!token) return { ok: false, code: 'sign_in_required' };
            headers.Authorization = `Bearer ${token}`;
        }
        if (body) headers['Content-Type'] = 'application/json';
        try {
            const response = await this.fetch(path, { method, headers, cache: 'no-store', ...(body ? { body: JSON.stringify(body) } : {}) });
            const data = await response.json().catch(() => ({}));
            return response.ok ? { ok: true, ...data } : { ok: false, code: data.code || `http_${response.status}`, error: data.error || '' };
        } catch {
            return { ok: false, code: 'offline' };
        }
    }

    mine() { return this._call('/api/clans/mine'); }
    top() { return this._call('/api/clans/top', { auth: false }); }
    create(name, tag) { return this._call('/api/clans/create', { method: 'POST', body: { name: String(name ?? '').slice(0, 24), tag: String(tag ?? '').slice(0, 5) } }); }
    join(tag) { return this._call('/api/clans/join', { method: 'POST', body: { tag: String(tag ?? '').slice(0, 5) } }); }
    leave() { return this._call('/api/clans/leave', { method: 'POST', body: {} }); }
    chat(after = 0) { return this._call(`/api/clans/chat?after=${Math.max(0, Math.floor(Number(after) || 0))}`); }
    post(text) { return this._call('/api/clans/chat', { method: 'POST', body: { text: String(text ?? '').slice(0, 160) } }); }
}
