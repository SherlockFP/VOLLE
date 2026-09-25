// App methods for the Clans screen (server clans: js/clan-client.js <->
// server/clan-store.js). Mixed into App by js/main.js (js/app-mixins.js).
import { account } from './account.js';
import { ClanClient } from './clan-client.js';
import { t } from './i18n.js';

export class ClanMethods {
    // Clans screen, server-backed (js/clan-client.js ↔ server/clan-store.js). Accounts
    // own a clan; guests see the top list and a free-account prompt.
    async _renderSocial() {
        const client = this.clanClient ||= new ClanClient({ getToken: () => account.getToken?.() || '' });
        const signedIn = !!account.getToken?.();
        const status = document.getElementById('social-status-text');
        if (status) status.textContent = t(signedIn ? 'clans.statusOnline' : 'clans.statusGuest');
        const [mine, top] = await Promise.all([signedIn ? client.mine() : Promise.resolve(null), client.top()]);
        const clan = mine?.ok ? mine.clan : null;
        this._myClan = clan;
        const box = document.getElementById('social-my-clan');
        const forms = document.getElementById('social-clan-forms');
        if (forms) forms.hidden = !signedIn || !!clan;
        if (box) {
            box.replaceChildren();
            if (!signedIn) {
                box.textContent = t('clans.needAccount');
            } else if (!clan) {
                box.textContent = t('clans.none');
            } else {
                const head = document.createElement('div');
                head.className = 'social-clan-head';
                const title = document.createElement('strong');
                title.textContent = `[${clan.tag}] ${clan.name}`;
                const record = document.createElement('span');
                record.textContent = t('clans.record', { wins: clan.record.wins, losses: clan.record.losses });
                head.append(title, record);
                const members = document.createElement('ul');
                members.className = 'social-clan-members';
                for (const member of clan.members) {
                    const row = document.createElement('li');
                    row.textContent = `${member.name}${member.role === 'owner' ? ' ★' : ''}${member.you ? ` (${t('clans.you')})` : ''}`;
                    members.append(row);
                }
                const recent = document.createElement('p');
                recent.className = 'social-clan-recent';
                recent.textContent = clan.recent.length
                    ? clan.recent.slice(-5).reverse().map(entry => `${entry.won ? '✓' : '✗'} ${entry.vs}`).join('  ')
                    : t('clans.noMatches');
                const leave = document.createElement('button');
                leave.type = 'button';
                leave.className = 'btn btn-secondary btn-small';
                leave.textContent = t('clans.leave');
                leave.addEventListener('click', () => this._leaveClan(), { once: true });
                box.append(head, members, recent, leave);
            }
        }
        const list = document.getElementById('social-top-clans');
        if (list) {
            list.replaceChildren();
            const clans = top?.ok ? top.clans : [];
            if (!clans.length) {
                const empty = document.createElement('li');
                empty.className = 'social-empty';
                empty.textContent = t('clans.topEmpty');
                list.append(empty);
            }
            for (const entry of clans) {
                const row = document.createElement('li');
                row.textContent = `#${entry.rank} [${entry.tag}] ${entry.name} · ${t('clans.record', { wins: entry.wins, losses: entry.losses })}`;
                list.append(row);
            }
        }
        await this._renderClanChat();
        const summary = document.getElementById('community-clan-summary');
        if (summary) summary.textContent = clan ? `[${clan.tag}] ${clan.name} · ${t('clans.record', { wins: clan.record.wins, losses: clan.record.losses })}` : t(signedIn ? 'clans.none' : 'clans.needAccount');
    }

    async _renderClanChat() {
        const chat = document.getElementById('social-chat-log');
        if (!chat) return;
        if (!this._myClan) {
            chat.textContent = t('clans.chatLocked');
            return;
        }
        const result = await this.clanClient.chat(0);
        chat.replaceChildren();
        const messages = result?.ok ? result.messages : [];
        for (const message of messages) {
            const row = document.createElement('p');
            row.className = 'social-chat-message';
            row.textContent = `${message.author}: ${this._chatClean(message.text)}`;
            chat.appendChild(row);
        }
        if (!messages.length) chat.textContent = t('clans.chatEmpty');
    }

    _clanError(result) {
        const key = { in_clan: 'clans.errInClan', bad_name: 'clans.errName', bad_tag: 'clans.errTag', tag_taken: 'clans.errTagTaken', name_taken: 'clans.errNameTaken', not_found: 'clans.errNotFound', full: 'clans.errFull', sign_in_required: 'clans.needAccount', rate_limited: 'toast.gchatRateLimited' }[result?.code];
        this.ui.showMessage?.(key ? t(key) : (result?.error || t('clans.errGeneric')), 2000);
    }

    async _createClan() {
        const name = document.getElementById('social-clan-name')?.value.trim();
        const tag = document.getElementById('social-clan-tag')?.value.trim();
        if (!name || !tag) return;
        const result = await this.clanClient?.create(name, tag);
        if (!result?.ok) return this._clanError(result);
        this.ui.showMessage?.(t('clans.created', { tag: result.clan.tag }), 1800);
        await this._renderSocial();
    }

    async _joinClan() {
        const tag = document.getElementById('social-join-tag')?.value.trim();
        if (!tag) return;
        const result = await this.clanClient?.join(tag);
        if (!result?.ok) return this._clanError(result);
        this.ui.showMessage?.(t('clans.joined', { tag: result.clan.tag }), 1800);
        await this._renderSocial();
    }

    async _leaveClan() {
        const result = await this.clanClient?.leave();
        if (!result?.ok) return this._clanError(result);
        await this._renderSocial();
    }

    async _sendClanMessage() {
        const input = document.getElementById('social-chat-input');
        const text = input?.value;
        if (!text || !this._myClan) return;
        const result = await this.clanClient?.post(text);
        if (!result?.ok) return this._clanError(result);
        input.value = '';
        await this._renderClanChat();
    }
}
