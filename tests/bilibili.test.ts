import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { biliCues, biliMetadata, biliPhrases, biliVideo, bvidToAid, chooseBiliPair, chooseBiliTrack, isBiliTrack, pairBiliCues } from '../lib/bilibili.ts';
import { md5, signedPlayerUrl } from '../lib/bilibili-wbi.ts';
import type { RawCue } from '../lib/captions.ts';

test('Bilibili URL/page parsing and WBI MD5 match known platform inputs', () => {
  assert.deepEqual(biliVideo('https://www.bilibili.com/video/BV1GJ411x7h7?p=2'), { bvid: 'BV1GJ411x7h7', page: 2 });
  assert.deepEqual(biliVideo('https://www.bilibili.com/list/watchlater?oid=736809428&bvid=BV1YD4y1P7ou'), { bvid: 'BV1YD4y1P7ou', page: 1 });
  assert.equal(biliVideo('https://www.youtube.com/watch?v=abcdefghijk'), null);
  assert.deepEqual(biliVideo('https://www.bilibili.com/video/BV1GJ411x7h7?p=1.5'), { bvid: 'BV1GJ411x7h7', page: 1 });
  assert.deepEqual(biliVideo('https://www.bilibili.com/video/BV1GJ411x7h7?p=999999999'), { bvid: 'BV1GJ411x7h7', page: 1 });
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
  assert.equal(isBiliTrack({ ...valid, id: '' }), false);
  assert.equal(isBiliTrack({ ...valid, secondary: { id: 'x', name: '中文', language: 'zh-CN', url: 'https://evil.example/subtitle.json' } }), false);
  assert.equal(isBiliTrack({ ...valid, secondary: { id: valid.id, name: '中文', language: 'zh-CN', url: 'https://i0.hdslb.com/zh.json' } }), false);
  assert.equal(isBiliTrack({ ...valid, secondary: { id: 'zh', name: '中文', language: 'zh-CN', url: valid.url } }), false);
});

test('Bilibili WBI signing rejects invalid inputs and untrusted key images before player requests', async t => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (_input, options) => {
    calls++; assert.equal(options?.redirect, 'error'); assert.equal(options?.cache, 'no-store');
    return Response.json({ code: 0, data: { wbi_img: {
      img_url: 'https://evil.example/7cd084941338484aae1ad9425b84077c.png',
      sub_url: 'https://i0.hdslb.com/4932caff0ff746eab6f01bf08b70ac45.png',
    } } });
  };
  t.after(() => { globalThis.fetch = original; });
  await assert.rejects(signedPlayerUrl({ aid: 0, cid: 2, bvid: 'BV1GJ411x7h7' }), /播放参数异常/);
  assert.equal(calls, 0);
  await assert.rejects(signedPlayerUrl({ aid: 1, cid: 2, bvid: 'BV1GJ411x7h7' }), /密钥结构异常/);
  assert.equal(calls, 1);
});

test('Bilibili WBI nav response is bounded and must report a successful envelope', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => Response.json({ code: -101, message: 'not logged in' });
  await assert.rejects(signedPlayerUrl({ aid: 1, cid: 2, bvid: 'BV1GJ411x7h7' }), /接口返回异常/);
  globalThis.fetch = async () => new Response('x'.repeat(1_000_001));
  await assert.rejects(signedPlayerUrl({ aid: 1, cid: 2, bvid: 'BV1GJ411x7h7' }), /响应过大/);
});

test('Bilibili metadata never substitutes part one for a missing requested part', async t => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ code: 0, data: { aid: 1, cid: 2, title: 'Video',
    pages: [{ page: 1, cid: 2, part: 'Part one' }] } });
  t.after(() => { globalThis.fetch = original; });
  await assert.rejects(biliMetadata('BV1GJ411x7h7', 2), /没有第 2 P/);
});

test('Bilibili metadata rejects unsafe aid/cid values and invalid parameters', async t => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ code: 0, data: { aid: -1, cid: 1.5, title: 'Bad' } }); };
  t.after(() => { globalThis.fetch = original; });
  await assert.rejects(biliMetadata('invalid', 1), /参数异常/); assert.equal(calls, 0);
  await assert.rejects(biliMetadata('BV1GJ411x7h7', 1), /有效 aid\/cid/); assert.equal(calls, 1);
});

test('Bilibili subtitle downloads reject one pathological cue instead of exhausting the panel', async t => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ body: [{ from: 0, to: 1, content: 'x'.repeat(100_001) }] });
  t.after(() => { globalThis.fetch = original; });
  await assert.rejects(biliCues({ id: 'bili:test', name: 'Test', language: 'en', kind: 'manual',
    url: 'https://i0.hdslb.com/test.json' }), /文本异常过长/);
});

test('Bilibili subtitle downloads reject non-string website body content', async t => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ body: [{ from: 0, to: 1, content: { text: 'not supported' } }] });
  t.after(() => { globalThis.fetch = original; });
  await assert.rejects(biliCues({ id: 'bili:test', name: 'Test', language: 'en', kind: 'manual',
    url: 'https://i0.hdslb.com/test.json' }), /正文结构异常/);
});

