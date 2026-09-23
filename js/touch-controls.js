// js/touch-controls.js — mobile touch controls for matches (phones/tablets).
//
// Left 40% of the screen: dynamic virtual joystick (appears where the thumb lands).
// Right side: drag anywhere to look, plus action buttons.
//
// Nothing here re-implements gameplay. Every control writes the SAME input state the
// keyboard/mouse path in js/player.js uses:
//   joystick      -> player.touchMove {x, y} (analog, y = forward) + player.keys.ShiftLeft (sprint at the edge)
//   look drag     -> player.applyLookDelta(dx, dy, sensitivity)  (same gates/flick/sway as mousemove)
//   Deflect       -> player.pressPrimary() / player.releasePrimary()  (== left mouse down/up, incl. charge)
//   Stab          -> player.pressSecondary()                    (== right mouse down)
//   Jump / Dash   -> player.keys.Space / player.keys.ControlLeft (held while the finger is down)
//   Skill/Inspect/Twirl -> player.handleActionKey({ code: 'KeyQ' | 'KeyF' | 'KeyR' })
//   Pause / Scoreboard / Emote -> synthetic Escape / Tab / KeyG key events, so main.js's
//                                 existing key handlers keep owning those rules.
//
// Hot path (touchmove) allocates nothing: touches live in preallocated slots, the stick
// vector is written into a reused object, and DOM transforms are flushed at most once
// per frame from update().

// One config object for every on-screen position (a layout editor can later rewrite it).
// Button x/y = distance in CSS px from the anchor corner to the button's near edges
// (anchor 'br' | 'bl' | 'tr' | 'tl'; b/t = bottom/top, r/l = right/left). Sizes are for a 375px-tall
// phone; update() scales everything up on larger screens (tablets).
export const TOUCH_LAYOUT = {
    stick: {
        zoneWidth: 0.4,     // left fraction of the screen that spawns the joystick
        radius: 56,         // knob travel in px
        deadzone: 0.12,     // fraction of radius ignored (thumb jitter)
        sprintAt: 0.92,     // raw push >= this fraction of radius -> sprint (Shift)
        minWalk: 0.28,      // output magnitude right past the deadzone (slow walk, not a crawl)
        edgeMargin: 12      // keep the whole base on-screen
    },
    look: {
        defaultSensitivity: 5,       // settings slider value (1..10)
        radiansPerPixelPerUnit: 0.0008 // 5 -> 0.004 rad/px (~ half-turn per full-width swipe on a phone)
    },
    minHoldFrames: 1,       // Jump/Dash stay down for >= 1 game frame even on a very quick tap
    haptics: { press: 12, primary: 18 },
    buttons: {
        deflect:    { anchor: 'br', x: 92,  y: 62,  size: 88, look: true },
        jump:       { anchor: 'br', x: 18,  y: 18,  size: 64 },
        stab:       { anchor: 'br', x: 18,  y: 96,  size: 58 },
        dash:       { anchor: 'br', x: 196, y: 18,  size: 58 },
        skill:      { anchor: 'br', x: 196, y: 92,  size: 58 },
        inspect:    { anchor: 'br', x: 104, y: 164, size: 44 },
        twirl:      { anchor: 'br', x: 156, y: 164, size: 44 },
        pause:      { anchor: 'tl', x: 10,  y: 10,  size: 44 },
        scoreboard: { anchor: 'tl', x: 62,  y: 10,  size: 44 },
        emote:      { anchor: 'tl', x: 114, y: 10,  size: 44 }
    }
};

const ROLE_NONE = 0;
const ROLE_STICK = 1;
const ROLE_LOOK = 2;
const ROLE_BUTTON = 3;
const MAX_TOUCHES = 10;
// Constant key-like events for Player.handleActionKey (same gate as the keyboard).
const ACTION_SKILL = Object.freeze({ code: 'KeyQ', repeat: false });
const ACTION_INSPECT = Object.freeze({ code: 'KeyF', repeat: false });
const ACTION_TWIRL = Object.freeze({ code: 'KeyR', repeat: false });

export const TOUCH_MODES = ['auto', 'on', 'off'];

export function normalizeTouchMode(mode) {
    return TOUCH_MODES.includes(mode) ? mode : 'auto';
}

