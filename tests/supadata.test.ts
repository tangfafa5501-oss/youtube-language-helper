import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchSupadata, parseSupadata, testSupadata, transcriptUrl } from '../lib/supadata.ts';
import { trustedServiceSender } from '../lib/settings.ts';

const fixture = () => ({ lang: 'en', availableLangs: ['en', 'zh'], content: [
  { text: 'same\nline', offset: 2000, duration: 1000, lang: 'en' },
  { text: 'same\nline', offset: 2000, duration: 1000, lang: 'en' },
  { text: 'earlier', offset: 1000, duration: 0, lang: 'en' },
] });
test('Supadata request only sends canonical YouTube URL, native mode and timestamped data', () => {
  const url = new URL(transcriptUrl('X627czLUsGY', 'en'));
  assert.equal(url.origin, 'https://api.supadata.ai');
  assert.equal(url.searchParams.get('url'), 'https://www.youtube.com/watch?v=X627czLUsGY');
  assert.equal(url.searchParams.get('mode'), 'native'); assert.equal(url.searchParams.get('text'), 'false');
  assert.equal(url.searchParams.has('chunkSize'), false);
  assert.throws(() => transcriptUrl('https://evil.test', 'en'));
});
test('Supadata preserves provider order, duplicates, raw fields and abnormal timing', () => {
  const raw = fixture(); const parsed = parseSupadata(raw);
  assert.deepEqual(parsed.cues.map(c => c.raw), raw.content);
  assert.deepEqual(parsed.cues.map(c => c.startMs), [2000, 2000, 1000]);
  assert.equal(parsed.cues[0].text, 'same\nline'); assert.equal(parsed.cues[0].endMs, 3000);
  assert.ok(parsed.cues[2].timingIssue); assert.equal(parsed.cues[0].timingSource, 'offset+duration');
  assert.throws(() => parseSupadata({ ...raw, content: [] }));
});
test('Supadata errors are mapped without leaking server response or key, and never retried', async () => {
  for (const status of [401, 402, 403, 404, 429, 500, 206]) {
    let calls = 0;
    const fetcher = async () => { calls++; return new Response('secret-in-untrusted-response', { status }); };
    await assert.rejects(fetchSupadata('X627czLUsGY', 'en', 'fixture-key', new AbortController().signal, fetcher), error => {
      assert.equal((error as Error).message.includes('secret-in-untrusted-response'), false); return true;
    });
    assert.equal(calls, 1);
  }
});
test('async jobs poll a bounded job endpoint without creating another transcript request', async () => {
  const calls: string[] = [];
  const responses = [{ jobId: 'job-1' }, { status: 'active' }, { status: 'completed', ...fixture() }];
  const fetcher = async (url: any, options: any) => {
    calls.push(String(url)); assert.equal(options.headers['x-api-key'], 'fixture-key'); assert.equal(options.redirect, 'error');
    const body = responses.shift();
    return Response.json(body, { status: body && 'jobId' in body ? 202 : 200 });
  };
  const result = await fetchSupadata('X627czLUsGY', 'en', 'fixture-key', new AbortController().signal, fetcher, async () => {});
  assert.equal(result.count, 3); assert.equal(calls.length, 3);
  assert.deepEqual(calls.slice(1), ['https://api.supadata.ai/v1/transcript/job-1', 'https://api.supadata.ai/v1/transcript/job-1']);
});
test('digest job flow survives more than 20 polls and preserves subsecond timestamps and caption markers', async () => {
  let calls = 0;
  const raw = { lang: 'en', content: [{ text: '>> unchanged\n', offset: 1_200_125, duration: 375 }] };
  const result = await fetchSupadata('X627czLUsGY', 'en', 'fixture-key', new AbortController().signal, async () => {
    calls++;
    return calls === 1 ? Response.json({ jobId: 'long-job' }, { status: 202 })
      : Response.json(calls <= 26 ? { status: 'active' } : { status: 'completed', ...raw });
  }, async () => {});
  assert.equal(calls, 27);
  const cue = parseSupadata(result.data).cues[0];
  assert.equal(cue.startMs, 1_200_125); assert.equal(cue.endMs, 1_200_500); assert.equal(cue.text, '>> unchanged\n');
});
test('digest job flow stops at 60 polls without submitting another paid job', async () => {
  let creates = 0, polls = 0;
  await assert.rejects(fetchSupadata('X627czLUsGY', 'en', 'fixture-key', new AbortController().signal, async url => {
    if (new URL(String(url)).pathname === '/v1/transcript') {
      creates++; return Response.json({ jobId: 'slow-job' }, { status: 202 });
    }
    polls++; return Response.json({ status: 'active' });
  }, async () => {}), /60/);
  assert.equal(creates, 1); assert.equal(polls, 60);
});
test('account test does not send a video or expose account identity', async () => {
  const result = await testSupadata('fixture-key', new AbortController().signal, async (url: any) => {
    assert.equal(url, 'https://api.supadata.ai/v1/me');
    return Response.json({ plan: 'test', maxCredits: 100, usedCredits: 2, organizationId: 'private-account' });
  });
  assert.deepEqual(result, { plan: 'test', maxCredits: 100, usedCredits: 2 });
});
test('only exact own-extension settings/sidepanel senders can use the service', () => {
  assert.equal(trustedServiceSender({ id: 'own', url: 'chrome-extension://own/options.html' }, 'own', 'options'), true);
  for (const sender of [
    { id: 'own', url: 'https://www.youtube.com/watch?v=X627czLUsGY' },
    { id: 'other', url: 'chrome-extension://own/options.html' },
    { id: 'own', url: 'chrome-extension://own/options.html?spoof=1' },
  ]) assert.equal(trustedServiceSender(sender, 'own', 'options'), false);
});
