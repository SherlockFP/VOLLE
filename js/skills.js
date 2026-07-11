// skills.js — Active skills (Q) + passive runes (LoL-style 4 slot).
// ponytail: tek dosya, basit tanım objeleri, cooldown uygulama logic'i.

export const SKILLS = {
    slow: {
        id: 'slow', name: 'Slow Ball', emoji: '🐌', cooldown: 42,
        desc: 'Topu 2sn %50 yavaşlatır.'
    },
    freeze: {
        id: 'freeze', name: 'Freeze', emoji: '🧊', cooldown: 54,
        desc: 'Topu 1.5sn tam dondurur.'
    },
    burn: {
        id: 'burn', name: 'Burn', emoji: '🔥', cooldown: 48,
        desc: 'Hedefe 3sn boyunca 5 dmg/s hasar.'
    },
    shield: {
        id: 'shield', name: 'Shield', emoji: '🛡️', cooldown: 42,
        desc: '25 kalkan kazan.'
    },
    smash: {
        id: 'smash', name: 'Smash', emoji: '💥', cooldown: 48,
        desc: 'Topa +20% hız vur.'
    },
    heal: {
        id: 'heal', name: 'Heal', emoji: '💚', cooldown: 66,
        desc: '+20 HP yenile.'
    },
    teleport: {
        id: 'teleport', name: 'Teleport', emoji: '🌀', cooldown: 84,
        desc: 'Topu hedefin önüne ışınla.'
    },
    blackhole: {
        id: 'blackhole', name: 'Black Hole', emoji: '🕳️', cooldown: 105,
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

// Aktif skill slotu + 4 rune slotu. Store'da saklanır.
export const DEFAULT_LOADOUT = {
    skill: 'slow',
    runes: ['hp_bonus', 'deflect_power', 'stam_regen', 'cooldown_red']
};

// Rune bonuslarını entity statlarına uygula.
export function applyRunes(entity, runeIds = []) {
    entity.runeBonuses = { hp:0, dmgResist:0, deflect:0, speed:0, stamRegen:0, cdr:0, lifesteal:0, thorns:0 };
    runeIds.forEach(id => {
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

// Skill cooldown yönetimi. Entity update'inde çağrılır.
export function tickSkillCooldowns(entity, dt) {
    if (!entity.skillCooldowns) entity.skillCooldowns = {};
    const cdr = entity.runeBonuses?.cdr || 0;
    for (const skillId in entity.skillCooldowns) {
        if (entity.skillCooldowns[skillId] > 0) {
            entity.skillCooldowns[skillId] -= dt * (1 + cdr);
            if (entity.skillCooldowns[skillId] < 0) entity.skillCooldowns[skillId] = 0;
        }
    }
}

// Skill kullanmayı dene. Başarılıysa etkiyi uygula, true döndür.
export function useSkill(entity, skillId, context = {}) {
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
            entity.hp = Math.min(entity.maxHp, entity.hp + 20);
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
    const e = { maxHp:100, hp:100, speed:10 };
    applyRunes(e, ['hp_bonus','speed_bonus']);
    console.assert(e.maxHp === 125, 'rune hp bonus');
    console.assert(Math.abs(e.speed - 11.5) < 0.01, 'rune speed bonus');
    console.assert(useSkill(e, 'heal') === true, 'heal used');
    console.assert(useSkill(e, 'heal') === false, 'heal on cooldown');
}
