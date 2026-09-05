import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Fake credentials and API responses are confined to this isolated browser test.
const appKey = 'simulated-youdao-app', secret = 'simulated-youdao-secret-not-valid';
export function assessmentFixture(cdp, session, report) {
  const requests = []; let mode = 'success', held = null;
  const release = () => { const done = held; held = null; done?.(); };
  return { requests, setMode: value => { mode = value; }, release,
    async handle(params) {
      const { requestId, request } = params;
      const body = new URLSearchParams(request.postData), q = body.get('q');
      assert.ok(q, 'Assessment has actual converted audio'); assert.equal(body.get('appKey'), appKey);
      assert.equal(request.method, 'POST'); assert.equal(body.get('signType'), 'v2');
      assert.ok(Object.entries(request.headers).some(([name, value]) => name.toLowerCase() === 'content-type' && value.startsWith('application/x-www-form-urlencoded')));
      for (const [key, value] of Object.entries({ format: 'wav', rate: '16000', channel: '1', type: '1', langType: 'en' })) assert.equal(body.get(key), value);
      const input = q.slice(0, 10) + q.length + q.slice(-10);
      const sign = createHash('sha256').update(appKey + input + body.get('salt') + body.get('curtime') + secret).digest('hex');
      assert.equal(body.get('sign'), sign); assert.ok(!request.postData.includes(secret));
      const wav = Buffer.from(q, 'base64'); assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
      assert.equal(wav.readUInt16LE(20), 1); assert.equal(wav.readUInt16LE(22), 1); assert.equal(wav.readUInt32LE(24), 16000);
      assert.equal(wav.readUInt16LE(34), 16); assert.equal(wav.readUInt32LE(40), wav.length - 44);
      requests.push({ reference: body.get('text'), seconds: (wav.length - 44) / 32000, audioSha256: createHash('sha256').update(wav).digest('hex'),
        method: request.method, format: 'PCM WAV / 16kHz / 16bit / mono', signatureValid: true, at: new Date().toISOString() });
      report.assessmentRequests = requests;
      const currentMode = mode;
      if (currentMode === 'hold') await new Promise(resolve => { held = resolve; });
      if (currentMode === 'network') return cdp.send('Fetch.failRequest', { requestId, errorReason: 'ConnectionFailed' }, session);
      const response = currentMode === 'quota' ? { errorCode: '401' } : { errorCode: '0', overall: 84.5, pronunciation: 80, fluency: 88, integrity: 96,
        speed: 115, requestId: 'simulated-assessment-request', refText: body.get('text'), intonation: '',
        words: body.get('text').split(/\s+/).map((word, i) => ({ word, pronunciation: i === 0 ? 63 : 95,
          ...(i === 0 ? { IPA: 'həˈləʊ', phonemes: [{ phoneme: 'h', pronunciation: 48, judge: false, calibration: 'f', stress_ref: false, stress_detect: false }] } : { phonemes: [] }) })) };
      return cdp.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify(response)).toString('base64') }, session);
    } };
}

