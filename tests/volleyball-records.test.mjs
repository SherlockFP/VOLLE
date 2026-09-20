import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createVolleyballPracticeRecordStore,
  normalizeVolleyballPracticeRecords,
} from '../js/volleyball-records.js';

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  let writes = 0;
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { writes++; values.set(key, value); },
    get writes() { return writes; },
  };
}

test('practice record store keeps the fastest completion and longest rally with one end-of-run write', () => {
  const storage = memoryStorage();
  const records = createVolleyballPracticeRecordStore(storage);
  const first = records.recordCompletion({ completionElapsedSeconds: 47.25, longestRally: 11 });
  assert.equal(first.changed, true);
  assert.deepEqual(first.records, { bestCompletionSeconds: 47.25, bestLongestRally: 11 });
  assert.equal(storage.writes, 1);
  const slower = records.recordCompletion({ completionElapsedSeconds: 51, longestRally: 9 });
  assert.equal(slower.changed, false);
  assert.equal(storage.writes, 1);
  const improved = records.recordCompletion({ completionElapsedSeconds: 44.5, longestRally: 13 });
  assert.equal(improved.changed, true);
  assert.deepEqual(records.read(), { bestCompletionSeconds: 44.5, bestLongestRally: 13 });
  assert.equal(storage.writes, 2);
});

test('record storage rejects malformed values and survives unavailable browser storage', () => {
  assert.deepEqual(normalizeVolleyballPracticeRecords({ bestCompletionSeconds: -4, bestLongestRally: Infinity }), {
    bestCompletionSeconds: null, bestLongestRally: 0,
  });
  const unavailable = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  const records = createVolleyballPracticeRecordStore(unavailable);
  assert.deepEqual(records.read(), { bestCompletionSeconds: null, bestLongestRally: 0 });
  assert.deepEqual(records.recordCompletion({ elapsedSeconds: 12, longestRally: 5 }), {
    records: { bestCompletionSeconds: null, bestLongestRally: 0 }, changed: false,
  });
});
