import { chromium } from 'playwright';
import { readFile, writeFile, mkdir, mkdtemp, access, readdir, rm, copyFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve, dirname, basename, sep } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { connect } from './lib/cdp.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, '.output/chrome-mv3'), artifacts = join(root, 'artifacts');
const runId = new Date().toISOString().replaceAll(/[:.]/g, '-');
const evidence = process.env.YLH_VERIFICATION_DIR || join(artifacts, 'doctor', runId);
assert.ok(resolve(evidence).startsWith(resolve(artifacts) + sep), 'Evidence must stay inside project artifacts');
await mkdir(evidence, { recursive: true });
const hash = data => createHash('sha256').update(data).digest('hex');
const exists = async path => { try { await access(path); return true; } catch { return false; } };
const log = message => console.log(`[verify] ${message}`);
const report = { startedAt: new Date().toISOString(), head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  environment: `${process.platform} / Node ${process.version}`, evidenceTier: 'independent-test-browser / actual unpacked extension / simulated media and caption APIs',
  browserPath: 'Browser plugin not available; project Playwright', realNetworkApi: false, dailyBrowserTouched: false,
  microphoneSource: 'Chromium fake device in disposable test profile; no physical microphone',
  spaceKeyupModel: 'simulated YouTube page keyup toggle; real Chromium keyboard down/repeat/up events',
  checks: [], errors: [], warnings: [], runtimeHashes: [], requests: [], screenshots: [] };
// A failed standalone verify must not leave an older success looking current.
await rename(join(artifacts, 'verification_latest.png'), join(evidence, 'previous-standalone-verification.png'))
  .catch(error => { if (error.code !== 'ENOENT') throw error; });
