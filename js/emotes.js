// emotes.js — Quick chat wheel + emote system. Sosyal bağımlılık.
// ponytail: tek dosya, canvas sprite emote'lar, wheel UI DOM'da.
import * as THREE from 'three';

export const EMOTES = [
    { id: 'nice', emoji: '👍', icon: 'i-thumb-up', text: 'Nice!' },
    { id: 'gg', emoji: '🤝', icon: 'i-handshake', text: 'GG' },
    { id: 'oops', emoji: '😅', icon: 'i-alert', text: 'Oops' },
    { id: 'wow', emoji: '😮', icon: 'i-spark', text: 'Wow!' },
    { id: 'fire', emoji: '🔥', icon: 'i-flame', text: 'On fire!' },
    { id: 'cry', emoji: '😭', icon: 'i-tear', text: 'No!' },
    { id: 'laugh', emoji: '😂', icon: 'i-laugh', text: 'Haha' },
    { id: 'angry', emoji: '😡', icon: 'i-angry', text: 'Rage' },
    { id: 'clap', emoji: '👏', icon: 'i-clap', text: 'Clap' },
    { id: 'flex', emoji: '💪', icon: 'i-flex', text: 'Flex' },
    { id: 'heart', emoji: '❤️', icon: 'i-heart', text: 'Love' },
    { id: 'skull', emoji: '💀', icon: 'i-skull', text: 'Dead' },
    // Callouts (second wheel page): short team comms. Their sprite carries the
    // text under the emoji, and teammates also get it as a HUD line.
    { id: 'incoming', emoji: '⚠️', icon: 'i-alert', text: 'Incoming!', callout: true },
    { id: 'cover', emoji: '🛡️', icon: 'i-shield', text: 'Cover me', callout: true },
    { id: 'go', emoji: '🚀', icon: 'i-spark', text: 'Go go go!', callout: true },
    { id: 'help', emoji: '🆘', icon: 'i-alert', text: 'Help!', callout: true },
    { id: 'save', emoji: '🧤', icon: 'i-spark', text: 'Nice save!', callout: true },
    { id: 'thanks', emoji: '🙏', icon: 'i-heart', text: 'Thanks!', callout: true },
    { id: 'sorry', emoji: '🙇', icon: 'i-tear', text: 'Sorry', callout: true },
    { id: 'wp', emoji: '🎯', icon: 'i-clap', text: 'Well played', callout: true }
];

// Wheel pages: Tab / mouse wheel / the tabs under the wheel switch them.
export const EMOTE_PAGES = Object.freeze([
    Object.freeze({ id: 'emotes', label: 'Emotes', ids: Object.freeze(EMOTES.filter(e => !e.callout).map(e => e.id)) }),
    Object.freeze({ id: 'callouts', label: 'Callouts', ids: Object.freeze(EMOTES.filter(e => e.callout).map(e => e.id)) })
]);

export function emotePageOf(id) {
    const index = EMOTE_PAGES.findIndex(page => page.ids.includes(id));
    return index < 0 ? 0 : index;
}

export function isEmoteId(id) {
    return typeof id === 'string' && EMOTES.some(e => e.id === id);
}

export function getEmote(id) {
    return EMOTES.find(e => e.id === id) || null;
}

export const EMOTE_DURATION = 3;
// Default height of the emoji above entity.position (bots/avatars stand at y = 0).
// Players carry their eye height in position.y, so callers pass a smaller offset.
export const EMOTE_OFFSET_Y = 2.8;

