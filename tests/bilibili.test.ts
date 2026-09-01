import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { biliPhrases, biliVideo, bvidToAid, chooseBiliTrack, isBiliTrack, pairBiliCues } from '../lib/bilibili.ts';
import { md5 } from '../lib/bilibili-wbi.ts';
import type { RawCue } from '../lib/captions.ts';

test('Bilibili URL/page parsing and WBI MD5 match known platform inputs', () => {
  assert.deepEqual(biliVideo('https://www.bilibili.com/video/BV1GJ411x7h7?p=2'), { bvid: 'BV1GJ411x7h7', page: 2 });
  assert.equal(biliVideo('https://www.youtube.com/watch?v=abcdefghijk'), null);
  for (const sample of ['', 'abc', '中文字幕测试', 'a'.repeat(64)]) {
    assert.equal(md5(sample), createHash('md5').update(sample).digest('hex'));
  }
});

test('modern Bilibili BV ids convert locally to their exact numeric aid', () => {
  assert.equal(bvidToAid('BV17x411w7KC'), 170001);
  assert.equal(bvidToAid('BV1XB4y1P7xd'), 587415431);
  assert.equal(bvidToAid('invalid'), null);
  assert.equal(bvidToAid('BV1XB4y1P7x0'), null);
});

test('Bilibili page-bridge tracks only accept official HTTPS subtitle hosts', () => {
  const valid = { id: 'bili:1', name: 'English', language: 'en-US', kind: 'manual' as const, url: 'https://i0.hdslb.com/subtitle.json' };
  assert.equal(isBiliTrack(valid), true);
  assert.equal(isBiliTrack({ ...valid, url: 'http://i0.hdslb.com/subtitle.json' }), false);
  assert.equal(isBiliTrack({ ...valid, url: 'https://example.com/subtitle.json' }), false);
  assert.equal(isBiliTrack({ ...valid, secondary: { id: 'x', name: '中文', language: 'zh-CN', url: 'https://evil.example/subtitle.json' } }), false);
});

test('Bilibili chooses a website bilingual track first, then manual language tracks', () => {
  const tracks = [
    { id: 'en', name: '英语', language: 'en-US', kind: 'manual' as const, url: 'https://x/en.json' },
    { id: 'zh-ai', name: '中文自动', language: 'ai-zh', kind: 'asr' as const, url: 'https://x/ai.json' },
    { id: 'both', name: '中英双语', language: 'zh-CN', kind: 'manual' as const, url: 'https://x/both.json' },
  ];
  assert.equal(chooseBiliTrack(tracks)?.id, 'both');
  assert.equal(chooseBiliTrack(tracks.slice(0, 2))?.id, 'zh-ai');
});

test('Bilibili phrases preserve real cue boundaries and never invent an intra-cue timestamp', () => {
  const cues: RawCue[] = [
    { cueId: 'b:0', sourceIndex: 0, text: 'First sentence. Second sentence.', startMs: 1000, endMs: 5000,
      timingSource: 'start+duration', timingIssue: null, raw: { from: 1, to: 5, content: 'First sentence. Second sentence.' } },
    { cueId: 'b:1', sourceIndex: 1, text: 'Third sentence.', startMs: 5000, endMs: 8000,
      timingSource: 'start+duration', timingIssue: null, raw: { from: 5, to: 8, content: 'Third sentence.' } },
  ];
  const phrases = biliPhrases(cues);
  assert.equal(phrases[0]?.startMs, 1000);
  assert.equal(phrases[0]?.text, 'First sentence. Second sentence.');
  assert.ok(phrases.every(phrase => phrase.startMs === 1000 || phrase.startMs === 5000));
});

