export const COMPETITIVE_RULESET = Object.freeze({
    id: 'ranked-v1',
    abilities: false,
    runes: false,
    passives: false,
    powerUps: false,
    stats: Object.freeze({
        maxHp: 100,
        speed: 10,
        deflectPower: 1,
        staminaMax: 100
    })
});

const ZERO_RUNE_BONUSES = Object.freeze({
    hp: 0,
    dmgResist: 0,
    deflect: 0,
    speed: 0,
    stamRegen: 0,
    cdr: 0,
    lifesteal: 0,
    thorns: 0
});

function entities(game) {
    const remotePlayers = game?.remotePlayers instanceof Map
        ? [...game.remotePlayers.values()]
        : [];
    return [game?.player, ...(game?.bots || []), ...remotePlayers].filter(Boolean);
}

function clearBaseStats(entity) {
    delete entity._baseMaxHp;
    delete entity._baseSpeed;
    delete entity._baseDeflect;
    delete entity._competitiveRulesetId;
}

function disposeMaterial(material) {
    if (Array.isArray(material)) material.forEach(item => item?.dispose?.());
    else material?.dispose?.();
}

function clearPowerUps(game) {
    for (const powerUp of game?.powerUps || []) {
        game.arena?.remove?.(powerUp.mesh);
        powerUp.mesh?.geometry?.dispose?.();
        disposeMaterial(powerUp.mesh?.material);
    }
    if (Array.isArray(game?.powerUps)) game.powerUps.length = 0;
}

export function clearCompetitiveRules(game) {
    if (!game) return;
    const shouldRestore = Boolean(game.competitiveRules);
    game.competitiveRules = null;
    game._skillsDisabled = false;
    game._powerUpsDisabled = false;
    for (const entity of entities(game)) {
        clearBaseStats(entity);
        if (!shouldRestore) continue;
        const charId = entity.charId || entity.loadout?.char || 'rally';
        applyCharacter(entity, charId);
        if (Array.isArray(entity.loadout?.runes)) {
            applyRunes(entity, entity.loadout.runes);
        }
        if ('moveSpeed' in entity) entity.moveSpeed = entity.speed;
        entity.drawHpBar?.();
    }
}

export function normalizeCompetitiveEntity(entity, rules = COMPETITIVE_RULESET) {
    if (!entity) return null;
    const stats = rules.stats;
    entity.maxHp = stats.maxHp;
    entity.hp = stats.maxHp;
    entity.speed = stats.speed;
    if ('moveSpeed' in entity) entity.moveSpeed = stats.speed;
    entity.deflectPower = stats.deflectPower;
    entity.staminaMax = stats.staminaMax;
    entity.stamina = stats.staminaMax;
    entity.passive = 'none';
    entity.runeBonuses = { ...ZERO_RUNE_BONUSES };
    entity.skillCooldowns = {};
    entity.ultimateCharge = 0;
    entity.ultimateActive = false;
    entity._baseMaxHp = stats.maxHp;
    entity._baseSpeed = stats.speed;
    entity._baseDeflect = stats.deflectPower;
    entity._competitiveRulesetId = rules.id;
    entity.drawHpBar?.();
    return entity;
}

export function applyCompetitiveRules(game, rules = COMPETITIVE_RULESET) {
    if (!game) throw new TypeError('game is required');
    game.competitiveRules = rules;
    game._skillsDisabled = !rules.abilities;
    game._powerUpsDisabled = !rules.powerUps;
    for (const entity of entities(game)) normalizeCompetitiveEntity(entity, rules);
    if (game._powerUpsDisabled) clearPowerUps(game);
    return rules;
}
import { applyCharacter } from './characters.js';
import { applyRunes } from './skills.js';
