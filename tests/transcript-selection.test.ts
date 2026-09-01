import test from 'node:test';
import assert from 'node:assert/strict';
import { preferredTranscriptTrack } from '../lib/transcript-selection.ts';
import type { Track } from '../lib/protocol.ts';

const track = (language: string, kind: Track['kind']): Track => ({
  id: `${language}:${kind}`, language, kind, name: language, fingerprint: language,
});
test('broad English preference chooses the existing regional manual track over the first automatic track', () => {
  const tracks = [track('en', 'asr'), track('en-GB', 'manual')];
  assert.equal(preferredTranscriptTrack(tracks, 'en'), tracks[1]);
  assert.equal(preferredTranscriptTrack(tracks, 'EN'), tracks[1]);
});
test('an explicit region is retained, and absent matches use saved settings rather than an unrelated track', () => {
  const tracks = [track('en-GB', 'manual'), track('en-US', 'asr'), track('fr', 'manual')];
  assert.equal(preferredTranscriptTrack(tracks, 'en-US'), tracks[1]);
  assert.equal(preferredTranscriptTrack(tracks, 'de'), undefined);
  assert.equal(preferredTranscriptTrack(tracks, null), undefined);
  assert.equal(preferredTranscriptTrack([], 'en'), undefined);
});
test('manual preference does not mutate website track order and keeps exact language when manual choices exist', () => {
  const tracks = [track('en-GB', 'manual'), track('en', 'asr'), track('en', 'manual')];
  const before = structuredClone(tracks);
  assert.equal(preferredTranscriptTrack(tracks, 'en'), tracks[2]);
  assert.deepEqual(tracks, before);
});
