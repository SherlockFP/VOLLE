const CUES = Object.freeze({
  serve: ['E / LEFT CLICK', 'Serve to start', 'Send the ball over the tape to begin your rally.'],
  receive: ['R / LEFT CLICK', 'Receive now', 'Lift the incoming ball, then prepare your set.'],
  set: ['Q / RIGHT CLICK', 'Set it high', 'Build height for your next attacking contact.'],
  spike: ['F / LEFT CLICK', 'Attack the court', 'Drive your third touch across the net.'],
  block: ['B / RIGHT CLICK', 'Close the net', 'Meet the attack with a block.'],
});

export function volleyballCoachCue(state) {
  if (state.phase === 'point_awarded' || state.phase === 'dead_ball') {
    return ['NEXT RALLY', 'Reset your rhythm', 'Watch the score. The next serve will be ready shortly.'];
  }
  return CUES[state.expectedAction] || ['WATCH THE BALL', 'Read the return', 'The floor ring shows where the ball is above the court.'];
}

export function volleyballDrillProgress(state) {
  const target = Math.max(1, Number(state.drillTarget) || 1);
  const progress = Math.max(0, Math.min(target, Number(state.drillProgress) || 0));
  return state.drillComplete ? 100 : Math.round(progress / target * 100);
}
