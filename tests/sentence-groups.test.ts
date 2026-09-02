import assert from 'node:assert/strict';
import test from 'node:test';
import { groupSentences, rawCaptionGroups } from '../lib/sentence-groups.ts';
import type { RawCue } from '../lib/captions.ts';

function fixture(rows: [string, number, number][]) {
  return rows.map<RawCue>(([text, offset, duration], sourceIndex) => ({ cueId: `fixture:${sourceIndex}`,
    sourceIndex, text, startMs: offset, endMs: duration > 0 ? offset + duration : null,
    timingSource: 'offset+duration', timingIssue: duration > 0 ? null : 'duration 非法',
    raw: { text, offset, duration } }));
}

test('SBD crosses raw cue boundaries, protects abbreviations, and preserves all source text and times', () => {
  const cues = fixture([
    ['I met Mr.', 1234, 1000], ['Smith at the station.', 2234, 2500],
    ['Are you ready?', 5000, 2500], ['Yes, absolutely!', 7600, 2500],
  ]);
  const before = structuredClone(cues);
  const groups = groupSentences(cues);
  assert.deepEqual(groups.map(g => g.text), ['I met Mr. Smith at the station.', 'Are you ready?', 'Yes, absolutely!']);
  assert.equal(groups[0].startMs, 1234); assert.equal(groups[0].endMs, 4734);
  assert.deepEqual(groups.flatMap(g => g.cues), cues); assert.deepEqual(cues, before);
});

test('natural sentence groups keep their own canonical timing regardless of duration', () => {
  const groups = groupSentences(fixture([
    ['One!', 0, 1000], ['Two!', 1000, 1000], ['Three!', 2000, 500],
    ['Four!', 3000, 2001], ['Five!', 6000, 2000], ['Six!', 8000, 3000], ['End!', 11000, 200],
  ]));
  assert.deepEqual(groups.map(g => g.text), ['One!', 'Two!', 'Three!', 'Four!', 'Five!', 'Six!', 'End!']);
  assert.deepEqual(groups.map(g => [g.startMs, g.endMs]), [[0, 1000], [1000, 2000], [2000, 2500], [3000, 5001],
    [6000, 8000], [8000, 11000], [11000, 11200]]);
});

test('a short caption remains separate when the next sentence starts after a long silence', () => {
  const groups = groupSentences(fixture([['Go!', 0, 1_000], ['Continue now.', 5_000, 3_000]]));
  assert.deepEqual(groups.map(group => group.text), ['Go!', 'Continue now.']);
  assert.deepEqual(groups.map(group => [group.startMs, group.endMs]), [[0, 1_000], [5_000, 8_000]]);
});

test('boundaries inside a source cue never manufacture a new timestamp', () => {
  const cues = fixture([['First sentence! Second', 1200125, 3000], ['sentence ends here.', 1203125, 3000]]);
  const groups = groupSentences(cues);
  assert.equal(groups.length, 1); assert.equal(groups[0].startMs, 1200125);
  assert.match(groups[0].notice!, /句内时间/); assert.equal(groups[0].cues.length, 2);
});

test('preserves URLs, emails, decimals, ellipsis and mixed punctuation without deleting characters', () => {
  const cues = fixture([
    ['Pay $3.14 at example.com or email a@example.com.', 0, 7000],
    ['Wait... really?!', 7000, 3000], ['Call 202-555-0123!', 10000, 3000],
  ]);
  const groups = groupSentences(cues);
  assert.deepEqual(groups.flatMap(g => g.cues), cues);
  assert.equal(groups.map(g => g.text).join(' '), cues.map(c => c.text).join(' '));
  assert.equal(groups.length, 3);
});

test('no-space punctuation, quotes, literal HTML and whitespace never replace raw text', () => {
  for (const text of ['Hello!Next.', 'She said "Hello." Then left.', '  <img src=x>\nHello!  ', 'First.\n\nSecond!']) {
    const cues = fixture([[text, 0, 5000]]);
    const groups = groupSentences(cues);
    assert.equal(groups[0].text, text); assert.equal(groups[0].startMs, 0);
    assert.deepEqual(groups.flatMap(g => g.cues), cues);
  }
});

