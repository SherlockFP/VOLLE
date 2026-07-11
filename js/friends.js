const KEY = 'dodgball_friends_v1';
const DM_KEY = 'dodgball_friend_dms_v1';

export class FriendsList {
    constructor() {
        this.friends = this._load();
        this.dms = this._loadDMs();
        this.onChange = null;
        this.onDM = null;
    }

    _load() {
        try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
    }
    _save() { localStorage.setItem(KEY, JSON.stringify(this.friends)); this.onChange?.(); }
    _loadDMs() {
        try { return JSON.parse(localStorage.getItem(DM_KEY)) || {}; } catch { return {}; }
    }
    _saveDMs() { localStorage.setItem(DM_KEY, JSON.stringify(this.dms)); }

    add(name) {
        if (!name || this.friends.includes(name)) return false;
        this.friends.push(name);
        this._save();
        return true;
    }
    remove(name) {
        const idx = this.friends.indexOf(name);
        if (idx === -1) return false;
        this.friends.splice(idx, 1);
        delete this.dms[name];
        this._save();
        this._saveDMs();
        return true;
    }
    isFriend(name) { return this.friends.includes(name); }

    getOnline(currentPlayers) {
        const names = new Set(currentPlayers.map(p => p.name?.toLowerCase()));
        return this.friends.filter(f => names.has(f.toLowerCase()));
    }

    addDM(friendName, from, text) {
        if (!this.dms[friendName]) this.dms[friendName] = [];
        this.dms[friendName].push({ from, text, time: Date.now() });
        if (this.dms[friendName].length > 50) this.dms[friendName].shift();
        this._saveDMs();
        this.onDM?.(friendName, from, text);
    }
    getDMs(friendName) { return this.dms[friendName] || []; }
}

export const Friends = new FriendsList();
