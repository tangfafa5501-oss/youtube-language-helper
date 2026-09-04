import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assessmentLanguage, parseAssessment, requestAssessment, signYoudao, validateAssessmentWav, YOUDAO_ENDPOINT,
  type PronunciationAssessment } from '../lib/youdao.ts';
import { audioBase64, encodeAssessmentWav } from '../lib/assessment-audio.ts';
import { createAssessmentService } from '../lib/assessment-service.ts';
import { shortcutAction } from '../lib/shortcuts.ts';

// Deliberately simulated provider reply: no credentials, recording or score from a real account.
const mockYoudaoResponse = () => ({ errorCode: '0', overall: 84.5, pronunciation: 81, fluency: 90, integrity: 96, speed: 120,
  refText: 'untrusted response reference', intonation: 99, requestId: 'test-request',
  words: [{ word: 'hello', IPA: 'həˈləʊ', pronunciation: 81, phonemes: [
    { phoneme: 'h', pronunciation: 45, judge: false, calibration: 'f', stress_ref: false, stress_detect: true },
  ] }] });
const credentials = { appKey: 'test-app-id', appSecret: 'test-secret-not-a-real-key' };
const wav = () => audioBase64(encodeAssessmentWav([new Float32Array(1600).fill(.25)], 16000));

test('Youdao v2 signature covers the exact base64 length, salt and seconds (including short q)', async () => {
  for (const q of ['abc', '12345678901234567890', wav()]) {
    const input = q.length > 20 ? `${q.slice(0, 10)}${q.length}${q.slice(-10)}` : q;
    const expected = createHash('sha256').update(credentials.appKey + input + 'test-salt' + '1780000000' + credentials.appSecret).digest('hex');
    assert.equal(await signYoudao(q, credentials, 'test-salt', '1780000000'), expected);
  }
});
test('PCM WAV conversion mixes stereo, clips samples, preserves duration and rejects oversized/invalid buffers', () => {
  const bytes = encodeAssessmentWav([new Float32Array([-1, 1, .5, 2]), new Float32Array([-1, -1, .5, 2])], 16000);
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(24, true), 16000); assert.equal(view.getUint16(22, true), 1); assert.equal(view.getUint16(34, true), 16);
  assert.deepEqual([0, 1, 2, 3].map(i => view.getInt16(44 + i * 2, true)), [-32768, 0, 16384, 32767]);
  assert.equal(validateAssessmentWav(audioBase64(bytes)), 4 / 16000);
  for (const q of ['', 'data:audio/wav;base64,' + wav(), 'SUQzAAAA', wav().slice(0, -4), '%%%']) assert.throws(() => validateAssessmentWav(q));
  for (const [offset, value] of [[22, 2], [24, 8000], [34, 8]]) {
    const damaged = bytes.slice(); new DataView(damaged.buffer).setUint16(offset, value, true);
    assert.throws(() => validateAssessmentWav(audioBase64(damaged)));
  }
  assert.throws(() => encodeAssessmentWav([new Float32Array(16000 * 120 + 1)], 16000));
  assert.throws(() => encodeAssessmentWav([new Float32Array([NaN])], 16000));
  assert.throws(() => encodeAssessmentWav([new Float32Array(4)], 44100));
});
test('language selection respects caption metadata; unsupported languages are not silently graded as English', () => {
  assert.equal(assessmentLanguage('en-GB', 'hello'), 'en'); assert.equal(assessmentLanguage('ai-zh', '你好'), 'zh-CHS');
  assert.equal(assessmentLanguage(undefined, 'Hello, friends!'), 'en'); assert.equal(assessmentLanguage(undefined, '你好'), 'zh-CHS');
  assert.throws(() => assessmentLanguage('fr', 'bonjour')); assert.throws(() => assessmentLanguage(undefined, 'こんにちは'));
});
test('provider response preserves true phoneme diagnosis, own reference and zero scores; unused intonation is not a score', () => {
  const result = parseAssessment(mockYoudaoResponse(), 'hello', 'en');
  assert.equal(result.referenceText, 'hello'); assert.equal(result.overall, 84.5);
  assert.deepEqual(result.words[0]?.phonemes[0], { phoneme: 'h', score: 45, correct: false, heard: 'f', expectedStress: false, actualStress: true });
  assert.equal('intonation' in result, false); assert.equal('prosody' in result, false);
  assert.equal(parseAssessment({ ...mockYoudaoResponse(), overall: 0 }, 'hello', 'en').overall, 0);
  for (const reply of [{ errorCode: '401' }, { ...mockYoudaoResponse(), overall: 101 }, { ...mockYoudaoResponse(), fluency: undefined },
    { ...mockYoudaoResponse(), words: [null] }, {}]) assert.throws(() => parseAssessment(reply, 'hello', 'en'));
});
test('HTTP request sends URL-encoded WAV with v2 auth only to fixed HTTPS endpoint, no secret/header/redirect leakage', async () => {
  const q = wav(); let calls = 0;
  const result = await requestAssessment(q, 'hello & friends +', 'en', credentials, new AbortController().signal, async (url, init) => {
    calls++; assert.equal(url, YOUDAO_ENDPOINT); assert.equal(init?.method, 'POST'); assert.equal(init?.credentials, 'omit');
    assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store');
    const body = new URLSearchParams(String(init?.body)); assert.equal(body.get('q'), q); assert.equal(body.get('text'), 'hello & friends +');
    for (const [key, value] of Object.entries({ signType: 'v2', format: 'wav', rate: '16000', channel: '1', type: '1', langType: 'en' })) assert.equal(body.get(key), value);
    assert.equal(body.get('sign'), await signYoudao(q, credentials, body.get('salt')!, body.get('curtime')!));
    assert.equal(String(init?.body).includes(credentials.appSecret), false);
    return Response.json(mockYoudaoResponse());
  });
  assert.equal(result.overall, 84.5); assert.equal(calls, 1);
});
test('HTTP errors, service errors and malformed/oversized bodies fail instead of creating fake scores', async () => {
  for (const response of [new Response('bad', { status: 503 }), Response.json({ errorCode: '11011' }), new Response('not json'),
    new Response('x'.repeat(2_000_001))]) {
    await assert.rejects(requestAssessment(wav(), 'hello', 'en', credentials, new AbortController().signal, async () => response));
  }
});
function harness(options: { protected?: boolean; timeout?: number; response?: typeof fetch } = {}) {
  let stored: unknown = credentials, permitted = true, calls = 0;
  const rows = new Map<string, { segment: { text: string; language: string }; assessment?: PronunciationAssessment }>([
    ['take-one', { segment: { text: 'hello', language: 'en' } }], ['take-two', { segment: { text: 'second', language: 'en' } }],
  ]);
  const service = createAssessmentService({ extensionId: 'own', protectedStorage: Promise.resolve(options.protected !== false),
    permitted: async () => permitted, readCredentials: async () => stored, writeCredentials: async value => { stored = value; },
    getRecording: async id => rows.get(id), saveAssessment: async (id, value) => { const row = rows.get(id); if (!row) return false; row.assessment = value; return true; },
    fetcher: async (...args) => { calls++; return options.response ? options.response(...args) : Response.json(mockYoudaoResponse()); }, timeoutMs: options.timeout });
  const send = (type: string, payload: Record<string, unknown> = {}, sender = { id: 'own', url: 'chrome-extension://own/sidepanel.html' }) => service({ type, ...payload }, sender);
  return { send, rows, get calls() { return calls; }, get stored() { return stored; }, clear: () => { stored = null; }, deny: () => { permitted = false; } };
}
test('credentials restricted to trusted settings/panel; status never returns app ID or secret; blocked protection fails closed', async () => {
  const h = harness();
  for (const sender of [{ id: 'other', url: 'chrome-extension://own/sidepanel.html' }, { id: 'own', url: 'https://www.youtube.com/' },
    { id: 'own', url: 'chrome-extension://own/sidepanel.html?x=1' }]) assert.equal((await h.send('save', credentials, sender)).ok, false);
  assert.deepEqual(await h.send('status'), { ok: true, configured: true, permitted: true });
  assert.equal((await h.send('assess', { recordingId: 'take-one', audio: wav() }, { id: 'own', url: 'chrome-extension://own/options.html' })).ok, false);
  const blocked = harness({ protected: false }); assert.equal((await blocked.send('save', credentials)).ok, false);
  assert.equal((await blocked.send('assess', { recordingId: 'take-one', audio: wav() })).ok, false); assert.equal(blocked.calls, 0);
});
test('missing credentials/permission/recording fail before network; cached score works after credentials are removed', async () => {
  const h = harness(); const payload = { recordingId: 'take-one', audio: wav() };
  assert.equal((await h.send('assess', { recordingId: 'missing', audio: wav() })).ok, false);
  const reply = await h.send('assess', payload); assert.equal(reply.ok, true); assert.equal(h.calls, 1);
  await h.send('clear'); assert.equal(h.stored, null);
  assert.deepEqual((await h.send('assess', payload)).assessment, reply.assessment); assert.equal(h.calls, 1);
  assert.equal((await h.send('assess', { recordingId: 'take-two', audio: wav() })).ok, false); assert.equal(h.calls, 1);
  const noPermission = harness(); noPermission.deny(); assert.equal((await noPermission.send('assess', payload)).ok, false); assert.equal(noPermission.calls, 0);
});
test('duplicate concurrent requests share one paid call; a different take cannot receive its result', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const h = harness({ response: async () => { await gate; return Response.json(mockYoudaoResponse()); } });
  const payload = { recordingId: 'take-one', audio: wav() };
  const one = h.send('assess', payload), two = h.send('assess', payload);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal((await h.send('assess', { ...payload, recordingId: 'take-two' })).ok, false);
  release(); const results = await Promise.all([one, two]); assert.equal(h.calls, 1); assert.deepEqual(results[0], results[1]);
  assert.equal(h.rows.get('take-two')?.assessment, undefined);
  await h.send('assess', payload); assert.equal(h.calls, 1);
});
test('deleting a recording during assessment cannot resurrect it or save results to another take', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const h = harness({ response: async () => { await gate; return Response.json(mockYoudaoResponse()); } });
  const task = h.send('assess', { recordingId: 'take-one', audio: wav() });
  await new Promise(resolve => setTimeout(resolve, 10)); h.rows.delete('take-one'); release();
  assert.equal((await task).ok, false); assert.equal(h.rows.has('take-one'), false); assert.equal(h.rows.get('take-two')?.assessment, undefined);
});
test('timeout releases job, no automatic retry, no provider/network secret is echoed; credential clear cancels active jobs', async () => {
  const waitForAbort: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('internal credentials: ' + credentials.appSecret)), { once: true });
  });
  const h = harness({ timeout: 20, response: waitForAbort });
  const payload = { recordingId: 'take-one', audio: wav() };
  const reply = await h.send('assess', payload); assert.equal(reply.ok, false); assert.match(reply.error!, /超时/);
  assert.equal(JSON.stringify(reply).includes(credentials.appSecret), false); assert.equal(h.calls, 1); assert.equal(h.rows.get('take-one')?.assessment, undefined);
  await h.send('assess', payload); assert.equal(h.calls, 2);
  const pending = harness({ response: waitForAbort }), job = pending.send('assess', payload);
  await new Promise(resolve => setTimeout(resolve, 10)); await pending.send('clear'); assert.equal((await job).ok, false);
});
test('V maps to pronunciation assessment, but composing, editing, repeats and modifier shortcuts are preserved', () => {
  assert.equal(shortcutAction({ code: 'KeyV' }), 'assess-recording');
  for (const flag of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'repeat', 'isComposing', 'defaultPrevented']) assert.equal(shortcutAction({ code: 'KeyV', [flag]: true }), null);
  assert.equal(shortcutAction({ code: 'KeyV', target: { closest: () => ({}) } }), null);
});