test('invalid times, empty cues, backward times and duplicates are not hidden or reordered', () => {
  const cues = fixture([['Short!', 10000, 1000], ['', 11000, 3000], ['Bad!', 14000, 0],
    ['Repeat!', 15000, 3000], ['Repeat!', 15000, 3000], ['Back!', 100, 1000]]);
  cues[2].startMs = null;
  const groups = groupSentences(cues);
  assert.deepEqual(groups.flatMap(g => g.cues), cues);
  assert.equal(groups.length, 6); assert.equal(groups[2].startMs, null);
  assert.equal(groups[5].startMs, 100);
  assert.equal(rawCaptionGroups(cues).length, cues.length);
});

test('overlapping members retain their actual maximum end time, without shortening coverage', () => {
  const groups = groupSentences(fixture([['An unfinished', 1200125, 6000], ['sentence.', 1202125, 500]]));
  assert.equal(groups.length, 1); assert.equal(groups[0].startMs, 1200125); assert.equal(groups[0].endMs, 1206125);
});

test('no punctuation and trailing text survive without an invented sentence end', () => {
  const cues = fixture([['not punctuated', 0, 3000], ['still continuing', 3000, 3000]]);
  const groups = groupSentences(cues);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.flatMap(g => g.cues), cues);
  assert.equal(groupSentences([]).length, 0);
});

test('439 unpunctuated synthetic cues spanning 21 minutes are not interpreted as one sentence', () => {
  // Mirrors the screenshot's failure shape, not the user's unavailable raw track.
  const cues = fixture(Array.from({ length: 439 }, (_, i) =>
    [`unpunctuated synthetic caption ${i}`, 40 + i * 2878, i === 438 ? 3116 : 2878] as [string, number, number]));
  const groups = groupSentences(cues);
  assert.equal(groups.length, 439);
  assert.equal(groups[0].startMs, 40); assert.equal(groups.at(-1)!.endMs, 1263720);
  assert.deepEqual(groups.flatMap(g => g.cues), cues);
  assert.ok(groups.every(g => /缺少句末标点/.test(g.notice ?? '')));
});

test('unpunctuated tail after a real sentence falls back locally without duration-based merging', () => {
  const cues = fixture([['This sentence ends here.', 0, 3000],
    ['short fragment', 3000, 1000], ['next fragment', 4000, 3000], ['another fragment', 7000, 3000]]);
  const groups = groupSentences(cues);
  assert.deepEqual(groups.map(g => g.text), ['This sentence ends here.', 'short fragment', 'next fragment', 'another fragment']);
  assert.deepEqual(groups.map(g => g.startMs), [0, 3000, 4000, 7000]);
  assert.deepEqual(groups.flatMap(g => g.cues), cues);
});

test('large overlapping short-cue input stays linear and preserves every independent sentence', () => {
  const cues = fixture(Array.from({ length: 5000 }, () => ['Repeat!', 1200125, 500] as [string, number, number]));
  const groups = groupSentences(cues);
  assert.equal(groups.length, 5000); assert.ok(groups.every(group => group.cues.length === 1));
  assert.equal(groups[0].startMs, 1200125); assert.equal(groups.at(-1)!.endMs, 1200625);
  assert.deepEqual(groups.flatMap(group => group.cues), cues);
});

test('an abnormally large continuous run bypasses SBD while preserving every raw cue', () => {
  const cues = fixture(Array.from({ length: 3 }, (_, index) => [`${'word '.repeat(34_000)}part${index}`, index * 10_000, 10_000]));
  const groups = groupSentences(cues);
  assert.equal(groups.length, cues.length); assert.deepEqual(groups.map(group => group.text), cues.map(item => item.text));
  assert.ok(groups.every(group => /文本过长/.test(group.notice ?? '')));
});