export async function verifyAssessment({ panel, page, platform, fixture, check, screenshot }) {
  const label = name => `${platform}: pronunciation ${name}`;
  const count = () => fixture.requests.length;
  const initialCount = count();
  check(label('page identity, nonblank UI and no framework error overlay'),
    /^chrome-extension:\/\/[^/]+\/sidepanel\.html$/.test(panel.url()) && await panel.title() === 'Video Language Helper'
    && await panel.locator('.echo-cue').count() > 0 && await panel.locator('vite-error-overlay, #webpack-dev-server-client-overlay').count() === 0);
  const readSelected = () => panel.evaluate(async () => {
    const id = document.querySelector('.practice-recordings')?.dataset.recordingId;
    const db = await new Promise((resolve, reject) => { const req = indexedDB.open('VideoLanguageHelperPractice'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const row = await new Promise((resolve, reject) => { const req = db.transaction('recordings').objectStore('recordings').get(id); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    db.close(); return { id, text: row.segment.text, assessment: row.assessment ?? null, size: row.audio.size, type: row.audio.type };
  });
  const settings = async () => { await panel.getByRole('button', { name: '更多选项', exact: true }).click(); await panel.getByRole('menuitem', { name: '设置', exact: true }).click(); };
  const close = async () => { await panel.getByRole('button', { name: '关闭发音评估', exact: true }).click(); await panel.locator('.assessment-dialog').waitFor({ state: 'detached' }); };
  await panel.locator('.echo-cue').first().click();
  await panel.locator('[data-assessment-trigger]').waitFor();
  await panel.locator('[data-assessment-trigger]').click();
  await panel.locator('[data-assessment-error]').filter({ hasText: '设置' }).waitFor();
  check(label('without credentials shows setup hint and sends no request'), count() === initialCount);
  await settings(); const region = panel.getByRole('region', { name: '有道发音评估设置' });
  await region.getByText('尚未配置。', { exact: true }).waitFor();
  check(label('settings rejects empty credentials'), await region.getByRole('button', { name: '保存有道配置' }).isDisabled());
  await region.getByLabel('应用 ID（App Key）').fill(appKey); await region.getByLabel('应用密钥（App Secret）').fill(secret);
  check(label('secret field is masked'), await region.getByLabel('应用密钥（App Secret）').getAttribute('type') === 'password');
  await region.getByRole('button', { name: '保存有道配置' }).click();
  await region.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  check(label('save clears fields without making a paid call'), await region.getByLabel('应用密钥（App Secret）').inputValue() === ''
    && await region.getByLabel('应用 ID（App Key）').inputValue() === '' && count() === initialCount);
  await screenshot(`assessment-settings-${platform}-simulated-test-browser.png`);
  await panel.getByRole('button', { name: '返回字幕' }).click();
  await panel.locator('[data-assessment-trigger]').waitFor();
  await panel.locator('[data-assessment-trigger]').hover();
  await panel.getByRole('tooltip').filter({ hasText: '评估发音 (V)' }).waitFor();
  check(label('sparkles button beside recording play exposes V hover help'), await panel.locator('[data-assessment-trigger]').evaluate(el => {
    const play = el.previousElementSibling, assessRect = el.getBoundingClientRect(), playRect = play?.getBoundingClientRect();
    return play?.classList.contains('practice-playback-toggle') && !!playRect
      && playRect.right <= assessRect.left && assessRect.left - playRect.right <= 12
      && playRect.top < assessRect.bottom && playRect.bottom > assessRect.top;
  }));
  await screenshot(`assessment-button-${platform}-simulated-test-browser.png`);
  await page.getByLabel('视频页面测试输入框').fill(''); await page.getByLabel('视频页面测试输入框').press('v');
  check(label('V stays text in page input'), await page.getByLabel('视频页面测试输入框').inputValue() === 'v' && count() === initialCount);
  const first = await readSelected(); fixture.setMode('hold');
  await page.locator('#movie_player').focus(); await page.keyboard.press('v');
  await panel.locator('[data-assessment-trigger][aria-busy="true"]').waitFor();
  for (let i = 0; i < 3; i++) await page.keyboard.press('v');
  // Wait on the fixture's actual background request, not a UI timing guess.
  for (let i = 0; i < 80 && count() === initialCount; i++) await page.waitForTimeout(50);
  check(label('page V bridge starts one background request despite repeat presses'), count() === initialCount + 1 && await panel.locator('[data-assessment-trigger]').isDisabled());
  fixture.release(); fixture.setMode('success');
  await panel.getByRole('dialog', { name: /发音评估/ }).waitFor();
  check(label('actual decoded MP3 is converted to signed mono PCM and reference is bound to that take'),
    first.type.includes('mp3') || first.type.includes('mpeg'));
  check(label('request reference belongs to selected recording'), fixture.requests.at(-1).reference === first.text);
  check(label('four scores and persisted result match simulated API without invented prosody'),
    await panel.locator('.assessment-scores > div').count() === 4 && (await readSelected()).assessment.overall === 84.5
    && !Object.hasOwn((await readSelected()).assessment, 'prosody'));
  await panel.locator('.assessment-words button').first().click();
  await panel.getByRole('region', { name: '音素详情' }).getByText('需练习，听起来像 /f/', { exact: true }).waitFor();
  check(label('word click shows exact phoneme diagnosis'));
  await screenshot(`assessment-result-${platform}-simulated-test-browser.png`);
  await panel.setViewportSize({ width: 320, height: 760 });
  await panel.waitForFunction(() => { const rect = document.querySelector('.assessment-dialog').getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight; });
  check(label('result fits 320px sidebar without horizontal overflow'), await panel.locator('.assessment-dialog').evaluate(el => el.scrollWidth <= el.clientWidth));
  await screenshot(`assessment-result-narrow-${platform}-simulated-test-browser.png`);
  await close(); await panel.setViewportSize({ width: 430, height: 900 });
  await page.keyboard.press('v'); await panel.locator('.assessment-dialog').waitFor();
  check(label('V opens cached result without another paid call'), count() === initialCount + 1);
  await close();
  // Create one additional real fake-microphone take to exercise switching within a sentence.
  await panel.getByRole('button', { name: '录音', exact: true }).click(); await panel.getByRole('button', { name: '停止录音', exact: true }).waitFor();
  await page.waitForTimeout(650); await panel.getByRole('button', { name: '停止录音', exact: true }).click();
  await panel.getByRole('button', { name: '录音', exact: true }).waitFor();
  await panel.waitForFunction(id => document.querySelector('.practice-recordings')?.dataset.recordingId !== id, first.id);
  const second = await readSelected(); fixture.setMode('quota');
  await panel.locator('[data-assessment-trigger]').click(); await panel.locator('[data-assessment-error]').filter({ hasText: '余额不足' }).waitFor();
  check(label('account error clears spinner and stores no fake score'), (await readSelected()).assessment === null
    && await panel.locator('[data-assessment-trigger]').isEnabled() && count() === initialCount + 2);
  fixture.setMode('hold'); await panel.locator('[data-assessment-trigger]').click();
  for (let i = 0; i < 80 && count() < initialCount + 3; i++) await page.waitForTimeout(50);
  check(label('explicit retry starts exactly one new request'), count() === initialCount + 3);
  await panel.getByRole('button', { name: '选择录音', exact: true }).click(); await panel.getByRole('button', { name: '录音 #3', exact: true }).click();
  fixture.release(); fixture.setMode('success');
  await panel.waitForFunction(() => document.querySelector('[data-assessment-trigger]')?.getAttribute('aria-busy') === 'false');
  check(label('late result cannot overwrite currently selected recording or open a stale dialog'),
    (await readSelected()).id === first.id && await panel.locator('.assessment-dialog').count() === 0);
  await panel.getByRole('button', { name: '选择录音', exact: true }).click(); await panel.getByRole('button', { name: '录音 #4', exact: true }).click();
  await panel.getByRole('button', { name: '查看发音评分', exact: true }).waitFor();
  check(label('switching takes loads that take’s saved result'), (await readSelected()).id === second.id && (await readSelected()).assessment.referenceText === second.text);
  await panel.getByRole('button', { name: '选择录音', exact: true }).click(); await panel.getByRole('button', { name: '删除录音 #4', exact: true }).click();
  await panel.waitForFunction(id => document.querySelector('.practice-recordings')?.dataset.recordingId === id, first.id);
  check(label('deleting assessed recording returns to prior score and leaves original audio unchanged'),
    (await readSelected()).size === first.size && (await readSelected()).assessment.overall === 84.5);
  await settings(); await region.getByRole('status').filter({ hasText: '已配置' }).waitFor();
  check(label('reopened settings never echo saved credentials'), await region.getByLabel('应用密钥（App Secret）').inputValue() === ''
    && !((await region.innerText()).includes(secret)));
  await region.getByRole('button', { name: '清除有道凭据' }).click(); await region.getByRole('status').filter({ hasText: '已清除' }).waitFor();
  await panel.getByRole('button', { name: '返回字幕' }).click(); await panel.getByRole('button', { name: '查看发音评分', exact: true }).click();
  check(label('persisted score remains readable after credentials are cleared'), count() === initialCount + 3);
  await close();
  await panel.locator('.echo-cue').nth(1).click(); await panel.locator('.echo-cue').first().click();
  await panel.getByRole('button', { name: '查看发音评分', exact: true }).waitFor();
  check(label('score survives exercise unmount/remount'), count() === initialCount + 3);
}