// auto: on when the primary pointer is coarse (phones/tablets), or when the screen
// is touched on a device with no fine pointer at all. A touchscreen laptop that also
// has a mouse/trackpad stays on mouse + pointer lock unless the player picks "On".
export function shouldEnableTouch(mode, coarsePointer, touchSeen, hasFinePointer = false) {
    const normalized = normalizeTouchMode(mode);
    if (normalized === 'on') return true;
    if (normalized === 'off') return false;
    return !!(coarsePointer || (touchSeen && !hasFinePointer));
}

export function isPortrait(width, height) {
    return Number(height) > Number(width);
}

export function touchLookRadiansPerPixel(value, layout = TOUCH_LAYOUT) {
    const v = Number(value);
    const clamped = Number.isFinite(v) ? Math.min(10, Math.max(1, v)) : layout.look.defaultSensitivity;
    return clamped * layout.look.radiansPerPixelPerUnit;
}

export function createStickVector() {
    return { x: 0, y: 0, magnitude: 0, sprint: false, knobX: 0, knobY: 0 };
}

// Pure joystick math. dx/dy = finger offset from the stick base in screen px (dy +down).
// Writes into `out` (no allocation). out.x = strafe (+right), out.y = forward (+up),
// |(x,y)| = out.magnitude in [minWalk, 1] outside the radial deadzone, 0 inside it.
export function joystickVector(dx, dy, stick = TOUCH_LAYOUT.stick, out = createStickVector()) {
    const radius = stick.radius > 0 ? stick.radius : 1;
    const dist = Math.hypot(dx, dy);
    const raw = dist / radius;
    const clamped = raw > 1 ? 1 : raw;
    if (dist > 0) {
        out.knobX = (dx / dist) * clamped * radius;
        out.knobY = (dy / dist) * clamped * radius;
    } else {
        out.knobX = 0;
        out.knobY = 0;
    }
    if (dist === 0 || raw <= stick.deadzone) {
        out.x = 0;
        out.y = 0;
        out.magnitude = 0;
        out.sprint = false;
        return out;
    }
    const t = (clamped - stick.deadzone) / (1 - stick.deadzone);
    const magnitude = stick.minWalk + (1 - stick.minWalk) * t;
    out.x = (dx / dist) * magnitude;
    out.y = (-dy / dist) * magnitude;
    out.magnitude = magnitude;
    out.sprint = raw >= stick.sprintAt;
    return out;
}

// Stick base follows the thumb but is clamped so the whole ring stays on-screen.
export function clampStickBase(x, y, width, height, stick = TOUCH_LAYOUT.stick) {
    const r = stick.radius + stick.edgeMargin;
    return {
        x: Math.min(Math.max(x, r), Math.max(r, width - r)),
        y: Math.min(Math.max(y, r), Math.max(r, height - r))
    };
}

// DOM-free input model: touch ids in, player input state out. Unit-tested directly.
export class TouchInputModel {
    constructor(player, {
        layout = TOUCH_LAYOUT,
        emitKey = () => {},
        haptic = () => {},
        onButtonVisual = () => {}
    } = {}) {
        this.player = player;
        this.layout = layout;
        this.emitKey = emitKey;
        this.haptic = haptic;
        this.onButtonVisual = onButtonVisual;
        this.scale = 1;
        this.lookRadPerPx = touchLookRadiansPerPixel(layout.look.defaultSensitivity, layout);
        this.frame = 0;
        this.slots = [];
        for (let i = 0; i < MAX_TOUCHES; i++) {
            this.slots.push({ id: -1, role: ROLE_NONE, button: null, x: 0, y: 0 });
        }
        this.stickId = -1;
        this.lookId = -1;
        this.stickBaseX = 0;
        this.stickBaseY = 0;
        this.stick = createStickVector();
        this.stickDirty = false;
        this._scaledStick = { ...layout.stick };
        this._sprinting = false;
        this.buttons = {};
        for (const name of Object.keys(layout.buttons)) {
            this.buttons[name] = { down: false, pressFrame: 0, pendingRelease: false, touchId: -1 };
        }
        if (player && !player.touchMove) player.touchMove = { x: 0, y: 0 };
    }

