import test from 'node:test';
import assert from 'node:assert/strict';
import { readingLines } from '../lib/reading-lines.ts';
import { groupSentences } from '../lib/sentence-groups.ts';
import { parseSupadata } from '../lib/supadata.ts';

const expected = [
  'George said that the same kind of thing, only worse,',
  'had happened to him some eighteen months ago,',
  'when he was lodging by himself in the house of a certain Mrs. Gippings.',
  'He said his watch went wrong one evening,',
  'and stopped at a quarter-past eight.',
  'He did not know this at the time because,',
  'for some reason or other, he forgot to wind it up when he went to bed',
  '(an unusual occurrence with him),',
  'and hung it up over his pillow without ever looking at the thing.',
];
test('the user reference produces exactly nine consecutive reading lines without blank lines', () => {
  assert.deepEqual(readingLines(expected.join(' ')), expected);
  assert.deepEqual(readingLines(expected.join('\n\n')), expected);
});
test('display sentences split inside a source cue while original timestamps and entries remain intact', () => {
  const cues = parseSupadata({ lang: 'en', content: [
    { offset: 1234, duration: 5000, text: 'I am ready. Let us' },
    { offset: 6234, duration: 4000, text: 'begin.' },
  ] }).cues;
  const before = structuredClone(cues);
  const groups = groupSentences(cues);
  assert.equal(groups.length, 1);
  assert.deepEqual(readingLines(groups[0]!.text), ['I am ready.', 'Let us begin.']);
  assert.equal(groups[0]!.startMs, 1234);
  assert.equal(groups[0]!.endMs, 10234);
  assert.deepEqual(cues, before);
});
test('short punctuation, abbreviations, decimal currency and literal markup remain intact', () => {
  for (const text of ['I met Mrs. Gippings.', 'Well, I agree.', 'Pay $1,234.50 at example.com.',
    '<img src=x> Hello!Next.', 'It was fine (really (very) fine), and we left.']) {
    assert.equal(readingLines(text).join(' ').replace(/\s/g, ''), text.replace(/\s/g, ''));
  }
  assert.deepEqual(readingLines('Well, I agree.'), ['Well, I agree.']);
  assert.deepEqual(readingLines(''), []);
});
test('phrasing does not split quoted commas or drop bilingual text', () => {
  const quote = 'He said "we walked all the way down to the river, and waited there", then left.';
  assert.ok(readingLines(quote).some(line => line.includes('river, and waited there"')));
  assert.deepEqual(readingLines('Hello, students.\n\n同学们，你们好。'), ['Hello, students.', '同学们，你们好。']);
});

test('rules also split unseen long clauses and preserve the existing short-cue time grouping', () => {
  assert.deepEqual(readingLines('We had been living in that city since 2020, before moving to the coast.'),
    ['We had been living in that city since 2020,', 'before moving to the coast.']);
  const cues = parseSupadata({ lang: 'en', content: [
    { text: 'Go!', offset: 0, duration: 1000 }, { text: 'We are ready!', offset: 1000, duration: 3000 },
  ] }).cues;
  const groups = groupSentences(cues);
  assert.equal(groups.length, 1);
  assert.deepEqual(readingLines(groups[0]!.text), ['Go!', 'We are ready!']);
  assert.deepEqual([groups[0]!.startMs, groups[0]!.endMs], [0, 4000]);
});

test('the screenshot dash aside keeps its adjective list together and resets comma counting', () => {
  const text = "Now, I'm not just going to read a list of words to you—to make this really fun, productive and efficient for you—I've divided the words into 10 categories, each focusing on a specific feature of my accent or British everyday vocabulary.";
  assert.deepEqual(readingLines(text), [
    "Now, I'm not just going to read a list of words to you—",
    'to make this really fun, productive and efficient for you—',
    "I've divided the words into 10 categories,",
    'each focusing on a specific feature of my accent or British everyday vocabulary.',
  ]);
});

test('dash boundaries do not split compound words, numeric ranges or quoted dialogue', () => {
  assert.deepEqual(readingLines('The quarter-past eight train takes 10–20 minutes.'),
    ['The quarter-past eight train takes 10–20 minutes.']);
  assert.deepEqual(readingLines('We waited — then left.'), ['We waited —', 'then left.']);
  assert.deepEqual(readingLines('He said "Come here—right now" and left.'),
    ['He said "Come here—right now" and left.']);
});

test('a long clause splits before a substantial prepositional tail', () => {
  assert.deepEqual(readingLines('Today, I am very excited to help you pronounce 100 everyday words in my Modern Received Pronunciation accent.'), [
    'Today, I am very excited to help you pronounce 100 everyday words',
    'in my Modern Received Pronunciation accent.',
  ]);
  assert.deepEqual(readingLines('She lives in the house.'), ['She lives in the house.']);
});

test('long colon and conjunction pauses become lines while times, URLs and short clauses stay intact', () => {
  assert.deepEqual(readingLines('Here is the plan: practise the first group slowly and clearly.'),
    ['Here is the plan:', 'practise the first group slowly and clearly.']);
  assert.deepEqual(readingLines('We reviewed every example from the first chapter to the final appendix and then repeated the difficult passages together.'), [
    'We reviewed every example from the first chapter to the final appendix',
    'and then repeated the difficult passages together.',
  ]);
  assert.deepEqual(readingLines('Meet me at 10:30 and open https://example.com:443/docs.'),
    ['Meet me at 10:30 and open https://example.com:443/docs.']);
  assert.deepEqual(readingLines('We reviewed every example from the first chapter to the final appendix and then repeated the difficult passages together'), [
    'We reviewed every example from the first chapter to the final appendix',
    'and then repeated the difficult passages together',
  ]);
});

test('a sequence marker after a comma starts the following reading line', () => {
  assert.deepEqual(readingLines("Step 1: I'll model each word for you, first slowly and then faster."), [
    'Step 1:',
    "I'll model each word for you,",
    'first slowly and then faster.',
  ]);
  assert.deepEqual(readingLines('You can, first, check the short example.'),
    ['You can, first, check the short example.']);
});

test('commas inside curly single quotes and bracketed asides do not create false outer clauses', () => {
  assert.deepEqual(readingLines('She called it ‘clear, practical, and useful’ before leaving.'),
    ['She called it ‘clear, practical, and useful’ before leaving.']);
  assert.deepEqual(readingLines('We finished the first exercise [an unusual, but useful, warm-up], and continued.'), [
    'We finished the first exercise', '[an unusual, but useful, warm-up],', 'and continued.',
  ]);
});

test('pathological display text skips expensive phrasing without dropping source characters', () => {
  const text = `${'word '.repeat(40_001)}end.`;
  const lines = readingLines(text);
  assert.equal(lines.length, 1);
  assert.equal(lines[0], text.trim());
});
