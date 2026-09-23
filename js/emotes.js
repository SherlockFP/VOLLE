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
    { id: 'skull', emoji: '💀', icon: 'i-skull', text: 'Dead' }
];

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
const WHEEL_KEYS = new Set(['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape']);
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
    }

    // Emote göster — entity'nin üstünde sprite belirir.
    show(entity, emoteId, { offsetY = EMOTE_OFFSET_Y } = {}) {
        const emote = getEmote(emoteId);
        if (!emote || !entity) return false;

        // Keyed by the entity object: two players may share a display name.
        const key = entity;
        const old = this.activeEmotes.get(key);
        if (old) this._disposeSprite(old.sprite);

        const canvas = document.createElement('canvas');
        canvas.width = 128; canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.font = '80px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(emote.emoji, 64, 64);

        const tex = new THREE.CanvasTexture(canvas);
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(1.5, 1.5, 1);

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
        data.sprite.scale.setScalar(1.5 * Math.min(1, Math.max(0.05, age * 4)));
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

    // Wheel UI — DOM'da göster. center: {x, y} ekran koordinatı.
    showWheel(center) {
        this.hideWheel();
        this.wheelOpen = true;
        const wheel = document.createElement('div');
        wheel.id = 'emote-wheel';
        wheel.className = 'emote-wheel';
        wheel.setAttribute('role', 'menu');
        wheel.setAttribute('aria-label', 'Quick chat emotes');
        wheel.style.left = `${center.x}px`;
        wheel.style.top = `${center.y}px`;
        const radius = Math.min(132, Math.max(112, Math.min(window.innerWidth, window.innerHeight) * 0.29));
        const centerCopy = document.createElement('div');
        centerCopy.className = 'emote-wheel-center';
        centerCopy.innerHTML = '<span>QUICK CHAT</span><strong id="emote-wheel-selection">Nice!</strong><small>ARROWS SELECT · ENTER SENDS · G CLOSES</small>';
        wheel.appendChild(centerCopy);
        const buttons = [];
        const selectIndex = index => {
            const selected = (index + buttons.length) % buttons.length;
            buttons.forEach((button, buttonIndex) => {
                const active = buttonIndex === selected;
                button.classList.toggle('is-selected', active);
                button.setAttribute('aria-checked', String(active));
                button.tabIndex = active ? 0 : -1;
            });
            wheel.dataset.selectedIndex = String(selected);
            const label = centerCopy.querySelector('strong');
            if (label) label.textContent = EMOTES[selected].text;
            return selected;
        };
        const chooseIndex = index => {
            const selected = selectIndex(index);
            this.onEmoteSelect?.(EMOTES[selected].id);
        };
        EMOTES.forEach((e, i) => {
            const angle = (i / EMOTES.length) * Math.PI * 2 - Math.PI / 2;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'emote-wheel-item';
            btn.setAttribute('role', 'menuitemradio');
            btn.setAttribute('aria-checked', 'false');
            btn.style.setProperty('--emote-x', `${Math.cos(angle) * radius}px`);
            btn.style.setProperty('--emote-y', `${Math.sin(angle) * radius}px`);
            btn.innerHTML = `<svg class="ui-icon" aria-hidden="true"><use href="#${e.icon}"></use></svg><small>${e.text}</small>`;
            btn.title = e.text;
            btn.setAttribute('aria-label', e.text);
            btn.dataset.emote = e.id;
            btn.addEventListener('pointerenter', () => selectIndex(i));
            btn.addEventListener('focus', () => selectIndex(i));
            btn.addEventListener('click', () => chooseIndex(i));
            buttons.push(btn);
            wheel.appendChild(btn);
        });
        // The wheel's ::before dim layer makes the whole screen its hit area; keep those
        // pointer events away from the game (camera look, knife swing on click).
        for (const type of WHEEL_SWALLOWED_EVENTS) {
            wheel.addEventListener(type, event => {
                event.stopPropagation();
                // Keep keyboard focus on the wheel buttons (a blur let Enter open chat).
                if (type === 'mousedown') event.preventDefault();
            });
        }
        let aimed = false;
        wheel.addEventListener('pointermove', event => {
            const bounds = wheel.getBoundingClientRect();
            const dx = event.clientX - (bounds.left + bounds.width / 2);
            const dy = event.clientY - (bounds.top + bounds.height / 2);
            aimed = Math.hypot(dx, dy) >= 58;
            if (!aimed) return;
            const normalized = (Math.atan2(dy, dx) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
            selectIndex(Math.round((normalized / (Math.PI * 2)) * buttons.length) % buttons.length);
        });
        // Radial behaviour: a click anywhere confirms the aimed slice; a click in the
        // dead centre (nothing aimed) cancels.
        wheel.addEventListener('click', event => {
            if (event.target?.closest?.('.emote-wheel-item')) return;
            if (aimed) chooseIndex(Number(wheel.dataset.selectedIndex) || 0);
            else this.onWheelCancel?.();
        });
        wheel.addEventListener('keydown', event => {
            const current = Number(wheel.dataset.selectedIndex) || 0;
            if (WHEEL_KEYS.has(event.key)) event.stopPropagation();
            if (['ArrowRight', 'ArrowDown'].includes(event.key)) { event.preventDefault(); buttons[selectIndex(current + 1)]?.focus(); }
            else if (['ArrowLeft', 'ArrowUp'].includes(event.key)) { event.preventDefault(); buttons[selectIndex(current - 1)]?.focus(); }
            else if (event.key === 'Home') { event.preventDefault(); buttons[selectIndex(0)]?.focus(); }
            else if (event.key === 'End') { event.preventDefault(); buttons[selectIndex(buttons.length - 1)]?.focus(); }
            else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseIndex(current); }
            else if (event.key === 'Escape') { event.preventDefault(); this.onWheelCancel?.(); }
        });
        document.body.appendChild(wheel);
        selectIndex(0);
        buttons[0]?.focus({ preventScroll: true });
    }

    hideWheel() {
        this.wheelOpen = false;
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
