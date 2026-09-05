import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_TOUR_STATE, GUIDED_TOUR_STEPS } from '../components/use-guided-tours.ts';

test('guided tours stay separate and cover the three learning surfaces', () => {
  assert.deepEqual(Object.keys(GUIDED_TOUR_STEPS), ['welcome', 'shadowing', 'practice']);
  assert.equal(GUIDED_TOUR_STEPS.welcome.length, 9);
  assert.equal(GUIDED_TOUR_STEPS.shadowing.length, 4);
  assert.equal(GUIDED_TOUR_STEPS.practice.length, 6);
  assert.deepEqual(EMPTY_TOUR_STATE, { welcome: false, shadowing: false, practice: false });
});

test('tour copy preserves the project-specific E, F and Space behavior', () => {
  const copy = JSON.stringify(GUIDED_TOUR_STEPS);
  assert.match(copy, /Space/);
  assert.match(copy, /按 E 开启/);
  assert.match(copy, /按 F 单独开启/);
  assert.doesNotMatch(copy, /按 K/);
  assert.match(copy, /不会自动跳到下一句/);
});