    setScale(scale) {
        this.scale = scale > 0 ? scale : 1;
        this._scaledStick.radius = this.layout.stick.radius * this.scale;
        this._scaledStick.edgeMargin = this.layout.stick.edgeMargin * this.scale;
    }

    setSensitivity(value) {
        this.lookRadPerPx = touchLookRadiansPerPixel(value, this.layout);
    }

    get activeTouches() {
        let n = 0;
        for (let i = 0; i < MAX_TOUCHES; i++) if (this.slots[i].id !== -1) n++;
        return n;
    }

    _slotFor(id) {
        for (let i = 0; i < MAX_TOUCHES; i++) if (this.slots[i].id === id) return this.slots[i];
        return null;
    }

    // Returns the role that claimed the touch ('stick' | 'look' | 'button' | null).
    touchStart(id, x, y, buttonName, viewportWidth, viewportHeight) {
        if (this._slotFor(id)) return null;
        const slot = this._slotFor(-1);
        if (!slot) return null;
        if (buttonName && this.buttons[buttonName]) {
            slot.id = id;
            slot.role = ROLE_BUTTON;
            slot.button = buttonName;
            slot.x = x;
            slot.y = y;
            this.pressButton(buttonName, id);
            return 'button';
        }
        if (x < viewportWidth * this.layout.stick.zoneWidth && this.stickId === -1) {
            slot.id = id;
            slot.role = ROLE_STICK;
            slot.button = null;
            const base = clampStickBase(x, y, viewportWidth, viewportHeight, this._scaledStick);
            this.stickBaseX = base.x;
            this.stickBaseY = base.y;
            this.stickId = id;
            this._applyStick(x, y);
            return 'stick';
        }
        if (this.lookId === -1) {
            slot.id = id;
            slot.role = ROLE_LOOK;
            slot.button = null;
            slot.x = x;
            slot.y = y;
            this.lookId = id;
            return 'look';
        }
        return null;
    }

    touchMove(id, x, y) {
        const slot = this._slotFor(id);
        if (!slot) return;
        if (slot.role === ROLE_STICK) {
            this._applyStick(x, y);
            return;
        }
        const looks = slot.role === ROLE_LOOK
            || (slot.role === ROLE_BUTTON && this.lookId === -1 && this.layout.buttons[slot.button]?.look);
        const dx = x - slot.x;
        const dy = y - slot.y;
        slot.x = x;
        slot.y = y;
        if (looks && (dx !== 0 || dy !== 0)) this.player.applyLookDelta?.(dx, dy, this.lookRadPerPx);
    }

    touchEnd(id) {
        const slot = this._slotFor(id);
        if (!slot) return;
        if (slot.role === ROLE_STICK) this._releaseStick();
        else if (slot.role === ROLE_LOOK) this.lookId = -1;
        else if (slot.role === ROLE_BUTTON) this.releaseButton(slot.button);
        slot.id = -1;
        slot.role = ROLE_NONE;
        slot.button = null;
    }

    _applyStick(x, y) {
        joystickVector(x - this.stickBaseX, y - this.stickBaseY, this._scaledStick, this.stick);
        const move = this.player.touchMove;
        move.x = this.stick.x;
        move.y = this.stick.y;
        if (this.stick.sprint !== this._sprinting) {
            this._sprinting = this.stick.sprint;
            this.player.keys.ShiftLeft = this._sprinting;
        }
        this.stickDirty = true;
    }

    _releaseStick() {
        this.stickId = -1;
        const move = this.player.touchMove;
        move.x = 0;
        move.y = 0;
        this.stick.x = 0;
        this.stick.y = 0;
        this.stick.magnitude = 0;
        this.stick.sprint = false;
        this.stick.knobX = 0;
        this.stick.knobY = 0;
        if (this._sprinting) {
            this._sprinting = false;
            this.player.keys.ShiftLeft = false;
        }
        this.stickDirty = true;
    }

