const RECORDS_KEY = 'volle-volleyball-practice-records-v1';
const MAX_SECONDS = 24 * 60 * 60;
const MAX_RALLY = 100000;

export const EMPTY_VOLLEYBALL_PRACTICE_RECORDS = Object.freeze({
  bestCompletionSeconds: null,
  bestLongestRally: 0,
});

function finiteCompletionSeconds(value) {
  return Number.isFinite(value) && value > 0 && value <= MAX_SECONDS ? value : null;
}

function boundedRally(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_RALLY ? value : 0;
}

/** Validate persisted data defensively; malformed browser storage is treated as empty. */
export function normalizeVolleyballPracticeRecords(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...EMPTY_VOLLEYBALL_PRACTICE_RECORDS };
  return {
    bestCompletionSeconds: finiteCompletionSeconds(value.bestCompletionSeconds),
    bestLongestRally: boundedRally(value.bestLongestRally),
  };
}

function readStorage(storage) {
  try {
    const raw = storage?.getItem?.(RECORDS_KEY);
    return normalizeVolleyballPracticeRecords(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...EMPTY_VOLLEYBALL_PRACTICE_RECORDS };
  }
}

/**
 * Small local-only record store. Call recordCompletion once when the challenge
 * finishes; it never writes during simulation or on individual contacts.
 */
export function createVolleyballPracticeRecordStore(storage = globalThis.localStorage) {
  function read() { return readStorage(storage); }

  function recordCompletion(summary) {
    const elapsedSeconds = finiteCompletionSeconds(summary?.completionElapsedSeconds ?? summary?.elapsedSeconds);
    const longestRally = boundedRally(summary?.longestRally);
    if (elapsedSeconds == null) return { records: read(), changed: false };
    const current = read();
    const next = {
      bestCompletionSeconds: current.bestCompletionSeconds == null
        ? elapsedSeconds : Math.min(current.bestCompletionSeconds, elapsedSeconds),
      bestLongestRally: Math.max(current.bestLongestRally, longestRally),
    };
    const changed = next.bestCompletionSeconds !== current.bestCompletionSeconds
      || next.bestLongestRally !== current.bestLongestRally;
    if (changed) {
      try { storage?.setItem?.(RECORDS_KEY, JSON.stringify(next)); } catch { return { records: current, changed: false }; }
    }
    return { records: next, changed };
  }

  return Object.freeze({ read, recordCompletion });
}
