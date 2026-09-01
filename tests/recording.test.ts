import assert from 'node:assert/strict';
import test from 'node:test';
import { preferredRecordingType, recordedAudio, stopMediaTracks } from '../lib/recording.ts';

test('recording chooses the first actually supported browser audio format', () => {
  assert.equal(preferredRecordingType(type => type === 'audio/webm'), 'audio/webm');
  assert.equal(preferredRecordingType(() => false), '');
  assert.equal(preferredRecordingType(), '');
});

test('empty microphone chunks do not create a broken audio player', () => {
  assert.equal(recordedAudio([], 'audio/webm'), null);
  assert.equal(recordedAudio([new Blob([])], 'audio/webm'), null);
  const audio = recordedAudio([new Blob(['voice'])], 'audio/webm');
  assert.equal(audio?.size, 5); assert.equal(audio?.type, 'audio/webm');
});

test('all microphone tracks are stopped even if one already throws', () => {
  const stopped: number[] = [];
  stopMediaTracks({ getTracks: () => [
    { stop: () => { stopped.push(1); throw new Error('already ended'); } },
    { stop: () => { stopped.push(2); } },
  ] });
  assert.deepEqual(stopped, [1, 2]);
});