    pressButton(name, touchId = -1) {
        const state = this.buttons[name];
        if (!state || state.down) return false;
        state.down = true;
        state.pendingRelease = false;
        state.pressFrame = this.frame;
        state.touchId = touchId;
        const player = this.player;
        switch (name) {
            case 'deflect': player.pressPrimary?.(); break;
            case 'stab': player.pressSecondary?.(); break;
            case 'jump': player.keys.Space = true; break;
            case 'dash': player.keys.ControlLeft = true; break;
            case 'skill': player.handleActionKey?.(ACTION_SKILL); break;
            case 'inspect': player.handleActionKey?.(ACTION_INSPECT); break;
            case 'twirl': player.handleActionKey?.(ACTION_TWIRL); break;
            case 'scoreboard': this.emitKey('Tab', 'keydown'); break;
            case 'emote': this.emitKey('KeyG', 'keydown'); break;
            case 'pause':
                this.emitKey('Escape', 'keydown');
                this.emitKey('Escape', 'keyup');
                break;
            default: break;
        }
        this.haptic(name === 'deflect' ? this.layout.haptics.primary : this.layout.haptics.press);
        this.onButtonVisual(name, true);
        return true;
    }

    releaseButton(name) {
        const state = this.buttons[name];
        if (!state || !state.down) return false;
        // Held keys must be seen by at least one game frame, or a quick tap is lost.
        if ((name === 'jump' || name === 'dash') && this.frame - state.pressFrame < this.layout.minHoldFrames) {
            state.pendingRelease = true;
            state.touchId = -1;
            this.onButtonVisual(name, false);
            return true;
        }
        this._finishRelease(name, state);
        return true;
    }

    _finishRelease(name, state) {
        state.down = false;
        state.pendingRelease = false;
        state.touchId = -1;
        const player = this.player;
        switch (name) {
            case 'deflect': player.releasePrimary?.(); break;
            case 'jump': player.keys.Space = false; break;
            case 'dash': player.keys.ControlLeft = false; break;
            case 'scoreboard': this.emitKey('Tab', 'keyup'); break;
            default: break;
        }
        this.onButtonVisual(name, false);
    }

    // Once per rendered frame (main loop). Flushes deferred quick-tap releases.
    tick() {
        this.frame++;
        for (const name in this.buttons) {
            const state = this.buttons[name];
            if (state.pendingRelease && this.frame - state.pressFrame >= this.layout.minHoldFrames) {
                this._finishRelease(name, state);
            }
        }
    }

    // Overlay hidden / page blurred: drop every hold so nothing sticks.
    releaseAll() {
        for (let i = 0; i < MAX_TOUCHES; i++) {
            const slot = this.slots[i];
            if (slot.id !== -1) this.touchEnd(slot.id);
        }
        for (const name in this.buttons) {
            const state = this.buttons[name];
            if (state.down) this._finishRelease(name, state);
        }
        this.lookId = -1;
        if (this.stickId !== -1 || this.player.touchMove.x !== 0 || this.player.touchMove.y !== 0) this._releaseStick();
    }
}

function defaultEmitKey(code, type) {
    const key = code === 'KeyG' ? 'g' : code;
    document.dispatchEvent(new KeyboardEvent(type, { code, key, bubbles: true, cancelable: true }));
}

// DOM layer: owns the overlay markup in index.html (#touch-controls, #touch-rotate).
export class TouchControls {
    constructor(player, { store = null, doc = document, win = window, layout = TOUCH_LAYOUT } = {}) {
        this.player = player;
        this.doc = doc;
        this.win = win;
        this.layout = layout;
        this.root = doc.getElementById('touch-controls');
        this.rotateEl = doc.getElementById('touch-rotate');
        this.stickBase = doc.getElementById('touch-stick');
        this.stickKnob = doc.getElementById('touch-stick-knob');
        this.buttonEls = {};
        this.root?.querySelectorAll('[data-touch-btn]').forEach(el => {
            this.buttonEls[el.dataset.touchBtn] = el;
        });
        this.mode = normalizeTouchMode(store?.get?.('touchControls'));
        this.haptics = store?.get?.('touchHaptics') !== false;
        this.enabled = false;
        this.active = false;
        this._inMatch = false;
        this.portrait = false;
        this._touchSeen = false;
        this._coarseMedia = win.matchMedia?.('(pointer: coarse)') || null;
        this._fineMedia = win.matchMedia?.('(any-pointer: fine)') || null;
        this.model = new TouchInputModel(player, {
            layout,
            emitKey: defaultEmitKey,
            haptic: ms => {
                if (!this.haptics) return;
                try { win.navigator?.vibrate?.(ms); } catch (_) {}
            },
            onButtonVisual: (name, down) => this.buttonEls[name]?.classList.toggle('is-pressed', down)
        });
        this.setSensitivity(store?.get?.('touchSensitivity') ?? layout.look.defaultSensitivity);
        this._bind();
        this._layout();
        this._refreshEnabled();
    }

