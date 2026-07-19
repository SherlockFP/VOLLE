// characters.js — Character roster with stats + passives. LoL-style.
// ponytail: tek dosya, basit objeler, bot/player ortak kullanım.

const ROSTER = {
    rally: {
        id: 'rally', name: 'Rally', emoji: '🏐',
        maxHp: 100, speed: 10, deflectPower: 1.0, staminaMax: 100,
        passive: 'none',
        desc: 'Dengeli tüm-rounder. Başlangıç karakteri.',
        color: 0xff8844
    },
    tank: {
        id: 'tank', name: 'Bulwark', emoji: '🛡️',
        maxHp: 150, speed: 8, deflectPower: 0.9, staminaMax: 120,
        passive: 'damage_reduc',
        desc: 'Yüksek HP, yavaş. -20% alınan hasar.',
        color: 0x4488ff, price: 300
    },
    scout: {
        id: 'scout', name: 'Scout', emoji: '💨',
        maxHp: 80, speed: 13, deflectPower: 1.1, staminaMax: 90,
        passive: 'fast_stam',
        desc: 'Hızlı ve çevik. +50% stamina yenileme.',
        color: 0x44dd44, price: 300
    },
    sniper: {
        id: 'sniper', name: 'Sniper', emoji: '🎯',
        maxHp: 90, speed: 9, deflectPower: 1.3, staminaMax: 100,
        passive: 'spike_bonus',
        desc: 'Spike şutları +30% bonus hasar.',
        color: 0xaa44ff, price: 400
    },
    guardian: {
        id: 'guardian', name: 'Guardian', emoji: '✨',
        maxHp: 120, speed: 9, deflectPower: 1.0, staminaMax: 110,
        passive: 'shield_regen',
        desc: '3 saniyede bir +5 kalkan rejenerasyonu.',
        color: 0xffdd44, price: 400
    },
    blazer: {
        id: 'blazer', name: 'Blazer', emoji: '🔥',
        maxHp: 95, speed: 11, deflectPower: 1.15, staminaMax: 95,
        passive: 'burn_touch',
        desc: 'Deflect ettiği top hedefi yakar (3 dmg/s, 2sn).',
        color: 0xff3322, price: 500
    },
    frost: {
        id: 'frost', name: 'Frost', emoji: '❄️',
        maxHp: 95, speed: 10, deflectPower: 1.05, staminaMax: 100,
        passive: 'chill_touch',
        desc: 'Deflect ettiği top hedefi yavaşlatır (-20%, 2sn).',
        color: 0x66ccff, price: 500
    },
    volt: {
        id: 'volt', name: 'Volt', emoji: 'V',
        maxHp: 85, speed: 12, deflectPower: 1.12, staminaMax: 105,
        passive: 'fast_stam',
        desc: 'Fast arcade duelist with strong air control.',
        color: 0x62d8ff, price: 550
    },
    nova: {
        id: 'nova', name: 'Nova', emoji: 'N',
        maxHp: 110, speed: 9.5, deflectPower: 1.18, staminaMax: 95,
        passive: 'shield_regen',
        desc: 'Defensive star striker built for long rallies.',
        color: 0xb388ff, price: 600
    },
    ripple: {
        id: 'ripple', name: 'Ripple', emoji: 'R',
        maxHp: 90, speed: 11.5, deflectPower: 1.08, staminaMax: 115,
        passive: 'chill_touch',
        desc: 'Mobile trick-shot specialist with tempo control.',
        color: 0x29e0c1, price: 550
    },
    soldier: {
        id: 'soldier', name: 'Soldier', emoji: 'S',
        maxHp: 110, speed: 9.5, deflectPower: 1.0, staminaMax: 105,
        passive: 'rocket_jump',
        desc: 'Sağ tıkla roket atar. Patlama itişini kullanarak rocket jump yapar.',
        color: 0xd94c48, price: 650
    }
};

// Keep the competitive roster compact. Legacy entries remain in source for save
// compatibility, but are not selectable or assigned to new players.
export const CHARACTERS = Object.freeze(Object.fromEntries(
    ['rally', 'tank', 'scout', 'sniper', 'guardian', 'soldier'].map(id => [id, ROSTER[id]])
));

// Pasif yetenek uygulama — player/bot objesine stat bonusları ekle.
export function applyCharacter(entity, charId) {
    const c = CHARACTERS[charId] || CHARACTERS.rally;
    entity.charId = c.id;
    entity.maxHp = c.maxHp;
    entity.hp = c.maxHp;
    entity.speed = c.speed;
    entity.deflectPower = c.deflectPower || 1.0;
    entity.staminaMax = c.staminaMax || 100;
    entity.stamina = c.staminaMax || 100;
    entity.passive = c.passive;
    entity.charColor = c.color;
    return c;
}

// Hasar hesaplama — deflectPower, pasifler, shot tipi, miss ramp'i birleştir.
export function calcDamage(base, attacker, target, shot = 'flat') {
    let dmg = base;
    if (attacker?.deflectPower) dmg *= attacker.deflectPower;
    // Sniper spike bonus
    if (shot === 'spike' && attacker?.passive === 'spike_bonus') dmg *= 1.3;
    // Tank hasar azaltma
    if (target?.passive === 'damage_reduc') dmg *= 0.8;
    return Math.round(dmg);
}

// Miss ramp — tutamama sayısına göre ekstra hasar.
// 0 miss → base, 1 → +5, 2 → +10, 3+ → +20 (critical)
export function missRampDamage(base, consecutiveMisses) {
    const bonus = consecutiveMisses >= 3 ? 20
                : consecutiveMisses === 2 ? 10
                : consecutiveMisses === 1 ? 5 : 0;
    return base + bonus;
}

// ponytail: self-check — statlar makul aralıkta mı?
if (typeof window !== 'undefined' && window.location?.search?.includes('debug')) {
    console.assert(CHARACTERS.rally.maxHp === 100, 'rally default hp');
    console.assert(missRampDamage(25, 0) === 25, 'no miss = base');
    console.assert(missRampDamage(25, 3) === 45, '3 miss = critical');
    console.assert(calcDamage(25, {deflectPower:1.3, passive:'spike_bonus'}, {}, 'spike') === Math.round(25*1.3*1.3), 'sniper spike combo');
}
