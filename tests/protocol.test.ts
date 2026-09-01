import assert from 'node:assert/strict';
import test from 'node:test';
import { isPlaybackRate, PLAYBACK_RATES } from '../lib/protocol.ts';

test('playback speed menu and content scripts share the same validated Enjoy-style rates', () => {
  assert.deepEqual([...PLAYBACK_RATES], [.5, .75, .8, .9, 1, 1.1, 1.25, 1.5, 2]);
  for (const rate of PLAYBACK_RATES) assert.equal(isPlaybackRate(rate), true);
  for (const rate of [0, .6, 1.01, 3, '1']) assert.equal(isPlaybackRate(rate), false);
});
