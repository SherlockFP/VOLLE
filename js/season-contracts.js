export const SEASON_ID = 'launch-season-1';

export const SEASON_CONTRACTS = Object.freeze([
    Object.freeze({ id: 'matchmaker', name: 'Matchmaker', description: 'Complete 30 matches', type: 'games', target: 30, reward: 700 }),
    Object.freeze({ id: 'wall', name: 'The Wall', description: 'Deflect 250 shots', type: 'deflects', target: 250, reward: 600 }),
    Object.freeze({ id: 'winner', name: 'Victory Line', description: 'Win 15 matches', type: 'wins', target: 15, reward: 850 }),
    Object.freeze({ id: 'flight', name: 'Flight School', description: 'Longjump 1,500 meters', type: 'longjumpDistance', target: 1500, reward: 650 }),
    Object.freeze({ id: 'soldier', name: 'Blast Course', description: 'Perform 25 rocket jumps', type: 'rocketJumps', target: 25, reward: 550 })
]);

export function createSeasonContractState(value = {}) {
    const sameSeason = value?.seasonId === SEASON_ID;
    const sourceProgress = sameSeason && value.progress && typeof value.progress === 'object'
        ? value.progress
        : {};
    return {
        seasonId: SEASON_ID,
        progress: Object.fromEntries(SEASON_CONTRACTS.map(contract => [
            contract.id,
            Math.min(contract.target, Math.max(0, Number(sourceProgress[contract.id]) || 0))
        ])),
        claimed: sameSeason && Array.isArray(value.claimed)
            ? value.claimed.filter(id => SEASON_CONTRACTS.some(contract => contract.id === id))
            : []
    };
}

export function progressSeasonContracts(state, context = {}) {
    const next = createSeasonContractState(state);
    for (const contract of SEASON_CONTRACTS) {
        if (next.claimed.includes(contract.id)) continue;
        let amount = 0;
        if (contract.type === 'games') amount = context.games || 0;
        if (contract.type === 'deflects') amount = context.deflects || 0;
        if (contract.type === 'wins') amount = context.wins || 0;
        if (contract.type === 'longjumpDistance') amount = context.longjumpDistance || 0;
        if (contract.type === 'rocketJumps') amount = context.rocketJumps || 0;
        next.progress[contract.id] = Math.min(
            contract.target,
            next.progress[contract.id] + Math.max(0, Number(amount) || 0)
        );
    }
    return next;
}

export function claimSeasonContract(state, contractId) {
    const next = createSeasonContractState(state);
    const contract = SEASON_CONTRACTS.find(item => item.id === contractId);
    if (!contract || next.claimed.includes(contractId) || next.progress[contractId] < contract.target) {
        return { state: next, reward: 0 };
    }
    next.claimed.push(contractId);
    return { state: next, reward: contract.reward };
}
