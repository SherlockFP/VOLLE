// gamemodes.js — Game modes & mutators for variety/replayability.
// ponytail: tek dosya, basit config objeleri, game.js'e uygulanır.
// Knockout City / Rocket League tarzı mod çeşitliliği.
import { applyCharacter } from './characters.js';
import { applyRunes } from './skills.js';
import { CHAOS_MODES } from './chaos.js';

export const GAME_MODES = {
    classic: {
        id: 'classic', name: 'Classic', emoji: '🏐',
        desc: 'Standart dodgeball. HP tabanlı, son takım ayakta.',
        mutators: {}
    },
    speedball: {
        id: 'speedball', name: 'Speedball', emoji: '⚡',
        desc: 'Top 2x hızlı başlar, daha hızlı ramp. Reflex testi.',
        mutators: { ballSpeedMul: 2.0, speedRampMul: 1.5, maxSpeedMul: 1.3 }
    },
    lowgrav: {
        id: 'lowgrav', name: 'Low Gravity', emoji: '🌙',
        desc: 'Düşük yerçekimi, uzun zıplamalar, havada deflect.',
        mutators: { gravity: -6, jumpForce: 14 }
    },
    instagib: {
        id: 'instagib', name: 'Instagib', emoji: '💀',
        desc: 'Tek vuruşta ölüm. HP yok, saf dodge.',
        mutators: { oneHitKill: true, maxHp: 1 }
    },
    tanky: {
        id: 'tanky', name: 'Tank Mode', emoji: '🛡️',
        desc: '3x HP, uzun rallies, hasar biriktir.',
        mutators: { hpMul: 3, damageMul: 0.5 }
    },
    multiball: {
        id: 'multiball', name: 'Multi Ball', emoji: '🏐🏐',
        desc: 'Aynı anda 3 top! Kaos modu.',
        mutators: { ballCount: 3 }
    },
    tiny: {
        id: 'tiny', name: 'Tiny Arena', emoji: '🤏',
        desc: 'Küçük map, yakın mesafe, hızlı tempolu.',
        mutators: { courtScale: 0.6 }
    },
    giant: {
        id: 'giant', name: 'Giant Arena', emoji: '巨人',
        desc: 'Devasa map, uzun mesafeler, stratejik.',
        mutators: { courtScale: 1.6 }
    },
    freeze: {
        id: 'freeze', name: 'Freeze Tag', emoji: '🧊',
        desc: 'Vurulan oyuncu donar, takım arkadaşı çözer.',
        mutators: { freezeOnHit: true }
    },
    hotpotato: {
        id: 'hotpotato', name: 'Hot Potato', emoji: '🥔',
        desc: 'Top 5sn içinde atılmalı, patlar yoksa.',
        mutators: { ballExplodeTimer: 5 }
    },
    ffa: {
        id: 'ffa', name: 'Free For All', emoji: '⚔️',
        desc: 'Herkes tek. File yok. Son kalan kazanır.',
        mutators: { ffa: true, noNet: true, noTeams: true }
    },
    competitive: {
        id: 'competitive', name: 'Competitive', emoji: '🏆',
        desc: 'First to 3 rounds, overtime if tied.',
        mutators: { maxRounds: 5, overtime: true }
    },
    ...CHAOS_MODES
};

// Mutator'ları game/player/ball objelerine uygula.
export function applyMode(game, modeId) {
    const mode = GAME_MODES[modeId] || GAME_MODES.classic;
    const m = mode.mutators;

    // Reset stats to defaults to avoid compounding speed/HP bugs
    game.ball.baseSpeed = 17;
    game.ball.rallySpeedStep = 0.20;
    game.ball.maxRallyMultiplier = 6.0;
    game.ball.maxSpeed = game.ball.baseSpeed * game.ball.maxRallyMultiplier * (game.ball.skinConfig?.speedBonus || 1);

    game.player.gravity = -20;
    game.player.jumpForce = 8;

    // Reset player HP using character/rune bases
    const p = game.player;
    if (p.loadout && p.loadout.char) {
        applyCharacter(p, p.loadout.char);
        if (p.loadout.runes) {
            applyRunes(p, p.loadout.runes);
        }
    } else {
        p.maxHp = 100;
        p.hp = 100;
        p.speed = 10;
        p.deflectPower = 1.0;
        p.staminaMax = 100;
        p.stamina = 100;
        p.passive = 'none';
    }

    // Reset bots HP using character/rune bases
    game.bots.forEach(bot => {
        if (bot.charId) {
            applyCharacter(bot, bot.charId);
            if (bot.loadout && bot.loadout.runes) {
                applyRunes(bot, bot.loadout.runes);
            }
        } else {
            bot.maxHp = bot._baseMaxHp || 100;
            bot.hp = bot.maxHp;
            bot.drawHpBar();
        }
    });

    // Reset flags
    game._damageMul = 1.0;
    game._oneHitKill = false;
    game._freezeOnHit = false;
    game._ballExplodeTimer = 0;
    game._ballCount = 1;
    game._courtScale = 1;
    game._ffa = false;
    game._noNet = false;
    game._noTeams = false;

    // Ball speed
    if (m.ballSpeedMul) {
        game.ball.baseSpeed *= m.ballSpeedMul;
        game.ball.currentSpeed = game.ball.baseSpeed;
    }
    if (m.speedRampMul) game.ball.rallySpeedStep *= m.speedRampMul;
    if (m.maxSpeedMul) game.ball.maxSpeed *= m.maxSpeedMul;

    // Gravity / jump
    if (m.gravity) game.player.gravity = m.gravity;
    if (m.jumpForce) game.player.jumpForce = m.jumpForce;

    // HP
    if (m.maxHp) { game.player.maxHp = m.maxHp; game.player.hp = m.maxHp; }
    if (m.hpMul) {
        game.player.maxHp *= m.hpMul;
        game.player.hp = game.player.maxHp;
        game.bots.forEach(b => { b.maxHp *= m.hpMul; b.hp = b.maxHp; b.drawHpBar(); });
    }
    if (m.damageMul) game._damageMul = m.damageMul;

    // Flags
    game._oneHitKill = !!m.oneHitKill;
    game._freezeOnHit = !!m.freezeOnHit;
    game._ballExplodeTimer = m.ballExplodeTimer || 0;
    game._ballCount = m.ballCount || 1;
    game._courtScale = m.courtScale || 1;
    game._ffa = !!m.ffa;
    game._noNet = !!m.noNet;
    game.ball._pinballBounce = !!m.pinballBounce;
    game._noTeams = !!m.noTeams;

    if (m.maxRounds) game.scoreboard.setMaxRounds(m.maxRounds);

    game.mode = mode;
    return mode;
}

export function getModeList() {
    return Object.values(GAME_MODES);
}
