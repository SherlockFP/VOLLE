// emotes.js — Quick chat wheel + emote system. Sosyal bağımlılık.
// ponytail: tek dosya, canvas sprite emote'lar, wheel UI DOM'da.
import * as THREE from 'three';

export const EMOTES = [
    { id: 'nice',       emoji: '👍', text: 'Nice!' },
    { id: 'gg',         emoji: '🤝', text: 'GG' },
    { id: 'oops',       emoji: '😅', text: 'Oops' },
    { id: 'wow',        emoji: '😮', text: 'Wow!' },
    { id: 'fire',       emoji: '🔥', text: 'On fire!' },
    { id: 'cry',        emoji: '😭', text: 'No!' },
    { id: 'laugh',      emoji: '😂', text: 'Haha' },
    { id: 'angry',      emoji: '😡', text: 'Rage' },
    { id: 'clap',       emoji: '👏', text: 'Clap' },
    { id: 'flex',       emoji: '💪', text: 'Flex' },
    { id: 'heart',      emoji: '❤️', text: 'Love' },
    { id: 'skull',      emoji: '💀', text: 'Dead' }
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
        wheel.style.left = `${center.x}px`;
        wheel.style.top = `${center.y}px`;
        EMOTES.forEach((e, i) => {
            const angle = (i / EMOTES.length) * Math.PI * 2 - Math.PI / 2;
            const r = 80;
            const btn = document.createElement('div');
            btn.className = 'emote-wheel-item';
            btn.style.left = `${Math.cos(angle) * r}px`;
            btn.style.top = `${Math.sin(angle) * r}px`;
            btn.textContent = e.emoji;
            btn.title = e.text;
            btn.dataset.emote = e.id;
            btn.addEventListener('click', () => {
                this.hideWheel();
                this.onEmoteSelect?.(e.id);
            });
            wheel.appendChild(btn);
        });
        document.body.appendChild(wheel);
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
