// App methods for chat: the chat filter, the main-menu global chat
// (js/global-chat.js) and lobby invites / code sharing. Mixed into App by
// js/main.js (js/app-mixins.js).
import { filterChatText } from './chat-filter.js';
import { GlobalChatClient } from './global-chat.js';
import { STATES } from './game.js';
import { t } from './i18n.js';

export class GlobalChatMethods {
    // Reader-side chat filter (Settings > Gameplay > Chat Filter, on by default).
    _chatClean(text) {
        return filterChatText(text, { enabled: this.store.get('settings')?.chatFilter !== false });
    }

    // --- Global chat (main menu social rail) ------------------------------------
    _initGlobalChat() {
        if (this.globalChat) return;
        this._globalChatUnread = 0;
        this.globalChat = new GlobalChatClient({
            getToken: () => this._lobbyAuthToken(),
            onUpdate: (_all, fresh) => {
                if (this._friendsRailTab !== 'global') this._globalChatUnread += fresh.length;
                this._renderGlobalChat();
            }
        });
        const syncPolling = screen => {
            if (screen === 'mainMenu') this.globalChat.start();
            else this.globalChat.stop();
        };
        window.addEventListener('warrball:screen', event => syncPolling(event.detail?.screen), { signal: this._mainAbort.signal });
        syncPolling(document.body.dataset.screen);
        document.getElementById('global-chat-form')?.addEventListener('submit', async event => {
            event.preventDefault();
            const input = document.getElementById('global-chat-input');
            const text = input?.value.trim();
            if (!text) return;
            const result = await this.globalChat.send(text);
            if (result.ok) { if (input) input.value = ''; return; }
            this.ui.showMessage?.(t(this._globalChatErrorKey(result.code)), 2200);
        }, { signal: this._mainAbort.signal });
    }

    _globalChatErrorKey(code) {
        return {
            rate_limited: 'toast.gchatSlowDown',
            duplicate: 'toast.gchatDuplicate',
            invite_cooldown: 'toast.gchatInviteCooldown',
            not_host: 'toast.gchatHostOnly',
            lobby_unavailable: 'toast.gchatLobbyUnlisted',
            sign_in_required: 'toast.gchatNoIdentity'
        }[code] || 'toast.gchatOffline';
    }

    _renderGlobalChat() {
        const badge = document.getElementById('global-chat-unread');
        if (badge) {
            badge.hidden = !(this._globalChatUnread > 0);
            badge.textContent = this._globalChatUnread > 99 ? '99+' : String(this._globalChatUnread || '');
        }
        const log = document.getElementById('global-chat-log');
        if (!log || this._friendsRailTab !== 'global' || !this.globalChat) return;
        const muted = new Set(this.store.get('mutedPlayers') || []);
        const messages = this.globalChat.messages.filter(message => !muted.has(message.author));
        const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
        if (!messages.length) {
            const empty = document.createElement('li');
            empty.className = 'global-chat-empty';
            empty.textContent = t(this.globalChat.available ? 'gchat.empty' : 'gchat.unavailable');
            log.replaceChildren(empty);
            return;
        }
        log.replaceChildren(...messages.map(message => {
            const item = document.createElement('li');
            item.className = message.kind === 'invite' ? 'global-chat-msg global-chat-invite' : 'global-chat-msg';
            const author = document.createElement('b');
            author.textContent = this._chatClean(String(message.author || 'Player'));
            if (message.guest) author.classList.add('is-guest');
            if (message.kind !== 'invite' || !message.invite) {
                item.append(author, document.createTextNode(` ${this._chatClean(String(message.text || ''))}`));
                return item;
            }
            const invite = message.invite;
            const title = document.createElement('span');
            title.className = 'global-chat-invite-title';
            title.append(author, document.createTextNode(` ${t('gchat.invites')}`));
            const room = document.createElement('strong');
            room.textContent = `${invite.locked ? '🔒 ' : ''}${this._chatClean(String(invite.name || 'Lobby'))}`;
            const meta = document.createElement('small');
            const count = invite.maxPlayers ? `${invite.players}/${invite.maxPlayers}` : String(invite.players || 1);
            meta.textContent = [invite.mode, invite.map, t('gchat.players', { count })].filter(Boolean).join(' · ');
            const actions = document.createElement('span');
            actions.className = 'global-chat-invite-actions';
            const join = document.createElement('button');
            join.type = 'button';
            join.className = 'btn btn-primary btn-small';
            join.textContent = t('gchat.join');
            join.addEventListener('click', () => this._joinFromGlobalInvite(invite));
            const copy = document.createElement('button');
            copy.type = 'button';
            copy.className = 'btn btn-secondary btn-small';
            copy.textContent = t('gchat.copy');
            copy.addEventListener('click', () => this._copyLobbyCode(invite.code));
            actions.append(join, copy);
            item.append(title, room, meta, actions);
            return item;
        }));
        if (nearBottom) log.scrollTop = log.scrollHeight;
    }

    // Online rooms only: copy for everyone, share for the host. Re-run once the
    // room code exists (the lobby screen opens before hosting finishes).
    _syncLobbyShareRow() {
        const isHost = this.network?.isHost === true;
        const online = !!this._lobbyCode && (isHost || this.network?.connected === true);
        const row = document.querySelector('.cs-share-row');
        if (row) row.hidden = !online;
        const share = document.getElementById('btn-lobby-share-global');
        if (share) share.hidden = !(online && isHost);
    }

    async _copyLobbyCode(code) {
        const value = String(code || '').trim();
        if (!value) return;
        try {
            await navigator.clipboard.writeText(value);
            this.ui.showMessage?.(t('toast.lobbyCodeCopied', { code: value }), 1600);
        } catch {
            window.prompt(t('toast.lobbyCodeCopyManual'), value);
        }
    }

    async _joinFromGlobalInvite(invite) {
        const code = String(invite?.code || '').trim();
        if (!code || this.game.state !== STATES.MENU) return;
        // Password lobbies (and ranked) go through Join by Code so the player can
        // type the password; open ones join straight away.
        if (invite.locked || invite.ranked) {
            const input = document.getElementById('join-code-input');
            if (input) input.value = code;
            this.ui.showScreen('joinMenu');
            document.getElementById('join-pass-input')?.focus();
            return;
        }
        const name = document.getElementById('player-name-input')?.value?.trim() || 'Player';
        await this._joinOnlineLobby(code, name, '');
    }

    async _shareLobbyToGlobalChat() {
        const code = this._lobbyCode;
        if (!code || !this.network?.isHost) {
            this.ui.showMessage?.(t('toast.gchatHostOnly'), 2200);
            return;
        }
        this._initGlobalChat();
        const result = await this.globalChat.shareLobby(code);
        this.ui.showMessage?.(t(result.ok ? 'toast.gchatShared' : this._globalChatErrorKey(result.code)), 2400);
    }
}
