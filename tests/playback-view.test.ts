import assert from 'node:assert/strict';
import test from 'node:test';
import { activeTimedRowIndex, adjacentPlayableRowIndex, matchesPlaybackBinding } from '../lib/playback-view.ts';

test('late playback state from another video, session or track is rejected', () => {
  const binding = { videoId: 'abcdefghijk', session: 'session-b', track: 'track-2' };
  assert.equal(matchesPlaybackBinding({ videoId: 'abcdefghijk', session: 'session-b', trackId: 'track-2' }, binding), true);
  assert.equal(matchesPlaybackBinding({ videoId: 'abcdefghijk', session: 'session-a', trackId: 'track-2' }, binding), false);
  assert.equal(matchesPlaybackBinding({ videoId: 'lmnopqrstuv', session: 'session-b', trackId: 'track-2' }, binding), false);
  assert.equal(matchesPlaybackBinding({ videoId: 'abcdefghijk', session: 'session-b', trackId: 'track-1' }, binding), false);
});

test('active subtitle highlight follows actual cue coverage and leaves real gaps unselected', () => {
  const rows = [{ startMs: 0, endMs: 1_000 }, { startMs: 3_000, endMs: 4_000 }];
  assert.equal(activeTimedRowIndex(rows, 999), 0);
  assert.equal(activeTimedRowIndex(rows, 1_000), -1);
  assert.equal(activeTimedRowIndex(rows, 2_000), -1);
  assert.equal(activeTimedRowIndex(rows, 3_000), 1);
});

test('overlapping subtitle highlight chooses the most recently started valid row', () => {
  const rows = [{ startMs: 0, endMs: 5_000 }, { startMs: 2_000, endMs: 3_000 },
    { startMs: null, endMs: null }, { startMs: 4_000, endMs: 4_000 }];
  assert.equal(activeTimedRowIndex(rows, 2_500), 1);
  assert.equal(activeTimedRowIndex(rows, 3_500), 0);
  assert.equal(activeTimedRowIndex(rows, Number.NaN), -1);
});

test('previous and next controls skip raw captions with invalid timing without hiding them', () => {
  const rows = [{ startMs: 0, endMs: 1_000 }, { startMs: null, endMs: null },
    { startMs: 2_000, endMs: 2_000 }, { startMs: 3_000, endMs: 4_000 }];
  assert.equal(adjacentPlayableRowIndex(rows, 0, 1), 3);
  assert.equal(adjacentPlayableRowIndex(rows, 3, -1), 0);
  assert.equal(adjacentPlayableRowIndex(rows, -1, 1), 0);
  assert.equal(adjacentPlayableRowIndex(rows, 3, 1), -1);
});
