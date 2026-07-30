// skills.js — Active skills (Q) + passive runes (LoL-style 4 slot).
// ponytail: tek dosya, basit tanım objeleri, cooldown uygulama logic'i.

export const SKILLS = {
    // Cooldowns are tuned so every skill lands in a ~0.32-0.42 "impact per cooldown second"
    // band; the old spread (35s slow .. 90s blackhole) made teleport/blackhole unpayable and
    // shield strictly better than heal. Single source of truth — do not re-assign below.
    slow: {
        id: 'slow', name: 'Slow Ball', emoji: '🐌', cooldown: 35,
        desc: 'Top hızını anlık %50 azaltır.'
    },
    freeze: {
        id: 'freeze', name: 'Freeze', emoji: '🧊', cooldown: 52,
        desc: 'Topu 1.5sn tam dondurur.'
    },
    burn: {
        id: 'burn', name: 'Burn', emoji: '🔥', cooldown: 44,
        desc: 'Hedefe 3sn boyunca 5 dmg/s (toplam 15) hasar.'
    },
    shield: {
        id: 'shield', name: 'Shield', emoji: '🛡️', cooldown: 60,
        desc: '25 kalkan kazan.'
    },
    smash: {
        id: 'smash', name: 'Smash', emoji: '💥', cooldown: 34,
        desc: 'Topa +30% hız vur.'
    },
    heal: {
        id: 'heal', name: 'Heal', emoji: '💚', cooldown: 52,
        desc: '+25 HP yenile.'
    },
    teleport: {
        id: 'teleport', name: 'Teleport', emoji: '🌀', cooldown: 44,
        desc: 'Topu hedefin önüne ışınla.'
    },
    blackhole: {
        id: 'blackhole', name: 'Black Hole', emoji: '🕳️', cooldown: 62,
        desc: 'Rastgele konumda kara delik açar, topu 4sn çeker.'
    }
};

export const ULTIMATES = {
    rally:   { name: 'BLITZ BALL',   duration: 5, desc: 'Ball targets all enemies at 2x speed' },
    tank:    { name: 'FORTRESS',     duration: 5, desc: '+100 shield, 50% damage reduction' },
    scout:   { name: 'PHANTOM RUSH', duration: 5, desc: '+50% speed, semi-transparent' },
    sniper:  { name: 'PENETRATOR',   duration: 1, desc: 'Next throw pierces walls, 3x damage' },
    guardian:{ name: 'AEGIS',        duration: 0, desc: 'Heal all allies 30% HP' },
    blazer:  { name: 'INFERNO',      duration: 5, desc: 'Fire trail burns enemies on contact' },
    frost:   { name: 'FLASH FREEZE', duration: 3, desc: 'Freeze all balls on map' },
    // New character ults: volt, nova, ripple, soldier, anchor, phantom, hardy, swift
    // Designed to maintain power balance with existing 7 and reuse established mechanics
    volt:    { name: 'VELOCITY SURGE', duration: 5, desc: '+70% speed for 5s, agile offense' },
    nova:    { name: 'STELLAR SHIELD', duration: 5, desc: '+100 shield, 25% damage reduction' },
    ripple:  { name: 'TIDAL SURGE', duration: 4, desc: 'Freeze all balls on map' },
    soldier: { name: 'BOMBARDMENT', duration: 2, desc: 'Ball 2x speed, pierces walls for 2s' },
    anchor:  { name: 'UNBREAKABLE', duration: 5, desc: '+130 shield, 35% damage reduction' },
    phantom: { name: 'DEATHBLOW', duration: 1, desc: 'Ball 4x speed, pierces walls (1 throw)' },
    hardy:   { name: 'FORTIFIED', duration: 5, desc: '+100 shield, 20% damage reduction' },
    swift:   { name: 'MOMENTUM', duration: 5, desc: 'All allies +30% speed for 5s' }
};

