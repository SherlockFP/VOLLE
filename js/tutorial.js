// tutorial.js — Step-by-step interactive tutorial.
// ponytail: flat steps array with check(ctx) predicates, no state-machine framework.
// ctx is supplied by the game each update(); fields are optional and defensively read.

export const TUTORIAL_STEPS = [
    { id: 'move',    text: 'Move with W A S D',              check: c => ['w','a','s','d'].some(k => c.keys?.has(k)) },
    { id: 'look',    text: 'Look around with the mouse',     check: c => Math.hypot(c.mouseDelta?.x || 0, c.mouseDelta?.y || 0) > 5 },
    { id: 'jump',    text: 'Jump with Space',               check: c => (c.jumps || 0) > 0 },
    // ponytail: ball contact is gated by game logic; tutorial only needs the click intent.
    { id: 'deflect', text: 'Left-click the ball to deflect', check: c => !!c.mouseDown },
    { id: 'spike',   text: 'Flick down for a spike',         check: c => (c.spikes || 0) > 0 },
    { id: 'lob',     text: 'Flick up for a lob',             check: c => (c.lobs || 0) > 0 },
    { id: 'skill',   text: 'Press Q to use your skill',     check: c => (c.skillUses || 0) > 0 },
    { id: 'team',    text: 'Press M to switch teams',       check: c => (c.teamSwitches || 0) > 0 },
    { id: 'chat',    text: 'Press Y to open chat',          check: c => (c.chatOpens || 0) > 0 }
];

class TutorialClass {
    constructor() {
        this.steps = TUTORIAL_STEPS;
        this.index = -1;
        this.active = false;
        this.onStepChange = null;
        this.onComplete = null;
    }

    start(ctx) {
        this.index = 0;
        this.active = true;
        this.onStepChange?.(this.getCurrentStep());
    }

    update(ctx) {
        if (!this.active) return;
        const step = this.steps[this.index];
        if (!step) return;
        // ponytail: try/catch around ctx — a bad field never hardlocks the tutorial.
        let done = false;
        try { done = !!step.check(ctx); } catch { done = false; }
        if (!done) return;
        this.index++;
        if (this.index >= this.steps.length) {
            this.active = false;
            this.onStepChange?.(null);
            this.onComplete?.();
        } else {
            this.onStepChange?.(this.getCurrentStep());
        }
    }

    skip() {
        this.active = false;
        this.index = -1;
        this.onStepChange?.(null);
    }

    getCurrentStep() {
        return (this.active && this.index >= 0 && this.index < this.steps.length)
            ? this.steps[this.index]
            : null;
    }
}

export const Tutorial = new TutorialClass();

// ponytail: self-check under ?debug — synthetic ctx walks every step in order.
if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')) {
    const t = Tutorial;
    let changes = 0, completed = 0;
    t.onStepChange = () => changes++;
    t.onComplete = () => completed++;
    t.start({});
    console.assert(t.getCurrentStep()?.id === 'move', 'starts at move');
    t.update({ keys: new Set(['w']) });
    t.update({ mouseDelta: { x: 10, y: 10 } });
    t.update({ jumps: 1 });
    t.update({ mouseDown: true });
    t.update({ spikes: 1 });
    t.update({ lobs: 1 });
    t.update({ skillUses: 1 });
    t.update({ teamSwitches: 1 });
    t.update({ chatOpens: 1 });
    console.assert(changes === TUTORIAL_STEPS.length + 1, 'step change count');
    console.assert(completed === 1, 'onComplete fired once');
    console.assert(t.getCurrentStep() === null && !t.active, 'tutorial finished');
    console.log('[tutorial] self-check ok', { changes, completed });
}
