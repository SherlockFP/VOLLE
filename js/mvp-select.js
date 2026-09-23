// mvp-select.js — pure MVP selection + loadout resolution for the post-game MVP
// card (js/ui.js#_renderMvpCard, js/mvp-showcase.js). No THREE import here on
// purpose: this stays testable under plain `node --test` (see
// tests/mvp-select.test.mjs), unlike js/mvp-showcase.js which needs a real
// renderer and therefore imports THREE.

// CS2-style MVP: most eliminations wins; deflections break a kill tie; total
// damage dealt breaks a deflection tie too. Stable otherwise (first entry in
// scoreboard order — js/scoreboard.js#getPlayerStats already sorts by score
// descending, so a full tie keeps that order).
export function selectMvp(playerStats) {
    if (!Array.isArray(playerStats) || playerStats.length === 0) return null;
    let best = null;
    for (const p of playerStats) {
        if (!p) continue;
        if (!best) { best = p; continue; }
        const kills = p.score || 0;
        const bestKills = best.score || 0;
        if (kills !== bestKills) { if (kills > bestKills) best = p; continue; }
        const deflects = p.deflections || 0;
        const bestDeflects = best.deflections || 0;
        if (deflects !== bestDeflects) { if (deflects > bestDeflects) best = p; continue; }
        const damage = p.damageDealt || 0;
        const bestDamage = best.damageDealt || 0;
        if (damage > bestDamage) best = p;
    }
    return best;
}

const DEFAULT_LOADOUT = Object.freeze({ knifeId: 'training', gloveId: 'none', ballSkinId: 'classic' });

// Resolves what the MVP actually has equipped, for the post-game 3D showcase.
// `game`/`player`/`store` are live objects (js/main.js only — game.js and the
// other gameplay modules never see this file). Any piece this can't resolve
// falls back to the game's own default (training knife / no glove / classic
// ball), never a guess.
//
// - Local human: js/player.js#knifeId (own equip) + Store's equippedWearables/
//   equippedBall — no network round-trip needed, it's this client's own state.
// - Remote human: js/network.js syncs knife choice through 'position' packets
//   (js/game.js applies it as entity.knifeId) and glove/cosmetic entitlements
//   through 'cosmeticLoadout' packets (js/game.js#setRemoteCosmetics stores the
//   normalized loadout as entity.wearableLoadout). Ball skin is a single
//   object shared by the whole match, not a per-player choice, so it is never
//   synced per remote player — remote MVPs always show the default ball.
// - Bot: js/bot.js gives every bot a knifeId (default 'training') but no
//   wearable loadout or ball skin.
export function resolveMvpLoadout(mvp, { game, player, store } = {}) {
    if (!mvp || !mvp.name) return null;
    const team = mvp.team || player?.team || 'red';
    if (!game) return { ...DEFAULT_LOADOUT, team };

    if (game.playerName === mvp.name) {
        const knifeId = player?.knifeId
            || store?.get?.('equippedKnives')?.[player?.team || team]
            || DEFAULT_LOADOUT.knifeId;
        const wearables = store?.get?.('equippedWearables');
        const gloveId = wearables?.gloves && wearables.gloves !== 'none' ? wearables.gloves : DEFAULT_LOADOUT.gloveId;
        const ballSkinId = store?.get?.('equippedBall') || DEFAULT_LOADOUT.ballSkinId;
        return { knifeId, gloveId, ballSkinId, team: player?.team || team };
    }

    for (const entity of game.remotePlayers?.values?.() || []) {
        if (entity?.name !== mvp.name) continue;
        const gloves = entity.wearableLoadout?.gloves;
        return {
            knifeId: entity.knifeId || DEFAULT_LOADOUT.knifeId,
            gloveId: gloves && gloves !== 'none' ? gloves : DEFAULT_LOADOUT.gloveId,
            ballSkinId: DEFAULT_LOADOUT.ballSkinId,
            team: entity.team || team
        };
    }

    for (const bot of game.bots || []) {
        if (bot?.name !== mvp.name) continue;
        return { ...DEFAULT_LOADOUT, knifeId: bot.knifeId || DEFAULT_LOADOUT.knifeId, team: bot.team || team };
    }

    return { ...DEFAULT_LOADOUT, team };
}