    _bind() {
        const root = this.root;
        if (root) {
            // Non-passive start: preventDefault stops compat mouse events, long-press
            // menus, text selection and double-tap zoom. Only on the overlay.
            root.addEventListener('touchstart', e => this._onTouchStart(e), { passive: false });
            // touch-action:none (css/touch.css) already blocks scroll/zoom -> passive.
            root.addEventListener('touchmove', e => this._onTouchMove(e), { passive: true });
            root.addEventListener('touchend', e => this._onTouchEnd(e), { passive: true });
            root.addEventListener('touchcancel', e => this._onTouchEnd(e), { passive: true });
            root.addEventListener('contextmenu', e => e.preventDefault());
        }
        // auto mode: the first real touch anywhere flips controls on.
        this.doc.addEventListener('touchstart', () => {
            if (this._touchSeen) return;
            this._touchSeen = true;
            this._refreshEnabled();
        }, { passive: true, capture: true });
        this._coarseMedia?.addEventListener?.('change', () => this._refreshEnabled());
        const onResize = () => this._layout();
        this.win.addEventListener('resize', onResize, { passive: true });
        this.win.addEventListener('orientationchange', onResize, { passive: true });
        this.win.addEventListener('blur', () => this.model.releaseAll());
    }

    _onTouchStart(e) {
        e.preventDefault();
        if (!this.active) return;
        const touches = e.changedTouches;
        const w = this.win.innerWidth;
        const h = this.win.innerHeight;
        for (let i = 0; i < touches.length; i++) {
            const t = touches[i];
            const btn = t.target?.closest?.('[data-touch-btn]');
            const role = this.model.touchStart(t.identifier, t.clientX, t.clientY, btn ? btn.dataset.touchBtn : null, w, h);
            if (role === 'stick') this._placeStickBase();
        }
    }

    _onTouchMove(e) {
        if (!this.active) return;
        const touches = e.changedTouches;
        for (let i = 0; i < touches.length; i++) {
            const t = touches[i];
            this.model.touchMove(t.identifier, t.clientX, t.clientY);
        }
    }

    _onTouchEnd(e) {
        const touches = e.changedTouches;
        for (let i = 0; i < touches.length; i++) this.model.touchEnd(touches[i].identifier);
    }

    _placeStickBase() {
        if (!this.stickBase) return;
        this.stickBase.style.left = `${this.model.stickBaseX}px`;
        this.stickBase.style.top = `${this.model.stickBaseY}px`;
        this.stickBase.classList.add('is-visible');
    }

    _flushStick() {
        const model = this.model;
        if (!model.stickDirty) return;
        model.stickDirty = false;
        if (model.stickId === -1) {
            this.stickBase?.classList.remove('is-visible', 'is-sprint');
            if (this.stickKnob) this.stickKnob.style.transform = '';
            return;
        }
        if (this.stickKnob) this.stickKnob.style.transform = `translate(${model.stick.knobX.toFixed(1)}px, ${model.stick.knobY.toFixed(1)}px)`;
        this.stickBase?.classList.toggle('is-sprint', model.stick.sprint);
    }

