import assert from 'node:assert/strict';
import test from 'node:test';
import { adjacentPlaybackRate, isPlaybackRate, PLAYER_SHORTCUTS, PLAYBACK_RATES } from '../lib/protocol.ts';

test('playback speed menu and content scripts share the same validated Enjoy-style rates', () => {
  assert.deepEqual([...PLAYBACK_RATES], [.75, .8, .9, 1]);
  for (const rate of PLAYBACK_RATES) assert.equal(isPlaybackRate(rate), true);
  for (const rate of [0, .6, 1.01, 3, '1']) assert.equal(isPlaybackRate(rate), false);
});

test('playback rate steps and shortcut defaults follow Enjoy media controls', () => {
  assert.equal(adjacentPlaybackRate(.75, -1), .75);
  assert.equal(adjacentPlaybackRate(.75, 1), .8);
  assert.equal(adjacentPlaybackRate(.9, 1), 1);
  assert.equal(adjacentPlaybackRate(1, 1), 1);
  assert.equal(adjacentPlaybackRate(1.25, -1), 1);
  assert.deepEqual(PLAYER_SHORTCUTS, {
    playOrPause: 'Space', previous: 'KeyA', replay: 'KeyS', next: 'KeyD',
    toggleEcho: 'KeyE', toggleDictation: 'KeyH', record: 'KeyR', playRecording: 'KeyG',
    decreaseRate: 'Comma', increaseRate: 'Period',
  });
});