export const RUNES = {
    hp_bonus:      { id:'hp_bonus',      name:'HP Bonus',         emoji:'❤️', desc:'+25 max HP' },
    dmg_resist:    { id:'dmg_resist',    name:'Damage Resist',    emoji:'🛡️', desc:'-15% alınan hasar' },
    deflect_power: { id:'deflect_power', name:'Deflect Power',    emoji:'🎯', desc:'+15% deflect gücü' },
    speed_bonus:   { id:'speed_bonus',   name:'Speed Bonus',      emoji:'💨', desc:'+15% hareket hızı' },
    stam_regen:    { id:'stam_regen',    name:'Stamina Regen',    emoji:'⚡', desc:'+50% stamina yenileme' },
    cooldown_red:  { id:'cooldown_red',  name:'Cooldown Reduction', emoji:'⏱️', desc:'-20% skill cooldown' },
    lifesteal:     { id:'lifesteal',     name:'Lifesteal',        emoji:'🩸', desc:'Deflect sonrası +3 HP' },
    thorns:        { id:'thorns',        name:'Thorns',           emoji:'🌵', desc:'Vurana 5 geri hasar' }
};

// Aktif skill slotu + 1 rune slotu (Store.setLoadout trims extras). Store'da saklanır.
export const DEFAULT_LOADOUT = {
    skill: 'slow',
    runes: ['deflect_power']
};

// Rune bonuslarını entity statlarına uygula.
export function applyRunes(entity, runeIds = []) {
    entity.runeBonuses = { hp:0, dmgResist:0, deflect:0, speed:0, stamRegen:0, cdr:0, lifesteal:0, thorns:0 };
    runeIds.slice(0, 1).forEach(id => {
        switch (id) {
            case 'hp_bonus':      entity.runeBonuses.hp += 25; break;
            case 'dmg_resist':    entity.runeBonuses.dmgResist += 0.15; break;
            case 'deflect_power': entity.runeBonuses.deflect += 0.15; break;
            case 'speed_bonus':   entity.runeBonuses.speed += 0.15; break;
            case 'stam_regen':    entity.runeBonuses.stamRegen += 0.5; break;
            case 'cooldown_red':  entity.runeBonuses.cdr += 0.20; break;
            case 'lifesteal':     entity.runeBonuses.lifesteal += 3; break;
            case 'thorns':        entity.runeBonuses.thorns += 5; break;
        }
    });
    // Re-derive final stats
    if (entity.maxHp !== undefined) {
        entity.maxHp = (entity._baseMaxHp || entity.maxHp) + entity.runeBonuses.hp;
        entity.hp = Math.min(entity.hp, entity.maxHp);
    }
    if (entity.speed !== undefined) {
        entity._baseSpeed = entity._baseSpeed || entity.speed;
        entity.speed = entity._baseSpeed * (1 + entity.runeBonuses.speed);
    }
    // ponytail fix #3: deflect_power rune uygula
    if (entity.deflectPower !== undefined) {
        entity._baseDeflect = entity._baseDeflect || entity.deflectPower;
        entity.deflectPower = entity._baseDeflect * (1 + entity.runeBonuses.deflect);
    }
}

// Combo-based cooldown acceleration: consecutive perfect deflects enable faster ability cycling.
// Maps combo count to drain acceleration factor; stacks multiplicatively with CDR rune.
// At max combo (4+) + max CDR, cooldowns drain ~57% as fast (43% speedup), enabling skillful play
// without permanent ability access.
export function getComboAcceleration(consecutivePerfectCount = 0) {
    // Graceful: any input ≤ 0 returns 1x (no acceleration)
    if (!Number.isInteger(consecutivePerfectCount) || consecutivePerfectCount < 0) {
        return 1;
    }
    // Acceleration: 1 combo = 1.1x drain, scales to 1.4x at 4+ combo
    // Formula: 1 + Math.min(consecutivePerfectCount, 4) * 0.1
    return 1 + Math.min(consecutivePerfectCount, 4) * 0.1;
}

// Skill cooldown yönetimi. Entity update'inde çağrılır.
export function tickSkillCooldowns(entity, dt, consecutivePerfectCount = 0) {
    if (!entity.skillCooldowns) entity.skillCooldowns = {};
    // cooldown_red advertises a flat -20% cooldown. Draining at dt*(1+cdr) only delivers
    // -16.7% (cd/1.2), so scale the drain by 1/(1-cdr) to hit the advertised number exactly.
    const cdr = Math.min(entity.runeBonuses?.cdr || 0, 0.8);
    const comboAccel = getComboAcceleration(consecutivePerfectCount);
    // Stack multiplicatively: drain *= comboAccel * (1 / (1 - cdr))
    const drain = (dt / (1 - cdr)) * comboAccel;
    for (const skillId in entity.skillCooldowns) {
        if (entity.skillCooldowns[skillId] > 0) {
            entity.skillCooldowns[skillId] -= drain;
            if (entity.skillCooldowns[skillId] < 0) entity.skillCooldowns[skillId] = 0;
        }
    }
}

