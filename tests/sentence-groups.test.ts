import assert from 'node:assert/strict';
import test from 'node:test';
import { groupSentences, rawCaptionGroups } from '../lib/sentence-groups.ts';
import { parseSupadata } from '../lib/supadata.ts';

function fixture(rows: [string, number, number][]) {
  return parseSupadata({ lang: 'en', content: rows.map(([text, offset, duration]) => ({ text, offset, duration })) }).cues;
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

test('<=2s joins forward repeatedly; >2s and the final short sentence are retained', () => {
  const groups = groupSentences(fixture([
    ['One!', 0, 1000], ['Two!', 1000, 1000], ['Three!', 2000, 500],
    ['Four!', 3000, 2001], ['Five!', 6000, 2000], ['Six!', 8000, 3000], ['End!', 11000, 200],
  ]));
  assert.deepEqual(groups.map(g => g.text), ['One! Two! Three!', 'Four!', 'Five! Six!', 'End!']);
  assert.deepEqual(groups.map(g => [g.startMs, g.endMs]), [[0, 2500], [3000, 5001], [6000, 11000], [11000, 11200]]);
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

test('unpunctuated tail after a real sentence falls back locally, while <=2s fragments still join forward', () => {
  const cues = fixture([['This sentence ends here.', 0, 3000],
    ['short fragment', 3000, 1000], ['next fragment', 4000, 3000], ['another fragment', 7000, 3000]]);
  const groups = groupSentences(cues);
  assert.deepEqual(groups.map(g => g.text), ['This sentence ends here.', 'short fragment next fragment', 'another fragment']);
  assert.deepEqual(groups.map(g => g.startMs), [0, 3000, 7000]);
  assert.deepEqual(groups.flatMap(g => g.cues), cues);
});

test('large overlapping short-cue input preserves every member without recursive or spread growth', () => {
  const cues = fixture(Array.from({ length: 5000 }, () => ['Repeat!', 1200125, 500] as [string, number, number]));
  const groups = groupSentences(cues);
  assert.equal(groups.length, 1); assert.equal(groups[0].cues.length, 5000);
  assert.equal(groups[0].startMs, 1200125); assert.equal(groups[0].endMs, 1200625);
  assert.deepEqual(groups[0].cues, cues);
});