test('Bilibili website bilingual pairing aligns existing tracks without translating or inventing time', () => {
  const cue = (cueId: string, text: string, startMs: number, endMs: number) => ({ cueId, sourceIndex: 0, text, startMs, endMs,
    timingSource: 'start+duration' as const, timingIssue: null, raw: { text } });
  const paired = pairBiliCues([
    cue('en:0', 'Hello.', 1000, 3000), cue('en:1', 'How are you?', 3000, 5000),
  ], [cue('zh:0', '你好。你好吗？', 1000, 5000)]);
  assert.equal(paired.length, 1);
  assert.equal(paired[0].text, 'Hello. How are you?\n你好。你好吗？');
  assert.deepEqual([paired[0].startMs, paired[0].endMs], [1000, 5000]);
  assert.deepEqual(paired[0].raw, { primary: [{ text: 'Hello.' }, { text: 'How are you?' }], secondary: [{ text: '你好。你好吗？' }] });
  const phrases = biliPhrases(paired);
  assert.equal(phrases.length, 1);
  assert.equal(phrases[0].text, 'Hello. How are you?\n你好。你好吗？');
  assert.deepEqual([phrases[0].startMs, phrases[0].endMs], [1000, 5000]);
});

test('Bilibili bilingual pairing preserves front, middle and post-20-minute real cue boundaries', () => {
  const cue = (prefix: string, index: number, seconds: number, duration: number) => ({ cueId: `${prefix}:${index}`, sourceIndex: index,
    text: `${prefix} ${index}.`, startMs: seconds * 1000, endMs: (seconds + duration) * 1000,
    timingSource: 'start+duration' as const, timingIssue: null, raw: { prefix, index } });
  const primary = Array.from({ length: 1202 }, (_, index) => cue('English', index, index, 1));
  const secondary = Array.from({ length: 601 }, (_, index) => cue('中文', index, index * 2, 2));
  const paired = pairBiliCues(primary, secondary);
  assert.deepEqual([paired[0].startMs, paired[0].endMs], [0, 2000]);
  assert.deepEqual([paired[300].startMs, paired[300].endMs], [600000, 602000]);
  assert.deepEqual([paired.at(-1)?.startMs, paired.at(-1)?.endMs], [1200000, 1202000]);
  assert.equal(paired.reduce((total, item) => total + (item.raw as { primary: unknown[] }).primary.length, 0), primary.length);
  assert.equal(paired.reduce((total, item) => total + (item.raw as { secondary: unknown[] }).secondary.length, 0), secondary.length);
});

test('Bilibili rolling bilingual captions stay lane-ordered, deduplicated and at most six seconds per derived phrase', () => {
  const cue = (prefix: string, index: number, text: string, startMs: number, endMs: number) => ({ cueId: `${prefix}:${index}`, sourceIndex: index,
    text, startMs, endMs, timingSource: 'start+duration' as const, timingIssue: null, raw: { content: text, from: startMs / 1000, to: endMs / 1000 } });
  const paired = pairBiliCues([
    cue('en', 0, 'These examples show us', 0, 2500),
    cue('en', 1, 'These examples show us that languages descended from Latin,', 2500, 5200),
    cue('en', 2, 'that languages descended from Latin, English and Swedish followed.', 5200, 9000),
  ], [
    cue('zh', 0, '这些例子告诉我们', 0, 3000),
    cue('zh', 1, '这些例子告诉我们很多语言来源于拉丁语', 3000, 6200),
    cue('zh', 2, '很多语言来源于拉丁语，英语和瑞典语也是如此。', 6200, 9000),
  ]);
  const phrases = biliPhrases(paired);
  assert.ok(phrases.length >= 2);
  assert.ok(phrases.every(phrase => phrase.endMs - phrase.startMs <= 6000));
  assert.ok(phrases.every(phrase => phrase.text.split('\n').length <= 2));
  const text = phrases.map(phrase => phrase.text).join('\n');
  assert.equal(text.match(/These examples show us/g)?.length, 1);
  assert.equal(text.match(/这些例子告诉我们/g)?.length, 1);
  assert.match(text, /English and Swedish followed\./);
  assert.match(text, /英语和瑞典语也是如此。/);
});
