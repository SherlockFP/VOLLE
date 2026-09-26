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
        this._clanChatShownId = null;
        const box = document.getElementById('social-my-clan');
        const forms = document.getElementById('social-clan-forms');
        if (forms) forms.hidden = !signedIn || !!clan;
        const el = (tag, className, text) => {
            const node = document.createElement(tag);
            if (className) node.className = className;
            if (text !== undefined) node.textContent = text;
            return node;
        };
        if (box) {
            box.replaceChildren();
            box.classList.toggle('is-member', !!clan);
            if (!signedIn) {
                const cta = el('button', 'btn btn-primary btn-small', t('common.createFreeAccount'));
                cta.type = 'button';
                cta.addEventListener('click', () => this._promptAccount?.({ key: 'clans.needAccount' }));
                box.append(el('p', 'clan-note', t('clans.needAccount')), cta);
            } else if (!clan) {
                box.append(el('p', 'clan-note', t('clans.none')));
            } else {
                const head = el('div', 'social-clan-head');
                head.append(el('span', 'clan-tag', clan.tag), el('strong', 'clan-name', clan.name));
                const { wins, losses, matches } = clan.record;
                const stats = el('div', 'clan-stats');
                for (const [value, label, tone] of [[wins, t('clans.wins'), 'win'], [losses, t('clans.losses'), 'loss'],
                    [matches ? `${Math.round(wins / matches * 100)}%` : '—', t('clans.winRate'), ''], [clan.members.length, t('clans.members'), '']]) {
                    const stat = el('span', `clan-stat${tone ? ` is-${tone}` : ''}`);
                    stat.append(el('b', '', String(value)), el('small', '', label));
                    stats.append(stat);
                }
                const members = el('ul', 'social-clan-members');
                for (const member of clan.members) {
                    const row = el('li', `${member.role === 'owner' ? 'is-owner' : ''}${member.you ? ' is-you' : ''}`.trim(), member.name);
                    if (member.role === 'owner') row.title = t('clans.owner');
                    if (member.you) row.append(el('small', '', t('clans.you')));
                    members.append(row);
                }
                const recent = el('ul', 'social-clan-recent');
                if (clan.recent.length) {
                    for (const entry of clan.recent.slice(-5).reverse()) {
                        recent.append(el('li', entry.won ? 'is-win' : 'is-loss', `${entry.won ? '✓' : '✗'} ${entry.vs}`));
                    }
                } else recent.append(el('li', 'is-empty', t('clans.noMatches')));
                const leave = el('button', 'btn btn-secondary btn-small clan-leave', t('clans.leave'));
                leave.type = 'button';
                leave.addEventListener('click', () => this._leaveClan(), { once: true });
                box.append(head, stats, el('p', 'clan-sub', t('clans.membersTitle')), members,
                    el('p', 'clan-sub', t('clans.recentTitle')), recent, leave);
            }
        }
        const list = document.getElementById('social-top-clans');
        if (list) {
            list.replaceChildren();
            const clans = top?.ok ? top.clans : [];
            if (!clans.length) list.append(el('li', 'social-empty', t('clans.topEmpty')));
            for (const entry of clans) {
                const row = el('li', `clan-row${clan && entry.tag === clan.tag ? ' is-mine' : ''}`);
                row.append(el('span', 'clan-rank', String(entry.rank)), el('span', 'clan-tag', entry.tag),
                    el('span', 'clan-row-name', entry.name), el('span', 'clan-row-record', t('clans.record', { wins: entry.wins, losses: entry.losses })));
                list.append(row);
            }
        }
        await this._renderClanChat();
        const summary = document.getElementById('community-clan-summary');
        if (summary) summary.textContent = clan ? `[${clan.tag}] ${clan.name} · ${t('clans.record', { wins: clan.record.wins, losses: clan.record.losses })}` : t(signedIn ? 'clans.none' : 'clans.needAccount');
    }

    // Clan chat as bubbles (author, time, text; yours on the right). The 4 s poll
    // only rebuilds when a new message arrived, and keeps a reader's scroll
    // position unless they were already at the bottom.
    async _renderClanChat({ toBottom = false } = {}) {
        const chat = document.getElementById('social-chat-log');
        if (!chat) return;
        if (!this._myClan) {
            this._clanChatShownId = null;
            chat.replaceChildren(Object.assign(document.createElement('p'), { className: 'clan-chat-note', textContent: t('clans.chatLocked') }));
            return;
        }
        const result = await this.clanClient.chat(0);
        const messages = result?.ok ? result.messages : [];
        const lastId = messages.at(-1)?.id ?? 0;
        if (this._clanChatShownId === lastId) return;
        const firstPaint = this._clanChatShownId === null;
        this._clanChatShownId = lastId;
        const atBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 24;
        chat.replaceChildren();
        const me = this._myClan.members?.find(member => member.you)?.name;
        for (const message of messages) {
            const row = document.createElement('div');
            row.className = `social-chat-message${message.author === me ? ' is-mine' : ''}`;
            const meta = document.createElement('div');
            meta.className = 'clan-msg-meta';
            const author = document.createElement('b');
            author.textContent = message.author;
            const time = document.createElement('time');
            const at = new Date(message.at);
            if (Number.isFinite(at.getTime())) {
                time.dateTime = at.toISOString();
                time.textContent = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }
            meta.append(author, time);
            const text = document.createElement('p');
            text.textContent = this._chatClean(message.text);
            row.append(meta, text);
            chat.appendChild(row);
        }
        if (!messages.length) chat.replaceChildren(Object.assign(document.createElement('p'), { className: 'clan-chat-note', textContent: t('clans.chatEmpty') }));
        else if (toBottom || firstPaint || atBottom) chat.scrollTop = chat.scrollHeight;
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
        await this._renderClanChat({ toBottom: true });
    }
}