    // Positions come only from TOUCH_LAYOUT; sizes scale with the short screen edge.
    _layout() {
        const w = this.win.innerWidth || 0;
        const h = this.win.innerHeight || 0;
        const scale = Math.min(1.35, Math.max(1, Math.min(w, h) / 375));
        this.model.setScale(scale);
        const buttons = this.layout.buttons;
        for (const name in buttons) {
            const el = this.buttonEls[name];
            if (!el) continue;
            const cfg = buttons[name];
            const size = Math.round(cfg.size * scale);
            const x = Math.round(cfg.x * scale);
            const y = Math.round(cfg.y * scale);
            const horizontal = cfg.anchor[1] === 'l' ? 'left' : 'right';
            const vertical = cfg.anchor[0] === 'b' ? 'bottom' : 'top';
            el.style.width = `${size}px`;
            el.style.height = `${size}px`;
            el.style.left = el.style.right = el.style.top = el.style.bottom = '';
            el.style[horizontal] = `calc(${x}px + env(safe-area-inset-${horizontal}, 0px))`;
            el.style[vertical] = `calc(${y}px + env(safe-area-inset-${vertical}, 0px))`;
        }
        const stickSize = Math.round(this.layout.stick.radius * 2 * scale);
        this.root?.style.setProperty('--touch-stick-size', `${stickSize}px`);
        this.doc.body?.style.setProperty('--touch-scale', String(scale)); // css/touch.css HUD lanes
        const portrait = isPortrait(w, h);
        if (portrait !== this.portrait) {
            this.portrait = portrait;
            this._syncVisibility();
        }
    }

    _refreshEnabled() {
        const enabled = shouldEnableTouch(this.mode, this._coarseMedia?.matches === true, this._touchSeen, this._fineMedia?.matches === true);
        if (enabled === this.enabled) return;
        this.enabled = enabled;
        this.player.touchInput = enabled;
        this.doc.body?.classList.toggle('touch-controls-on', enabled);
        if (enabled && this.doc.pointerLockElement) {
            try { this.doc.exitPointerLock?.(); } catch (_) {}
        }
        this._syncVisibility();
    }

    setMode(mode) {
        this.mode = normalizeTouchMode(mode);
        this._refreshEnabled();
    }

    setSensitivity(value) {
        this.model.setSensitivity(value);
    }

    setHaptics(on) {
        this.haptics = !!on;
    }

    // Called once per frame from the main loop. `inMatch` = live match input allowed
    // (main.js canLock minus emote wheel / spectator). DOM writes only on change.
    update(inMatch) {
        this.model.tick();
        const matchActive = !!inMatch && this.enabled;
        if (matchActive !== this._inMatch) {
            this._inMatch = matchActive;
            this._syncVisibility();
        }
        if (this.active) this._flushStick();
    }

    _syncVisibility() {
        const inMatch = !!this._inMatch && this.enabled;
        const showRotate = inMatch && this.portrait;
        const active = inMatch && !this.portrait;
        this.rotateEl?.classList.toggle('hidden', !showRotate);
        if (active === this.active) return;
        this.active = active;
        this.root?.classList.toggle('hidden', !active);
        if (!active) {
            this.model.releaseAll();
            this._flushStick();
        }
    }
}

// Settings > Controls rows (index.html): mode select, look sensitivity, haptics.
// Reset-to-defaults replays input/change events, so these listeners also persist resets.
export function bindTouchSettings(doc, store, controls) {
    const mode = doc.getElementById('setting-touch-controls');
    const sens = doc.getElementById('setting-touch-sensitivity');
    const sensOut = doc.getElementById('setting-touch-sensitivity-value');
    const haptics = doc.getElementById('setting-touch-haptics');
    if (mode) {
        mode.value = normalizeTouchMode(store.get('touchControls'));
        mode.addEventListener('change', () => {
            const value = normalizeTouchMode(mode.value);
            store.set('touchControls', value);
            controls?.setMode(value);
        });
    }
    if (sens) {
        const saved = Number(store.get('touchSensitivity'));
        sens.value = String(Number.isFinite(saved) && saved > 0 ? saved : TOUCH_LAYOUT.look.defaultSensitivity);
        if (sensOut) sensOut.textContent = sens.value;
        sens.addEventListener('input', () => {
            const value = Number(sens.value);
            store.set('touchSensitivity', value);
            controls?.setSensitivity(value);
            if (sensOut) sensOut.textContent = sens.value;
        });
    }
    if (haptics) {
        haptics.checked = store.get('touchHaptics') !== false;
        haptics.addEventListener('change', () => {
            store.set('touchHaptics', haptics.checked);
            controls?.setHaptics(haptics.checked);
        });
    }
}