// Keys the open wheel consumes: they must not also reach the game's document-level
// handlers (Enter opened chat, Space jumped, Escape opened the pause menu).
const WHEEL_KEYS = new Set(['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape', 'Tab', 'PageUp', 'PageDown']);
// Digit 1..9, 0 send slot 1..10 of the open page.
const DIGIT_SLOT = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5, Digit7: 6, Digit8: 7, Digit9: 8, Digit0: 9 };
// Pointer farther than this from the centre aims a slot.
const AIM_DEAD_ZONE = 58;
// Pointer-locked mouse (normal desktop play): movement drives a virtual cursor
// from the centre, capped at AIM_VECTOR_MAX, aiming past AIM_VECTOR_DEAD_ZONE.
const AIM_VECTOR_DEAD_ZONE = 36;
const AIM_VECTOR_MAX = 150;
// Pointer events stopped at the full-screen wheel backdrop so hovering/clicking an
// emote neither turns the camera (mousemove) nor swings the knife (mousedown).
const WHEEL_SWALLOWED_EVENTS = ['mousemove', 'mousedown', 'mouseup', 'contextmenu', 'wheel'];

export class EmoteSystem {
    constructor(scene) {
        this.scene = scene;
        this.activeEmotes = new Map(); // entity → { sprite, timer }
        this.wheelOpen = false;
        this.onEmote = null; // callback(emote, entity)
        this.onEmoteSelect = null; // wheel choice
        this.onWheelCancel = null; // Esc / click outside the wheel
        this.label = emote => emote.text; // App swaps in the translated label
        this.pageLabel = page => page.label;
        this._wheelState = null;
    }

    // Emote göster — entity'nin üstünde sprite belirir.
    show(entity, emoteId, { offsetY = EMOTE_OFFSET_Y } = {}) {
        const emote = getEmote(emoteId);
        if (!emote || !entity) return false;

        // Keyed by the entity object: two players may share a display name.
        const key = entity;
        const old = this.activeEmotes.get(key);
        if (old) this._disposeSprite(old.sprite);

        // Callouts are read, not just seen: emoji over a short outlined label.
        const canvas = document.createElement('canvas');
        canvas.width = emote.callout ? 256 : 128; canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (emote.callout) {
            ctx.font = '60px serif';
            ctx.fillText(emote.emoji, 128, 40);
            ctx.font = '800 30px sans-serif';
            ctx.lineWidth = 7;
            ctx.strokeStyle = 'rgba(4, 12, 20, 0.92)';
            ctx.fillStyle = '#f4fbff';
            const text = String(this.label(emote) || emote.text).slice(0, 18);
            ctx.strokeText?.(text, 128, 100);
            ctx.fillText(text, 128, 100);
        } else {
            ctx.font = '80px serif';
            ctx.fillText(emote.emoji, 64, 64);
        }

        const tex = new THREE.CanvasTexture(canvas);
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(emote.callout ? 3 : 1.5, 1.5, 1);

        const data = { sprite, timer: EMOTE_DURATION, entity, emote, offsetY: Number.isFinite(offsetY) ? offsetY : EMOTE_OFFSET_Y };
        this._placeSprite(data);
        this.scene.add(sprite);
        this.activeEmotes.set(key, data);
        this.onEmote?.(emote, entity);
        return true;
    }

    // Float up, pop in, fade out. Must be ticked every frame (Game.update) — without
    // it a new emote sat at the world origin forever and never animated.
    _placeSprite(data) {
        const pos = data.entity.getPosition ? data.entity.getPosition() : data.entity.position;
        const age = EMOTE_DURATION - data.timer;
        if (pos) data.sprite.position.set(pos.x, pos.y + data.offsetY + age * 0.5, pos.z);
        data.sprite.material.opacity = Math.min(1, data.timer * 1.5);
        const pop = 1.5 * Math.min(1, Math.max(0.05, age * 4));
        data.sprite.scale.set(pop * (data.emote?.callout ? 2 : 1), pop, 1);
    }

    update(dt) {
        if (!this.activeEmotes.size) return;
        this.activeEmotes.forEach((data, key) => {
            data.timer -= dt;
            if (data.timer <= 0 || data.entity?.alive === false) {
                this._disposeSprite(data.sprite);
                this.activeEmotes.delete(key);
                return;
            }
            this._placeSprite(data);
        });
    }

    // Sprites own a per-emote CanvasTexture + material; release both with the sprite.
    _disposeSprite(sprite) {
        if (!sprite) return;
        this.scene.remove(sprite);
        sprite.material?.map?.dispose?.();
        sprite.material?.dispose?.();
    }