test('Bilibili website bilingual lanes download concurrently', async t => {
  const original = globalThis.fetch;
  const releases = new Map<string, (response: Response) => void>();
  const calls: string[] = [];
  globalThis.fetch = async input => await new Promise<Response>(resolve => {
    const url = String(input); calls.push(url); releases.set(url, resolve);
  });
  t.after(() => { globalThis.fetch = original; });
  const pending = biliCues({ id: 'dual', name: '双语', language: 'en+zh', kind: 'manual', url: 'https://i0.hdslb.com/en.json',
    secondary: { id: 'zh', name: '中文', language: 'zh', url: 'https://i0.hdslb.com/zh.json' } });
  await new Promise(resolve => setImmediate(resolve));
  const callsBeforeAnyResponse = calls.length;
  for (const [url, release] of releases) release(Response.json({ body: [{ from: 0, to: 1, content: url.includes('en.json') ? 'Hello.' : '你好。' }] }));
  await new Promise(resolve => setImmediate(resolve));
  for (const [url, release] of releases) release(Response.json({ body: [{ from: 0, to: 1, content: url.includes('en.json') ? 'Hello.' : '你好。' }] }));
  const cues = await pending;
  assert.equal(callsBeforeAnyResponse, 2);
  assert.equal(cues[0].text, 'Hello.\n你好。');
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

test('Bilibili exposes separate English and Chinese lanes when the website provides both', () => {
  const tracks = [
    { id: 'en', name: 'English', language: 'en-US', kind: 'manual' as const, url: 'https://x/en.json' },
    { id: 'zh-cn', name: '中文（中国）', language: 'zh-CN', kind: 'manual' as const, url: 'https://x/zh-cn.json' },
    { id: 'zh', name: '中文（简体）', language: 'zh-Hans', kind: 'manual' as const, url: 'https://x/zh.json' },
  ];
  assert.deepEqual(chooseBiliPair(tracks), { primary: tracks[0], secondary: tracks[2] });
  const bilingual = { ...tracks[2], id: 'both', name: '中英双语' };
  assert.deepEqual(chooseBiliPair([...tracks, bilingual]), { primary: bilingual, secondary: undefined });
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

test('Bilibili bilingual click time follows the primary learning language when translations start earlier', () => {
  const cue = (cueId: string, text: string, startMs: number, endMs: number) => ({ cueId, sourceIndex: 0, text, startMs, endMs,
    timingSource: 'start+duration' as const, timingIssue: null, raw: { text } });
  const paired = pairBiliCues([cue('en:0', 'Start now.', 1_000, 3_000)], [cue('zh:0', '现在开始。', 500, 3_200)]);
  assert.deepEqual([paired[0].startMs, paired[0].endMs], [1_000, 3_200]);
});

test('Bilibili bilingual pairing never borrows a translation timestamp for untimed primary text', () => {
  const primary: RawCue = { cueId: 'en:bad', sourceIndex: 0, text: 'Untimed English.', startMs: null, endMs: null,
    timingSource: 'start+duration', timingIssue: 'bad', raw: {} };
  const secondary: RawCue = { cueId: 'zh:0', sourceIndex: 0, text: '有时间的翻译。', startMs: 1_000, endMs: 2_000,
    timingSource: 'start+duration', timingIssue: null, raw: {} };
  const [paired] = pairBiliCues([primary], [secondary]);
  assert.equal(paired.startMs, null); assert.match(paired.timingIssue ?? '', /主字幕/);
  assert.equal(biliPhrases([paired]).length, 0);
});

test('Bilibili rolling-caption cleanup is pure and resets after a real silent gap', () => {
  const paired: RawCue[] = [
    { cueId: 'dual:0', sourceIndex: 0, text: 'Repeat this.\n重复。', startMs: 0, endMs: 1_000,
      timingSource: 'start+duration', timingIssue: null, raw: { primary: [{ content: 'Repeat this.' }], secondary: [{ content: '重复。' }] } },
    { cueId: 'dual:1', sourceIndex: 1, text: 'Repeat this.\n重复。', startMs: 5_000, endMs: 6_000,
      timingSource: 'start+duration', timingIssue: null, raw: { primary: [{ content: 'Repeat this.' }], secondary: [{ content: '重复。' }] } },
  ];
  const before = structuredClone(paired);
  const phrases = biliPhrases(paired);
  assert.deepEqual(paired, before);
  assert.equal(phrases.map(item => item.text).join('\n').match(/Repeat this\./g)?.length, 2);
});

test('a website-provided bilingual cue is normalized to English above Chinese even when its source lines are reversed', () => {
  const cues: RawCue[] = [{ cueId: 'site:0', sourceIndex: 0, text: '同学们好。\nHello students.', startMs: 1_000, endMs: 3_000,
    timingSource: 'start+duration', timingIssue: null, raw: { content: '同学们好。\nHello students.' } }];
  const phrases = biliPhrases(cues);
  assert.equal(phrases[0].text, 'Hello students.\n同学们好。');
  assert.deepEqual(cues[0].text, '同学们好。\nHello students.');
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
