const KEY = 'dodgball_friends_v1';

export class FriendsList {
    constructor() {
        this.friends = this._load();
        this.onChange = null;
    }

    _load() {
        try {
            return JSON.parse(localStorage.getItem(KEY)) || [];
        } catch { return []; }
    }

    _save() {
        localStorage.setItem(KEY, JSON.stringify(this.friends));
        this.onChange?.();
    }

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
        this._save();
        return true;
    }

    isFriend(name) {
        return this.friends.includes(name);
    }

    getOnline(currentPlayers) {
        const names = new Set(currentPlayers.map(p => p.name?.toLowerCase()));
        return this.friends.filter(f => names.has(f.toLowerCase()));
    }
}

export const Friends = new FriendsList();
