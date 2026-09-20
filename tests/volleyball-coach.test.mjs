import test from 'node:test';
import assert from 'node:assert/strict';
import { volleyballCoachCue, volleyballDrillProgress } from '../js/volleyball-coach.js';

test('coach gives the usable key for each physical contact window', () => {
  for (const [action, key] of Object.entries({serve:'E',receive:'R',set:'Q',spike:'F',block:'B'})) {
    const cue = volleyballCoachCue({phase:'rally',expectedAction:action});
    assert.ok(cue[0].startsWith(key));
    assert.ok(cue[1].length > 3);
    assert.ok(cue[2].length > 20);
  }
  assert.equal(volleyballCoachCue({expectedAction:null})[0], 'WATCH THE BALL');
});

test('drill progress stays bounded and complete remains full with a zero target', () => {
  assert.equal(volleyballDrillProgress({drillProgress:1,drillTarget:3}),33);
  assert.equal(volleyballDrillProgress({drillProgress:20,drillTarget:3}),100);
  assert.equal(volleyballDrillProgress({drillProgress:-1,drillTarget:3}),0);
  assert.equal(volleyballDrillProgress({drillComplete:true,drillTarget:0}),100);
});
