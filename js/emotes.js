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

export class EmoteSystem {
    constructor(scene) {
        this.scene = scene;
        this.activeEmotes = new Map(); // entity → { sprite, timer }
        this.wheelOpen = false;
        this.onEmote = null; // callback(emote, entity)
    }

    // Emote göster — entity'nin üstünde sprite belirir.
    show(entity, emoteId) {
        const emote = EMOTES.find(e => e.id === emoteId);
        if (!emote || !entity) return;

        const key = entity.name || '__player__';
        const old = this.activeEmotes.get(key);
        if (old) { this.scene.remove(old.sprite); }

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

        this.scene.add(sprite);
        this.activeEmotes.set(key, { sprite, timer: 3, entity, emote });
        this.onEmote?.(emote, entity);
    }

    update(dt) {
        this.activeEmotes.forEach((data, key) => {
            data.timer -= dt;
            const pos = data.entity.getPosition ? data.entity.getPosition() : data.entity.position;
            // Yükselip kaybolan animasyon
            const floatY = (3 - data.timer) * 0.5;
            data.sprite.position.set(pos.x, pos.y + 2.8 + floatY, pos.z);
            data.sprite.material.opacity = Math.min(1, data.timer * 1.5);
            // Pop-in scale
            const popIn = Math.min(1, (3 - data.timer) * 4);
            data.sprite.scale.setScalar(1.5 * popIn);
            if (data.timer <= 0) {
                this.scene.remove(data.sprite);
                this.activeEmotes.delete(key);
            }
        });
    }

    // Wheel UI — DOM'da göster. center: {x, y} ekran koordinatı.
    showWheel(center) {
        this.wheelOpen = true;
        let wheel = document.getElementById('emote-wheel');
        if (wheel) wheel.remove();
        wheel = document.createElement('div');
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
        wheel.addEventListener('pointermove', event => {
            const bounds = wheel.getBoundingClientRect();
            const dx = event.clientX - (bounds.left + bounds.width / 2);
            const dy = event.clientY - (bounds.top + bounds.height / 2);
            if (Math.hypot(dx, dy) < 58) return;
            const normalized = (Math.atan2(dy, dx) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
            selectIndex(Math.round((normalized / (Math.PI * 2)) * buttons.length) % buttons.length);
        });
        wheel.addEventListener('keydown', event => {
            const current = Number(wheel.dataset.selectedIndex) || 0;
            if (['ArrowRight', 'ArrowDown'].includes(event.key)) { event.preventDefault(); buttons[selectIndex(current + 1)]?.focus(); }
            else if (['ArrowLeft', 'ArrowUp'].includes(event.key)) { event.preventDefault(); buttons[selectIndex(current - 1)]?.focus(); }
            else if (event.key === 'Home') { event.preventDefault(); buttons[selectIndex(0)]?.focus(); }
            else if (event.key === 'End') { event.preventDefault(); buttons[selectIndex(buttons.length - 1)]?.focus(); }
            else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseIndex(current); }
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
            this.scene.remove(data.sprite);
        });
        this.activeEmotes.clear();
        this.hideWheel();
    }
}