await writeFile(join(artifacts, 'verification_latest.json'), JSON.stringify({ ...report, passed: false, status: 'running' }, null, 2));
log('Actual compiled extension; simulated media/caption APIs; independent browser, NOT installed-real.');
const check = (name, ok = true) => { assert.ok(ok, name); report.checks.push(name); log(`PASS ${name}`); };
async function outputHashes(path = '') {
  const entries = [];
  for (const entry of await readdir(join(output, path), { withFileTypes: true })) {
    const relative = path ? `${path}/${entry.name}` : entry.name;
    if (entry.isDirectory()) entries.push(...await outputHashes(relative));
    else entries.push([relative, hash(await readFile(join(output, relative)))]);
  }
  return entries.sort(([a], [b]) => a.localeCompare(b, 'en'));
}
const buildFiles = await outputHashes();
report.buildSha256 = hash(buildFiles.map(([path, sha]) => `${path} ${sha}`).join('\n'));
report.sourceSha256 = hash(await readFile(join(root, 'entrypoints/sidepanel/main.tsx')));
report.youtubeSourceSha256 = hash(await readFile(join(root, 'entrypoints/youtube.content.ts')));
const html = await readFile(join(output, 'sidepanel.html'), 'utf8');
const entry = html.match(/src="\/?(chunks\/sidepanel-[^"]+\.js)"/)?.[1];
assert.ok(entry, 'Compiled sidebar entry not found');
const code = await readFile(join(output, entry), 'utf8');
check('new bundle contains button and no placeholder', code.includes('btn-sentence-shadowing') && !code.includes('逐句跟读按钮已渲染'));
const bundled = chromium.executablePath();
const candidates = [process.env.YLH_CHROMIUM_PATH, bundled,
  process.platform === 'win32' ? join(process.env.ProgramFiles || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe') : undefined].filter(Boolean);
let executablePath;
for (const candidate of candidates) if (await exists(candidate)) { executablePath = candidate; break; }
assert.ok(executablePath, 'No Chromium executable found. Run npx playwright install chromium once or set YLH_CHROMIUM_PATH.');
report.executablePath = executablePath;
const profile = await mkdtemp(join(tmpdir(), 'ylh-verify-browser-'));
let context, cdp, panel, page;
// A native media clock, not a fake pause()/currentTime implementation.
const wav = Buffer.alloc(44 + 16_000 * 18 * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16_000, 24); wav.writeUInt32LE(32_000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
for (let i = 0; i < 16_000 * 18; i++) wav.writeInt16LE(Math.round(500 * Math.sin(2 * Math.PI * 220 * i / 16_000)), 44 + i * 2);
const media = `data:audio/wav;base64,${wav.toString('base64')}`;
const rows = [
  { from: 0, to: 3, content: 'Hello, lovely students, and welcome to your pronunciation training session.' },
  { from: 3, to: 5, content: 'Today, I am very excited to help you pronounce everyday words.' },
  { from: 5, to: 8, content: 'We practice one sentence at a time.' },
  { from: 8, to: 11, content: 'Each pause lasts as long as the sentence you just heard.' },
];
const track = { id: 1, is_ai: false, lan: 'en', lan_doc: 'English', subtitle_url: 'https://i0.hdslb.com/doctor-fixture.json' };
const fixture = url => url.includes('/api/timedtext') ? { events: rows.map(row => ({ tStartMs: row.from * 1000,
  dDurationMs: (row.to - row.from) * 1000, segs: [{ utf8: row.content }] })) }
  : url.includes('/x/web-interface/view') ? { code: 0, data: { aid: 1, cid: 2, title: 'Doctor simulated fixture', pages: [{ page: 1, cid: 2 }] } }
  : url.includes('/x/web-interface/nav') ? { code: 0, data: { wbi_img: {
    img_url: 'https://i0.hdslb.com/7cd084941338484aae1ad9425b84077c.png', sub_url: 'https://i0.hdslb.com/4932caff0ff746eab6f01bf08b70ac45.png' } } }
  : url.includes('/x/player/wbi/v2') ? { code: 0, data: { subtitle: { subtitles: [track] } } }
  : url.includes('/doctor-fixture.json') ? { body: rows } : null;
const testHtml = platform => `<!doctype html><html><head><title>${platform} doctor simulated fixture</title><link rel="icon" href="data:,"></head><body>
  <h1>Independent extension test — simulated captions and media</h1><div data-cid="2"></div>
  <div id="movie_player" class="bpx-player-video-wrap" tabindex="0"><video class="html5-main-video" controls preload="auto" src="${media}"></video>
  <button class="ytp-subtitles-button" aria-pressed="true">CC</button></div>
  ${platform === 'youtube' ? `<script>window.ytInitialPlayerResponse={videoDetails:{videoId:'abcdefghijk',title:'Doctor simulated fixture'},playabilityStatus:{status:'OK'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{baseUrl:'https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en',vssId:'.en',languageCode:'en',name:{simpleText:'English'}}]}}};
  document.getElementById('movie_player').getPlayerResponse=()=>window.ytInitialPlayerResponse;
  document.getElementById('movie_player').pauseVideo=()=>document.querySelector('video').pause();
  // Deliberate site-conflict simulation, not a copy of YouTube's implementation.
  window.__nativeSpaceKeyups=0;
  document.addEventListener('keyup',event=>{
    if(event.code!=='Space'||event.defaultPrevented)return;
    window.__nativeSpaceKeyups++;
    const video=document.querySelector('video');if(video.paused)void video.play();else video.pause();
  });</script>` : ''}</body></html>`;
async function waitTarget(name, predicate) {
  let targets = [];
  for (let i = 0; i < 80; i++) {
    targets = (await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }, { type: 'page' }, { type: 'service_worker' }] })).targetInfos;
    const found = targets.find(predicate);
    if (found) return found;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  report.missingTarget = { name, observed: targets };
  throw new Error(`Expected extension target was not created: ${name}`);
}
async function captureRuntimeHashes(extensionId) {
  const targets = (await cdp.send('Target.getTargets')).targetInfos.filter(t => t.type === 'page' || t.type === 'service_worker');
  for (const target of targets) {
    const session = (await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
    const scripts = [], off = cdp.on(event => {
      if (event.sessionId === session && event.method === 'Debugger.scriptParsed'
        && event.params.url.startsWith(`chrome-extension://${extensionId}/`)) scripts.push(event.params);
    });
    await cdp.send('Debugger.enable', {}, session);
    for (const script of scripts) {
      const relative = new URL(script.url).pathname.slice(1);
      const executed = (await cdp.send('Debugger.getScriptSource', { scriptId: script.scriptId }, session)).scriptSource;
      const disk = await readFile(join(output, relative), 'utf8');
      assert.equal(hash(executed), hash(disk), `Runtime mismatch: ${relative}`);
      report.runtimeHashes.push({ relative, sha256: hash(executed) });
    }
    off(); await cdp.send('Debugger.disable', {}, session); await cdp.send('Target.detachFromTarget', { sessionId: session });
  }
}
try {
  context = await chromium.launchPersistentContext(profile, { executablePath, headless: true, viewport: { width: 1200, height: 950 },
    // This fresh profile has no user extensions. Chrome's legacy whitelist flag
    // can disable the extension loaded through the official CDP loader.
    ignoreDefaultArgs: ['--disable-extensions'], args: [`--load-extension=${output}`,
      '--enable-unsafe-extension-debugging', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--autoplay-policy=no-user-gesture-required',
      '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  context.setDefaultTimeout(15_000);
  const portText = await readFile(join(profile, 'DevToolsActivePort'), 'utf8');
  const port = Number(portText.split(/\r?\n/)[0]); assert.ok(port > 0 && port < 65536);
  const endpoint = await fetch(`http://127.0.0.1:${port}/json/version`).then(response => response.json());
  cdp = await connect(endpoint.webSocketDebuggerUrl); report.browser = await cdp.send('Browser.getVersion');
  // Official CDP loader also supports Chrome versions that ignore --load-extension.
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: output }); report.extensionId = id;
  // Chromium treats extension URLs as opaque here; scope the permission to
  // this disposable browser context instead. Audio comes only from the fake device.
  await context.grantPermissions(['microphone']);
  report.loader = 'fresh --load-extension profile + Extensions.loadUnpacked confirmation';
  await context.route('https://www.bilibili.com/video/**', route => route.fulfill({ contentType: 'text/html', body: testHtml('bilibili') }));
  await context.route('https://www.youtube.com/watch**', route => route.fulfill({ contentType: 'text/html', body: testHtml('youtube') }));
  await context.route('https://api.bilibili.com/**', route => route.fulfill({ contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': 'https://www.bilibili.com', 'Access-Control-Allow-Credentials': 'true' }, body: JSON.stringify(fixture(route.request().url()) ?? { code: -1 }) }));
  await context.route('https://www.youtube.com/api/timedtext**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(fixture(route.request().url())) }));
  const worker = await waitTarget('background service worker', t => t.type === 'service_worker' && t.url === `chrome-extension://${id}/background.js`);
  check('fresh-profile extension background is running');
  const workerSession = (await cdp.send('Target.attachToTarget', { targetId: worker.targetId, flatten: true })).sessionId;
  cdp.on(event => {
    if (event.method !== 'Fetch.requestPaused' || event.sessionId !== workerSession) return;
    const payload = fixture(event.params.request.url); report.requests.push(event.params.request.url.split('?')[0]);
    void cdp.send(payload ? 'Fetch.fulfillRequest' : 'Fetch.failRequest', payload ? {
      requestId: event.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify(payload)).toString('base64') } : { requestId: event.params.requestId, errorReason: 'BlockedByClient' }, workerSession)
      .catch(error => report.errors.push(error.message));
  });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: 'https://api.bilibili.com/*' },
    { urlPattern: 'https://*.hdslb.com/*' }, { urlPattern: 'https://www.youtube.com/api/timedtext*' }] }, workerSession);
  page = context.pages()[0] ?? await context.newPage();
  await page.goto('https://www.bilibili.com/video/BV1GJ411x7h7/');
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  const tab = await waitTarget('fixture tab', t => t.type === 'tab' && t.url === page.url());
  await cdp.send('Extensions.triggerAction', { id, targetId: tab.targetId });
  await waitTarget('actual Chrome sidepanel', t => t.url === `chrome-extension://${id}/sidepanel.html`);
  const attached = await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl);
  panel = attached.contexts()[0].pages().find(p => p.url() === `chrome-extension://${id}/sidepanel.html`);
  assert.ok(panel, 'Actual Chrome sidepanel target must exist'); panel.setDefaultTimeout(15_000);
  panel.on('dialog', async dialog => { report.errors.push(`Unexpected dialog: ${dialog.message()}`); await dialog.dismiss(); });
  panel.on('pageerror', error => report.errors.push(error.message));
  panel.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); else if (message.type() === 'warning') report.warnings.push(message.text()); });
  for (const platform of ['bilibili', 'youtube']) {
    if (platform === 'youtube') { await page.goto('https://www.youtube.com/watch?v=abcdefghijk');
      await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2); await panel.reload(); }
    await panel.locator('.echo-list > li').first().waitFor(); await panel.setViewportSize({ width: 430, height: 900 });
    const button = panel.locator('#btn-sentence-shadowing'); await button.waitFor();
    const microphone = panel.getByRole('button', { name: '跟读模式', exact: true });
    await panel.evaluate(() => {
      window.__microphoneRequests = 0;
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (...args) => { window.__microphoneRequests++; return original(...args); };
    });
    check(`${platform}: actual extension, four subtitle rows and original button position`,
      await panel.locator('.echo-list > li').count() === 4 && await button.evaluate(el => el.previousElementSibling?.getAttribute('aria-label') === '下一句'
        && el.nextElementSibling?.getAttribute('aria-label') === '重新播放当前句'));
    check(`${platform}: continuous-mode banner`, (await panel.locator('.echo-toast').textContent()).includes('自动连续播放'));
    await page.locator('video').evaluate(video => {
      window.__shadowingTimeline = [];
      for (const type of ['play', 'pause']) video.addEventListener(type, () => {
        window.__shadowingTimeline.push({ type, wallMs: performance.now(), mediaSeconds: video.currentTime });
      });
    });
    await button.click(); await panel.locator('.echo-shell[data-play-mode="shadowing"]').waitFor();
    check(`${platform}: sentence-only shadowing has no recording panel or dictation control`,
      await panel.getByRole('region', { name: '跟读练习', exact: true }).count() === 0
      && await panel.getByRole('button', { name: '听写模式', exact: true }).count() === 0
      && await microphone.getAttribute('aria-pressed') === 'false');
    check(`${platform}: real click enables shadowing without alert`, await button.getAttribute('aria-pressed') === 'true'
      && (await button.innerText()) === '逐句跟读' && (await panel.locator('.echo-toast').textContent()).includes('逐句跟读已开启'));
    report[`${platform}Cycles`] = [];
    // No clicks, key presses or media-clock writes during these two cycles.
    for (const [index, row] of rows.slice(0, 2).entries()) {
      await page.waitForFunction(end => { const v = document.querySelector('video'); return v.paused && Math.abs(v.currentTime - end) < .02; }, row.to);
      check(`${platform}: sentence ${index + 1} pauses at its own end`);
      await page.waitForTimeout((row.to - row.from) * 500);
      check(`${platform}: sentence ${index + 1} stays paused for the practice interval`,
        await page.locator('video').evaluate((v, end) => v.paused && Math.abs(v.currentTime - end) < .02, row.to));
      await page.waitForFunction(start => window.__shadowingTimeline.some(event => event.type === 'play'
        && Math.abs(event.mediaSeconds - start) < .2), rows[index + 1].from);
      const events = await page.evaluate(() => window.__shadowingTimeline);
      const pause = events.find(event => event.type === 'pause' && Math.abs(event.mediaSeconds - row.to) < .02);
      const next = events.find(event => event.type === 'play' && event.wallMs > pause.wallMs
        && Math.abs(event.mediaSeconds - rows[index + 1].from) < .2);
      const expectedWaitMs = (row.to - row.from) * 1000, actualWaitMs = next.wallMs - pause.wallMs;
      report[`${platform}Cycles`].push({ sentence: index + 1, expectedWaitMs, actualWaitMs, pause, next });
      check(`${platform}: sentence ${index + 1} automatically advances after ${expectedWaitMs}ms (observed ${actualWaitMs.toFixed(1)}ms)`,
        actualWaitMs >= expectedWaitMs - 80 && actualWaitMs <= expectedWaitMs + 500);
      check(`${platform}: automatic next retains shadowing mode`, await button.getAttribute('aria-pressed') === 'true');
    }
    report[`${platform}Timeline`] = await page.evaluate(() => window.__shadowingTimeline);
    check(`${platform}: two sentence cycles never request a microphone`, await panel.evaluate(() => window.__microphoneRequests) === 0);
    await panel.locator('.echo-cue.selected').filter({ hasText: rows[2].content }).waitFor();
    check(`${platform}: sidebar selection follows the third sentence without user input`);
    await panel.getByRole('button', { name: '暂停', exact: true }).waitFor();
    await panel.locator('.echo-shell').evaluate(el => el.scrollIntoView({ block: 'start' }));
    const name = `shadowing-${platform}-simulated-test-browser.png`;
    await panel.screenshot({ path: join(evidence, name) }); report.screenshots.push(name);
    await captureRuntimeHashes(id);
    await page.waitForFunction(() => { const v = document.querySelector('video'); return v.paused && Math.abs(v.currentTime - 8) < .02; });
    await panel.getByRole('button', { name: '播放', exact: true }).click();
    await panel.locator('.echo-shell[data-play-mode="auto"]').waitFor();
    await page.waitForFunction(() => document.querySelector('video').currentTime > 8.3);
    check(`${platform}: footer play cancels shadowing and resumes continuous playback`, await button.getAttribute('aria-pressed') === 'false');
    await page.locator('#movie_player').focus();
    check(`${platform}: keyboard focus is on the page player`, await page.locator('#movie_player').evaluate(el => document.activeElement === el));
    report[`${platform}SpaceCycles`] = [];
    const mediaState = () => page.locator('video').evaluate(v => ({ paused: v.paused, time: v.currentTime,
      wallMs: performance.now(), nativeSpaceKeyups: window.__nativeSpaceKeyups ?? 0 }));
    for (let cycle = 1; cycle <= 2; cycle++) {
      await page.keyboard.down('Space'); await page.waitForFunction(() => document.querySelector('video').paused);
      const down = await mediaState();
      for (let repeat = 0; repeat < 3; repeat++) await page.keyboard.down('Space');
      await page.waitForTimeout(150);
      check(`${platform}: Space cycle ${cycle} long hold does not repeat the toggle`, (await mediaState()).paused);
      await page.keyboard.up('Space'); await page.waitForTimeout(350);
      const released = await mediaState();
      check(`${platform}: Space cycle ${cycle} stays paused after release`, released.paused && Math.abs(released.time - down.time) < .02);
      await panel.getByRole('button', { name: '播放', exact: true }).waitFor();
      if (cycle === 1) {
        const releaseScreenshot = `space-release-${platform}-simulated-test-browser.png`;
        await panel.screenshot({ path: join(evidence, releaseScreenshot) }); report.screenshots.push(releaseScreenshot);
      }
      await page.keyboard.down('Space'); await page.keyboard.up('Space');
      await page.waitForFunction(() => !document.querySelector('video').paused);
      await page.waitForTimeout(150);
      const resumed = await mediaState();
      check(`${platform}: Space cycle ${cycle} next press/release resumes and stays playing`, !resumed.paused && resumed.time > released.time);
      report[`${platform}SpaceCycles`].push({ cycle, down, released, resumed });
    }
    if (platform === 'youtube') check('youtube: no consumed Space release reaches the simulated native toggle',
      await page.evaluate(() => window.__nativeSpaceKeyups) === 0);
    check(`${platform}: Space keeps continuous mode and does not reactivate shadowing`, await button.getAttribute('aria-pressed') === 'false');
    await page.keyboard.press('e'); await panel.locator('.echo-shell[data-play-mode="shadowing"]').waitFor();
    check(`${platform}: page E independently enables shadowing through the bridge`, await button.getAttribute('aria-pressed') === 'true');
    await panel.keyboard.press('e'); await panel.locator('.echo-shell[data-play-mode="auto"]').waitFor();
    check(`${platform}: panel E independently disables shadowing`, await button.getAttribute('aria-pressed') === 'false');
    await button.click(); await panel.locator('.echo-shell[data-play-mode="shadowing"]').waitFor();
    await button.click(); await panel.locator('.echo-shell[data-play-mode="auto"]').waitFor();
    check(`${platform}: second button click restores continuous mode`, (await panel.locator('.echo-toast').textContent()).includes('自动连续播放'));

    await microphone.click(); await panel.locator('.echo-shell[data-play-mode="practice"]').waitFor();
    await panel.getByRole('region', { name: '跟读练习', exact: true }).waitFor();
    check(`${platform}: microphone opens separate recording practice, not sentence shadowing`,
      await button.getAttribute('aria-pressed') === 'false' && await microphone.getAttribute('aria-pressed') === 'true');
    await panel.locator('.echo-cue').first().click();
    await page.waitForFunction(() => { const v = document.querySelector('video'); return v.paused && Math.abs(v.currentTime - 3) < .02; });
    await page.waitForTimeout(3_100);
    check(`${platform}: recording practice stays on its sentence without automatic next`,
      await page.locator('video').evaluate(v => v.paused && Math.abs(v.currentTime - 3) < .02));
    await page.locator('h1').click(); await page.keyboard.press('r');
    await panel.getByRole('button', { name: '停止录音', exact: true }).waitFor();
    check(`${platform}: R starts recording only in microphone mode using a synthetic device`);
    await page.waitForTimeout(1_100); await page.keyboard.press('r');
    const audio = panel.getByLabel('录音回放', { exact: true }); await audio.waitFor();
    await audio.evaluate(element => new Promise(resolve => {
      if (element.readyState >= 1) resolve(); else element.addEventListener('loadedmetadata', resolve, { once: true });
    }));
    check(`${platform}: recording is saved as playable audio`, await audio.evaluate(element => element.duration > 0 && !element.error));
    await page.keyboard.press('p');
    await panel.getByRole('img', { name: /^音高曲线/ }).waitFor();
    check(`${platform}: existing pitch chart still renders in recording practice`);
    const practiceScreenshot = `recording-${platform}-simulated-test-browser.png`;
    await panel.screenshot({ path: join(evidence, practiceScreenshot) }); report.screenshots.push(practiceScreenshot);
    await page.keyboard.press('h'); await panel.getByRole('textbox', { name: '听写输入' }).waitFor();
    check(`${platform}: H remains available only within recording practice`);
    await button.click(); await panel.locator('.echo-shell[data-play-mode="shadowing"]').waitFor();
    await panel.getByRole('region', { name: '跟读练习', exact: true }).waitFor({ state: 'detached' });
    const requests = await panel.evaluate(() => window.__microphoneRequests);
    await page.locator('h1').click(); await page.keyboard.press('r'); await page.keyboard.press('h'); await page.keyboard.press('p');
    check(`${platform}: switching back closes recording and recording keys do not activate it`,
      await microphone.getAttribute('aria-pressed') === 'false' && await panel.evaluate(() => window.__microphoneRequests) === requests
      && await panel.getByRole('region', { name: '跟读练习', exact: true }).count() === 0);
    await button.click(); await panel.locator('.echo-shell[data-play-mode="auto"]').waitFor();
  }
  check('executed sidebar, background and both content scripts match compiled hashes',
    report.runtimeHashes.some(r => r.relative === entry) && ['background.js', 'content-scripts/youtube.js', 'content-scripts/bilibili.js']
      .every(path => report.runtimeHashes.some(r => r.relative === path)));
  check('no application errors or alert placeholders', report.errors.length === 0);
  check('build files unchanged during browser verification', JSON.stringify(buildFiles) === JSON.stringify(await outputHashes()));
  report.passed = true; report.finishedAt = new Date().toISOString();
  await copyFile(join(evidence, 'shadowing-youtube-simulated-test-browser.png'), join(artifacts, 'verification_latest.png'));
  await writeFile(join(artifacts, 'verification_latest.json'), JSON.stringify(report, null, 2));
  log(`PASS ${report.checks.length}/${report.checks.length}; warnings=${report.warnings.length}`);
  log(`SCREENSHOT ${join(artifacts, 'verification_latest.png')}`);
  log(`BUILD_SHA256 ${report.buildSha256}`);
} catch (error) {
  report.passed = false; report.failure = error.stack; report.finishedAt = new Date().toISOString();
  if (page) report.failureMedia = await page.locator('video').evaluate(v => ({ time: v.currentTime, paused: v.paused,
    timeline: window.__shadowingTimeline })).catch(() => null);
  if (panel) { await panel.screenshot({ path: join(evidence, 'failure-simulated-test-browser.png') }).catch(() => {});
    await writeFile(join(evidence, 'failure-dom.txt'), await panel.locator('body').innerText().catch(() => 'unavailable')); }
  await writeFile(join(artifacts, 'verification_latest.json'), JSON.stringify(report, null, 2));
  console.error(`[verify] FAIL ${error.message}`); process.exitCode = 1;
} finally {
  await writeFile(join(evidence, 'browser-report.json'), JSON.stringify(report, null, 2));
  cdp?.close(); await context?.close();
  // Only remove the fresh, script-owned profile, never an existing user profile.
  if (dirname(resolve(profile)) === resolve(tmpdir()) && basename(profile).startsWith('ylh-verify-browser-'))
    await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(error => log(`Temporary-profile cleanup warning: ${error.message}`));
}
