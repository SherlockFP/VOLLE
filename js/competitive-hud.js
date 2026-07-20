function finiteInt(value, fallback, min = 0) {
    return Number.isFinite(Number(value))
        ? Math.max(min, Math.trunc(Number(value)))
        : fallback;
}

export function getCompetitiveHUDView(state = {}) {
    const active = state?.active === true;
    if (!active) {
        return Object.freeze({
            active: false,
            mode: '',
            roundLabel: '',
            phase: '',
            rulesLabel: '',
            ariaLabel: '',
            key: ''
        });
    }

    const mode = String(state.mode || 'Competitive').trim().slice(0, 32).toUpperCase();
    const round = finiteInt(state.round, 1, 1);
    const maxRounds = finiteInt(state.maxRounds, round, round);
    const tiebreakRound = finiteInt(state.tiebreakRound, 0);
    const roundLabel = tiebreakRound > 0
        ? `TIEBREAK ${tiebreakRound}`
        : `ROUND ${round}/${maxRounds}`;
    const phase = state.suddenDeath
        ? 'SUDDEN DEATH'
        : state.overtime
            ? 'OVERTIME'
            : 'LIVE';
    const restrictions = [
        state.abilities === false && 'Abilities disabled',
        state.runes === false && 'Runes disabled',
        state.passives === false && 'Passives disabled',
        state.powerUps === false && 'Power-ups disabled'
    ].filter(Boolean);
    const rulesLabel = restrictions.length ? 'NO POWERS / NORMALIZED' : 'NORMALIZED RULES';
    const ariaLabel = `${mode}. ${roundLabel}. ${phase}. ${rulesLabel}. ${restrictions.join('. ')}.`;

    return Object.freeze({
        active,
        mode,
        roundLabel,
        phase,
        rulesLabel,
        ariaLabel,
        key: [mode, roundLabel, phase, rulesLabel, ...restrictions].join('|')
    });
}