    // Radial wheel (DOM). center: {x, y} in screen px. Options: `selectedId`
    // (opens on its page, preselected: the last one sent), `hint` (centre line).
    // Pointer past the dead zone aims a slot; click / Enter / Space / 1..0 send;
    // Tab, PageUp/Down, the mouse wheel or the tabs switch page; Esc or a click in
    // the dead centre cancels. confirmWheel() sends the current selection (App
    // calls it when a held Z is released after aiming).
    showWheel(center, { selectedId = null, hint = null } = {}) {
        this.hideWheel();
        this.wheelOpen = true;
        const make = (tag, className, text) => {
            const node = document.createElement(tag);
            if (className) node.className = className;
            if (text !== undefined) node.textContent = text;
            return node;
        };
        const wheel = make('div', 'emote-wheel');
        wheel.id = 'emote-wheel';
        wheel.setAttribute('role', 'menu');
        wheel.setAttribute('aria-label', 'Quick chat emotes');
        wheel.style.left = `${center.x}px`;
        wheel.style.top = `${center.y}px`;
        const radius = Math.min(132, Math.max(112, Math.min(window.innerWidth, window.innerHeight) * 0.29));
        const needle = make('div', 'emote-wheel-needle');
        wheel.appendChild(needle);
        const centerCopy = make('div', 'emote-wheel-center');
        const pageName = make('span', 'emote-wheel-page');
        const bigEmoji = make('b', 'emote-wheel-emoji');
        const label = make('strong', '');
        label.id = 'emote-wheel-selection';
        const hintLine = make('small', '', hint || 'Click · Enter · 1-0 to send');
        centerCopy.appendChild(pageName);
        centerCopy.appendChild(bigEmoji);
        centerCopy.appendChild(label);
        centerCopy.appendChild(hintLine);
        wheel.appendChild(centerCopy);
        const tabs = make('div', 'emote-wheel-tabs');
        tabs.setAttribute('role', 'tablist');
        const tabButtons = EMOTE_PAGES.map((page, index) => {
            const tab = make('button', 'emote-wheel-tab', this.pageLabel(page));
            tab.type = 'button';
            tab.setAttribute('role', 'tab');
            tab.tabIndex = -1;
            tab.addEventListener('click', event => { event.stopPropagation?.(); setPage(index); });
            tabs.appendChild(tab);
            return tab;
        });
        wheel.appendChild(tabs);

        const state = { page: emotePageOf(selectedId), selected: 0, aimed: false, buttons: [], wheel, vx: 0, vy: 0, cleanup: [] };
        this._wheelState = state;
        const items = () => EMOTE_PAGES[state.page].ids.map(getEmote);
        const selectIndex = (index, { aim = false } = {}) => {
            const list = items();
            const selected = (index + list.length) % list.length;
            state.selected = selected;
            if (aim) state.aimed = true;
            state.buttons.forEach((button, buttonIndex) => {
                const active = buttonIndex === selected;
                button.classList.toggle('is-selected', active);
                button.setAttribute('aria-checked', String(active));
                button.tabIndex = active ? 0 : -1;
            });
            wheel.dataset.selectedIndex = String(selected);
            wheel.style.setProperty('--emote-angle', `${(selected / list.length) * 360}deg`);
            // Focus follows an aimed slot, so the focus ring never marks a second one.
            if (aim && document.activeElement !== state.buttons[selected]) state.buttons[selected]?.focus?.({ preventScroll: true });
            label.textContent = this.label(list[selected]);
            bigEmoji.textContent = list[selected].emoji;
            return selected;
        };
        const chooseIndex = index => {
            const selected = selectIndex(index);
            this.onEmoteSelect?.(items()[selected].id);
        };
        const render = () => {
            for (const button of state.buttons) button.remove();
            state.buttons = [];
            const list = items();
            wheel.dataset.page = EMOTE_PAGES[state.page].id;
            pageName.textContent = this.pageLabel(EMOTE_PAGES[state.page]);
            tabButtons.forEach((tab, index) => {
                tab.classList.toggle('is-active', index === state.page);
                tab.setAttribute('aria-selected', String(index === state.page));
            });
            list.forEach((emote, i) => {
                const angle = (i / list.length) * Math.PI * 2 - Math.PI / 2;
                const btn = make('button', `emote-wheel-item${emote.callout ? ' is-callout' : ''}`);
                btn.type = 'button';
                btn.setAttribute('role', 'menuitemradio');
                btn.setAttribute('aria-checked', 'false');
                btn.style.setProperty('--emote-x', `${Math.cos(angle) * radius}px`);
                btn.style.setProperty('--emote-y', `${Math.sin(angle) * radius}px`);
                const text = this.label(emote);
                btn.appendChild(make('span', 'emote-wheel-glyph', emote.emoji));
                btn.appendChild(make('small', '', text));
                if (i < 10) btn.appendChild(make('kbd', '', String((i + 1) % 10)));
                btn.title = text;
                btn.setAttribute('aria-label', text);
                btn.dataset.emote = emote.id;
                btn.addEventListener('pointerenter', () => selectIndex(i, { aim: true }));
                btn.addEventListener('focus', () => selectIndex(i));
                btn.addEventListener('click', () => chooseIndex(i));
                state.buttons.push(btn);
                wheel.appendChild(btn);
            });
        };
        const setPage = index => {
            const next = ((index % EMOTE_PAGES.length) + EMOTE_PAGES.length) % EMOTE_PAGES.length;
            if (next === state.page && state.buttons.length) return;
            state.page = next;
            render();
            selectIndex(0);
            state.buttons[0]?.focus({ preventScroll: true });
        };
        // The wheel's ::before dim layer makes the whole screen its hit area; keep those
        // pointer events away from the game (camera look, knife swing on click).
        for (const type of WHEEL_SWALLOWED_EVENTS) {
            wheel.addEventListener(type, event => {
                event.stopPropagation();
                // Keep keyboard focus on the wheel buttons (a blur let Enter open chat).
                if (type === 'mousedown') event.preventDefault();
                if (type === 'wheel' && Math.abs(event.deltaY || 0) > 0) {
                    event.preventDefault?.();
                    setPage(state.page + Math.sign(event.deltaY));
                }
            });
        }
        const aimAt = (dx, dy, deadZone) => {
            const aimed = Math.hypot(dx, dy) >= deadZone;
            wheel.classList.toggle('is-aiming', aimed);
            if (!aimed) { state.aimed = false; return; }
            const count = state.buttons.length;
            const normalized = (Math.atan2(dy, dx) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
            selectIndex(Math.round((normalized / (Math.PI * 2)) * count) % count, { aim: true });
        };
        // Pointer lock stays on while the wheel is open (the cursor used to reappear
        // wherever the match locked it and pre-aim a random slot). Locked mouse
        // events target the canvas, never the wheel: catch them first at the
        // document (capture) so the camera does not turn and the knife does not
        // swing, and aim with the movement instead. Events inside the wheel (a
        // visible cursor: touch, or no lock) keep the wheel's own handlers.
        const outside = event => !event.target?.closest?.('#emote-wheel');
        const onMove = event => {
            if (!outside(event)) return;
            event.stopPropagation();
            state.vx += Number(event.movementX) || 0;
            state.vy += Number(event.movementY) || 0;
            const length = Math.hypot(state.vx, state.vy);
            if (length > AIM_VECTOR_MAX) { state.vx *= AIM_VECTOR_MAX / length; state.vy *= AIM_VECTOR_MAX / length; }
            aimAt(state.vx, state.vy, AIM_VECTOR_DEAD_ZONE);
        };
        const onDown = event => {
            if (!outside(event)) return;
            event.preventDefault();
            event.stopPropagation();
            if (event.button === 0 && state.aimed) chooseIndex(state.selected);
            else if (event.button === 0 || event.button === 2) this.onWheelCancel?.();
        };
        const onSwallow = event => { if (outside(event)) event.stopPropagation(); };
        const onScroll = event => {
            if (!outside(event)) return;
            event.stopPropagation();
            if (Math.abs(event.deltaY || 0) > 0) setPage(state.page + Math.sign(event.deltaY));
        };
        for (const [type, listener] of [['mousemove', onMove], ['mousedown', onDown], ['mouseup', onSwallow], ['contextmenu', onDown], ['wheel', onScroll]]) {
            document.addEventListener(type, listener, true);
            state.cleanup.push(() => document.removeEventListener(type, listener, true));
        }
        wheel.addEventListener('pointermove', event => {
            const bounds = wheel.getBoundingClientRect();
            aimAt(event.clientX - (bounds.left + bounds.width / 2), event.clientY - (bounds.top + bounds.height / 2), AIM_DEAD_ZONE);
        });
        // Radial behaviour: a click anywhere confirms the aimed slice; a click in the
        // dead centre (nothing aimed) cancels.
        wheel.addEventListener('click', event => {
            if (event.target?.closest?.('.emote-wheel-item') || event.target?.closest?.('.emote-wheel-tab')) return;
            if (state.aimed) chooseIndex(state.selected);
            else this.onWheelCancel?.();
        });
        wheel.addEventListener('keydown', event => {
            const current = state.selected;
            if (WHEEL_KEYS.has(event.key) || event.code in DIGIT_SLOT) event.stopPropagation();
            if (['ArrowRight', 'ArrowDown'].includes(event.key)) { event.preventDefault(); state.buttons[selectIndex(current + 1, { aim: true })]?.focus(); }
            else if (['ArrowLeft', 'ArrowUp'].includes(event.key)) { event.preventDefault(); state.buttons[selectIndex(current - 1, { aim: true })]?.focus(); }
            else if (event.key === 'Home') { event.preventDefault(); state.buttons[selectIndex(0, { aim: true })]?.focus(); }
            else if (event.key === 'End') { event.preventDefault(); state.buttons[selectIndex(state.buttons.length - 1, { aim: true })]?.focus(); }
            else if (event.key === 'Tab' || event.key === 'PageDown') { event.preventDefault(); setPage(state.page + (event.shiftKey ? -1 : 1)); }
            else if (event.key === 'PageUp') { event.preventDefault(); setPage(state.page - 1); }
            else if (event.code in DIGIT_SLOT) {
                event.preventDefault();
                if (DIGIT_SLOT[event.code] < state.buttons.length) chooseIndex(DIGIT_SLOT[event.code]);
            }
            else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseIndex(current); }
            else if (event.key === 'Escape') { event.preventDefault(); this.onWheelCancel?.(); }
        });
        document.body.appendChild(wheel);
        render();
        const start = Math.max(0, EMOTE_PAGES[state.page].ids.indexOf(selectedId));
        selectIndex(start);
        state.buttons[start]?.focus({ preventScroll: true });
    }

    // What a released hold would send: the selection, and whether the player
    // actually aimed it (pointer out of the dead zone, keys, a hovered slot).
    wheelSelection() {
        const state = this._wheelState;
        if (!this.wheelOpen || !state) return null;
        const id = EMOTE_PAGES[state.page].ids[state.selected];
        return id ? { id, aimed: state.aimed } : null;
    }

    confirmWheel() {
        const selection = this.wheelSelection();
        if (!selection) return false;
        this.onEmoteSelect?.(selection.id);
        return true;
    }

    hideWheel() {
        this.wheelOpen = false;
        for (const release of this._wheelState?.cleanup || []) release();
        this._wheelState = null;
        const wheel = document.getElementById('emote-wheel');
        if (wheel) wheel.remove();
    }

    reset() {
        this.activeEmotes.forEach((data) => {
            this._disposeSprite(data.sprite);
        });
        this.activeEmotes.clear();
        this.hideWheel();
    }
}
