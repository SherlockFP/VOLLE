import { VOLLEYBALL_CONTACTS, VOLLEYBALL_TEAMS } from './volleyball-rules.js';

// This is intentionally a presentation-neutral coach. It observes accepted
// contacts and scored rallies; it neither queues actions nor changes rules.
const STAGES = Object.freeze([
  Object.freeze({ id: 'serve', label: 'SERVE BASICS', instruction: 'Use E or primary attack to serve.', target: 3 }),
  Object.freeze({ id: 'receive', label: 'CLEAN RECEIVES', instruction: 'Use E or R to receive five balls.', target: 5 }),
  Object.freeze({ id: 'attack_chain', label: 'BUILD THE ATTACK', instruction: 'Chain receive, set, then spike three times.', target: 3 }),
  Object.freeze({ id: 'block', label: 'NET DEFENSE', instruction: 'Press B or right-click at the net for two blocks.', target: 2 }),
]);

function stageSnapshot(index, progress) {
  const stage = STAGES[index];
  return stage
    ? { drillStage: index, drillStageId: stage.id, drillLabel: stage.label, drillInstruction: stage.instruction, drillProgress: progress, drillTarget: stage.target, drillComplete: false }
    : { drillStage: STAGES.length, drillStageId: 'complete', drillLabel: 'DRILL COMPLETE', drillInstruction: 'Free practice remains open. Improve your longest rally.', drillProgress: 0, drillTarget: 0, drillComplete: true };
}

function gradeSnapshot(index) {
  const completed = Math.min(STAGES.length, Math.max(0, index));
  // The grade deliberately reflects completed goals only. Contacts outside a
  // goal cannot improve it, so buffered input and free-play spam have no value.
  const grades = ['—', 'C', 'B', 'A', 'S'];
  return {
    drillCompletedStages: completed,
    drillGrade: grades[completed],
    drillGradeReason: `${completed} / ${STAGES.length} COURT SKILLS COMPLETE`,
  };
}

/** Create a deterministic local Volleyball skill-drill tracker. */
export function createVolleyballDrillTracker() {
  let stageIndex = 0;
  let stageProgress = 0;
  let successfulContacts = 0;
  let longestRally = 0;
  let currentRallyId = null;
  let currentRallyContacts = 0;
  let chainStep = 0;
  let pointsWon = 0;
  let pointsLost = 0;
  let lastAwardedRallyId = 0;
  let lastContact = '';
  let contactSerial = 0;
  let acceptedServe = 0;
  let acceptedReceive = 0;
  let acceptedPass = 0;
  let acceptedSet = 0;
  let acceptedSpike = 0;
  let acceptedBlock = 0;

  function closeRally() {
    longestRally = Math.max(longestRally, currentRallyContacts);
    currentRallyContacts = 0;
    chainStep = 0;
  }

  function advanceIfQualified(qualified) {
    if (!qualified || stageIndex >= STAGES.length) return;
    stageProgress++;
    if (stageProgress >= STAGES[stageIndex].target) {
      stageIndex++;
      stageProgress = 0;
    }
  }

  return {
    recordContact(type, team, rallyId) {
      if (!Object.values(VOLLEYBALL_CONTACTS).includes(type)) return false;
      if (currentRallyId !== rallyId) {
        if (currentRallyId != null) closeRally();
        currentRallyId = rallyId;
      }
      currentRallyContacts++;
      if (team !== VOLLEYBALL_TEAMS.HOME) return true;
      successfulContacts++;
      lastContact = type;
      contactSerial++;
      if (type === VOLLEYBALL_CONTACTS.SERVE) acceptedServe++;
      else if (type === VOLLEYBALL_CONTACTS.RECEIVE) acceptedReceive++;
      else if (type === VOLLEYBALL_CONTACTS.PASS) acceptedPass++;
      else if (type === VOLLEYBALL_CONTACTS.SET) acceptedSet++;
      else if (type === VOLLEYBALL_CONTACTS.SPIKE) acceptedSpike++;
      else if (type === VOLLEYBALL_CONTACTS.BLOCK) acceptedBlock++;

      const stage = STAGES[stageIndex]?.id;
      if (stage === 'serve') advanceIfQualified(type === VOLLEYBALL_CONTACTS.SERVE);
      else if (stage === 'receive') advanceIfQualified(type === VOLLEYBALL_CONTACTS.RECEIVE);
      else if (stage === 'attack_chain') {
        if (type === VOLLEYBALL_CONTACTS.RECEIVE) chainStep = 1;
        else if (type === VOLLEYBALL_CONTACTS.SET && chainStep === 1) chainStep = 2;
        else if (type === VOLLEYBALL_CONTACTS.SPIKE && chainStep === 2) {
          advanceIfQualified(true);
          chainStep = 0;
        } else chainStep = 0;
      } else if (stage === 'block') advanceIfQualified(type === VOLLEYBALL_CONTACTS.BLOCK);
      return true;
    },

    recordRallyAward(rallyId, winningTeam) {
      if (!Number.isSafeInteger(rallyId) || rallyId <= lastAwardedRallyId) return false;
      lastAwardedRallyId = rallyId;
      closeRally();
      currentRallyId = null;
      if (winningTeam === VOLLEYBALL_TEAMS.HOME) pointsWon++;
      else if (winningTeam === VOLLEYBALL_TEAMS.AWAY) pointsLost++;
      return true;
    },

    reset() {
      stageIndex = 0;
      stageProgress = 0;
      successfulContacts = 0;
      longestRally = 0;
      currentRallyId = null;
      currentRallyContacts = 0;
      chainStep = 0;
      pointsWon = 0;
      pointsLost = 0;
      lastAwardedRallyId = 0;
      lastContact = '';
      contactSerial = 0;
      acceptedServe = 0;
      acceptedReceive = 0;
      acceptedPass = 0;
      acceptedSet = 0;
      acceptedSpike = 0;
      acceptedBlock = 0;
    },

    isComplete() { return stageIndex >= STAGES.length; },

    writeState(out) {
      if (!out || typeof out !== 'object') return false;
      Object.assign(out, stageSnapshot(stageIndex, stageProgress), gradeSnapshot(stageIndex), {
        drillSuccessfulContacts: successfulContacts,
        drillAcceptedServe: acceptedServe,
        drillAcceptedReceive: acceptedReceive,
        drillAcceptedPass: acceptedPass,
        drillAcceptedSet: acceptedSet,
        drillAcceptedSpike: acceptedSpike,
        drillAcceptedBlock: acceptedBlock,
        drillLongestRally: Math.max(longestRally, currentRallyContacts),
        drillPointsWon: pointsWon,
        drillPointsLost: pointsLost,
        drillLastContact: lastContact,
        drillContactSerial: contactSerial,
      });
      return true;
    },
  };
}

export const VOLLEYBALL_DRILL_STAGES = STAGES;