// Perfect-deflect combo cooldown cut (V3_UX_ROADMAP.md 3.3). Chained perfect deflects
// reward players by shaving flat seconds off their equipped skill's cooldown — pure and
// separate from the drain-rate getComboAcceleration() above (that one accelerates the
// per-frame tick for the whole cooldown window; this one is a one-off subtraction fired
// per perfect hit). chainLength comes straight from perfect-deflect.js's
// resolvePerfectDeflect().chain.count: 1 = first perfect of a new chain, 2+ = consecutive
// (a normal/great/miss deflect resets the chain to 0 upstream, so callers naturally get 0
// here too — no separate "chain broken" input needed).
export const PERFECT_DEFLECT_COOLDOWN_CUT = Object.freeze({
    first: 1.0,     // seconds off cooldown for the opening perfect of a chain
    chained: 1.5,   // seconds off cooldown for every consecutive perfect after that
    roundCap: 6.0   // max total seconds a single round can grant this way (anti-exploit)
});

export function perfectDeflectCooldownCut(chainLength, totalCutThisRound = 0) {
    const chain = Number.isFinite(chainLength) ? Math.trunc(chainLength) : 0;
    if (chain <= 0) return 0;
    const already = Number.isFinite(totalCutThisRound) ? Math.max(0, totalCutThisRound) : 0;
    const remaining = PERFECT_DEFLECT_COOLDOWN_CUT.roundCap - already;
    if (remaining <= 0) return 0;
    const raw = chain === 1 ? PERFECT_DEFLECT_COOLDOWN_CUT.first : PERFECT_DEFLECT_COOLDOWN_CUT.chained;
    return Math.min(raw, remaining);
}

// Skill kullanmayı dene. Başarılıysa etkiyi uygula, true döndür.
export function useSkill(entity, skillId, context = {}) {
    if (context.game?._skillsDisabled || entity?._gameRef?._skillsDisabled) return false;
    const skill = SKILLS[skillId];
    if (!skill) return false;
    if (!entity.skillCooldowns) entity.skillCooldowns = {};
    if (entity.skillCooldowns[skillId] > 0) return false;

    entity.skillCooldowns[skillId] = skill.cooldown;
    const ball = context.ball;
    const target = context.target;

    switch (skillId) {
        case 'slow':
            // ponytail fix: kalıcı currentSpeed yerine anlık velocity yavaşlat — tek atışlık
            if (ball) { ball.currentSpeed *= 0.5; ball.velocity.multiplyScalar(0.5); }
            break;
        case 'freeze':
            if (ball) { ball._frozenTimer = 1.5; ball.velocity.multiplyScalar(0.01); }
            break;
        case 'burn':
            if (target) target._burnTimer = 3; // game.update'de tick
            break;
        case 'shield':
            entity.shield = (entity.shield || 0) + 25;
            break;
        case 'smash':
            if (ball) { ball.currentSpeed *= 1.3; ball.velocity.multiplyScalar(1.3); }
            break;
        case 'heal':
            entity.hp = Math.min(entity.maxHp, entity.hp + 25);
            break;
        case 'teleport':
            if (ball && target) {
                const tp = target.getPosition();
                ball.position.set(tp.x, tp.y + 2, tp.z - 3);
                ball.velocity.set(0, -2, 3);
            }
            break;
        case 'blackhole':
            // context.game.spawnBlackHole() çağrılarak game.js'de işlenir
            break;
    }
    return true;
}

// ponytail: self-check
if (typeof window !== 'undefined' && window.location?.search?.includes('debug')) {
    const e = { maxHp:100, hp:100, speed:10, _baseSpeed:10 };
    applyRunes(e, ['hp_bonus','speed_bonus']);  // slice(0,1) means only hp_bonus applies
    console.assert(e.maxHp === 125, 'rune hp bonus');
    console.assert(Math.abs(e.speed - 10) < 0.01, 'speed unaffected (only 1st rune)');
    console.assert(useSkill(e, 'heal') === true, 'heal used');
    console.assert(useSkill(e, 'heal') === false, 'heal on cooldown');
}
