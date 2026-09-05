import { chromium } from 'playwright';
import { readFile, writeFile, mkdir, mkdtemp, access, readdir, rm, copyFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve, dirname, basename, sep } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { connect } from './lib/cdp.js';
import { assessmentFixture, verifyAssessment } from './lib/verify-assessment.js';

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
  microphoneSource: 'Generated continuous-tone WAV through Chromium file-backed fake microphone; no physical microphone',
  spaceKeyupModel: 'simulated YouTube page keyup toggle; real Chromium keyboard down/repeat/up events',
  pitchSource: 'generated variable-frequency/volume WAV with real silence; native playback and real browser audio analysis',
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
let tonePhase = 0;
for (let i = 0; i < 16_000 * 18; i++) {
  const time = i / 16_000, silence = time % 1.5 > 1.05;
  tonePhase += 2 * Math.PI * (180 + 65 * Math.sin(time * 3)) / 16_000;
  const volume = silence ? 0 : 6000 * (.35 + .65 * Math.sin(time * 2) ** 2);
  wav.writeInt16LE(Math.round(volume * Math.sin(tonePhase)), 44 + i * 2);
}
const media = `data:audio/wav;base64,${wav.toString('base64')}`;
// Chromium's default fake microphone beeps intermittently. A recording may contain
// amplitude but no sustained pitch. Use a deterministic voiced input for this test,
// while the separate original-video fixture above still exercises real silence.
const microphoneWav = Buffer.from(wav); let microphonePhase = 0;
for (let i = 0; i < 16_000 * 18; i++) {
  const time = i / 16000; microphonePhase += 2 * Math.PI * (210 + 45 * Math.sin(time * 2.7)) / 16000;
  microphoneWav.writeInt16LE(Math.round(7000 * Math.sin(microphonePhase)), 44 + i * 2);
}
const microphoneFile = join(evidence, 'microphone-continuous-tone-simulated.wav');
await writeFile(microphoneFile, microphoneWav);
report.microphoneFixtureSha256 = hash(microphoneWav);
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
const testHtml = platform => `<!doctype html><html><head><meta charset="utf-8"><title>${platform} doctor simulated fixture</title><link rel="icon" href="data:,"></head><body>
  <h1>Independent extension test — simulated captions and media</h1><div data-cid="2"></div>
  <input aria-label="视频页面测试输入框"><script>
  window.__nativeFEvents=0;
  for(const type of ['keydown','keypress','keyup']) document.addEventListener(type,event=>{
    if(event.code==='KeyF'&&!event.defaultPrevented&&event.target.tagName!=='INPUT')window.__nativeFEvents++;
  });</script>
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
async function assertSmartFollow(name) {
  await panel.waitForFunction(() => {
    const selected = [...document.querySelectorAll('.echo-cue.selected')];
    if (!selected.length) return false;
    const contentTop = document.querySelector('.echo-toolbar').getBoundingClientRect().height + document.querySelector('.echo-toast').getBoundingClientRect().height;
    const footerTop = document.querySelector('.echo-player').getBoundingClientRect().top;
    const usableTop = contentTop + 24, usableBottom = footerTop - 24;
    const first = selected[0].getBoundingClientRect(), last = selected.at(-1).getBoundingClientRect();
    const blockHeight = last.bottom - first.top, available = Math.max(1, usableBottom - usableTop);
    const rowIndex = Number(selected[0].dataset.rowIndex ?? 0);
    const keepNearTop = selected.length === 1 && rowIndex < 2;
    const expectedTop = keepNearTop || blockHeight >= available ? usableTop : usableTop + (available - blockHeight) / 2;
    return Math.abs(first.top - expectedTop) <= 4;
  }, undefined, { timeout: 4000 });
  const geometry = await panel.evaluate(() => {
    const selected = [...document.querySelectorAll('.echo-cue.selected')];
    const contentTop = document.querySelector('.echo-toolbar').getBoundingClientRect().height + document.querySelector('.echo-toast').getBoundingClientRect().height;
    const footerTop = document.querySelector('.echo-player').getBoundingClientRect().top;
    const first = selected[0].getBoundingClientRect(), last = selected.at(-1).getBoundingClientRect();
    return { rowIndices: selected.map(el => el.dataset.rowIndex), viewport: [innerWidth, innerHeight], contentTop, footerTop,
      selectedTop: first.top, selectedBottom: last.bottom, selectedCenter: (first.top + last.bottom) / 2,
      usableCenter: (contentTop + 24 + footerTop - 24) / 2,
      previousBottom: selected[0].closest('li').previousElementSibling?.getBoundingClientRect().bottom ?? null, scrollY };
  });
  (report.topFollow ??= []).push({ name, ...geometry }); check(name);
}
async function screenshot(name) {
  const geometry = () => ({ scrollY, width: innerWidth, height: innerHeight,
    card: document.querySelector('.practice-card')?.getBoundingClientRect().toJSON(),
    chart: document.querySelector('.practice-chart')?.getBoundingClientRect().toJSON() });
  const before = await panel.evaluate(geometry);
  await panel.screenshot({ path: join(evidence, name) }); report.screenshots.push(name);
  (report.screenshotGeometry ??= []).push({ name, before, after: await panel.evaluate(geometry) });
}
try {
  context = await chromium.launchPersistentContext(profile, { executablePath, headless: true, viewport: { width: 1200, height: 950 },
    // This fresh profile has no user extensions. Chrome's legacy whitelist flag
    // can disable the extension loaded through the official CDP loader.
    ignoreDefaultArgs: ['--disable-extensions'], args: [`--load-extension=${output}`,
      '--enable-unsafe-extension-debugging', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--autoplay-policy=no-user-gesture-required',
      '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${microphoneFile}`] });
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
  const youdaoFixture = assessmentFixture(cdp, workerSession, report);
  cdp.on(event => {
    if (event.method !== 'Fetch.requestPaused' || event.sessionId !== workerSession) return;
    if (event.params.request.url.startsWith('https://openapi.youdao.com/')) {
      void youdaoFixture.handle(event.params).catch(error => report.errors.push(error.message)); return;
    }
    const payload = fixture(event.params.request.url); report.requests.push(event.params.request.url.split('?')[0]);
    void cdp.send(payload ? 'Fetch.fulfillRequest' : 'Fetch.failRequest', payload ? {
      requestId: event.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify(payload)).toString('base64') } : { requestId: event.params.requestId, errorReason: 'BlockedByClient' }, workerSession)
      .catch(error => report.errors.push(error.message));
  });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: 'https://api.bilibili.com/*' },
    { urlPattern: 'https://*.hdslb.com/*' }, { urlPattern: 'https://www.youtube.com/api/timedtext*' }, { urlPattern: 'https://openapi.youdao.com/*' }] }, workerSession);
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
    if (platform === 'bilibili') {
      const welcome = panel.locator('.ylh-tour-welcome'); await welcome.waitFor();
      check('bilibili: first loaded transcript opens the localized guided tour',
        (await welcome.textContent()).includes('欢迎使用 Video Language Helper') && (await welcome.textContent()).includes('第 1 步，共 9'));
      await screenshot('onboarding-welcome-bilibili-simulated-test-browser.png');
      await panel.getByRole('button', { name: '跳过引导', exact: true }).click(); await welcome.waitFor({ state: 'detached' });
      await panel.waitForFunction(async () => {
        const value = (await chrome.storage.local.get('ylh-guided-tours-v1'))['ylh-guided-tours-v1']; return value?.welcome === true;
      });
      check('bilibili: closing onboarding persists completion without blocking controls');
    } else {
      await panel.waitForTimeout(1400);
      check('youtube: completed welcome tour does not reopen after panel reload', await panel.locator('.ylh-tour-welcome').count() === 0);
    }
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
    if (platform === 'bilibili') {
      const shadowingTour = panel.locator('.ylh-tour-shadowing'); await shadowingTour.waitFor();
      check('bilibili: first E-mode activation opens a separate shadowing tour', (await shadowingTour.textContent()).includes('逐句跟读已开启'));
      await panel.getByRole('button', { name: '跳过引导', exact: true }).click(); await shadowingTour.waitFor({ state: 'detached' });
    }
    check(`${platform}: sentence-only shadowing has no recording panel or dictation control`,
      await panel.getByRole('region', { name: '跟读练习', exact: true }).count() === 0
      && await panel.getByRole('button', { name: '听写模式', exact: true }).count() === 0
      && await microphone.getAttribute('aria-pressed') === 'false');
    const shadowingButtonState = await button.evaluate(element => ({
      label: element.getAttribute('aria-label'),
      pressed: element.getAttribute('aria-pressed'),
      shortcut: element.querySelector('kbd')?.textContent?.trim(),
      text: element.textContent?.replace(/\s+/g, '').trim(),
    }));
    check(`${platform}: real click enables shadowing without alert`, shadowingButtonState.pressed === 'true'
      && shadowingButtonState.label === '切换逐句跟读' && shadowingButtonState.shortcut === 'E'
      && shadowingButtonState.text === '逐句跟读E' && (await panel.locator('.echo-toast').textContent()).includes('逐句跟读已开启'));
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
    await assertSmartFollow(`${platform}: automatically highlighted third sentence is centered with surrounding context`);
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
    report[`${platform}SpacePreflight`] = await panel.locator('.echo-shell').evaluate(element => ({
      playMode: element.getAttribute('data-play-mode'),
      playing: element.getAttribute('data-playing'),
      tourActive: element.getAttribute('data-tour-active'),
      driverPopoverCount: document.querySelectorAll('.driver-popover').length,
    }));
    check(`${platform}: completed guided tour releases keyboard controls`,
      report[`${platform}SpacePreflight`].tourActive === 'false'
      && report[`${platform}SpacePreflight`].driverPopoverCount === 0);
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

    await microphone.hover();
    await panel.getByRole('tooltip').filter({ hasText: '开启跟读模式' }).waitFor();
    check(`${platform}: microphone hover shows function and F without a native title`,
      await microphone.getAttribute('aria-keyshortcuts') === 'F' && await microphone.getAttribute('title') === null
      && (await panel.getByRole('tooltip').filter({ hasText: '开启跟读模式' }).textContent()).includes('(F)'));
    await page.locator('#movie_player').focus();
    await page.keyboard.down('f'); await panel.locator('.echo-shell[data-play-mode="practice"]').waitFor();
    await page.keyboard.down('f'); await page.keyboard.down('f'); await page.keyboard.up('f');
    check(`${platform}: page F enters practice once; repeat/release do not reach site fullscreen`,
      await microphone.getAttribute('aria-pressed') === 'true' && await page.evaluate(() => window.__nativeFEvents) === 0);
    await panel.keyboard.press('f'); await panel.locator('.echo-shell[data-play-mode="auto"]').waitFor();
    check(`${platform}: panel F exits practice independently of E`);
    await page.getByRole('textbox', { name: '视频页面测试输入框' }).fill('');
    await page.getByRole('textbox', { name: '视频页面测试输入框' }).press('f');
    check(`${platform}: page text input keeps F as text`, await page.getByRole('textbox').inputValue() === 'f'
      && await microphone.getAttribute('aria-pressed') === 'false');
    await microphone.click(); await panel.locator('.echo-shell[data-play-mode="practice"]').waitFor();
    await panel.getByRole('region', { name: '跟读练习', exact: true }).waitFor();
    if (platform === 'bilibili') {
      const practiceTour = panel.locator('.ylh-tour-practice'); await practiceTour.waitFor();
      check('bilibili: first F-mode activation opens a separate microphone-practice tour', (await practiceTour.textContent()).includes('麦克风跟读练习已开启'));
      await panel.getByRole('button', { name: '跳过引导', exact: true }).click(); await practiceTour.waitFor({ state: 'detached' });
    }
    check(`${platform}: microphone opens separate recording practice, not sentence shadowing`,
      await button.getAttribute('aria-pressed') === 'false' && await microphone.getAttribute('aria-pressed') === 'true');
    await panel.locator('.echo-cue').first().click();
    await assertSmartFollow(`${platform}: first sentence keeps a compact top safe area`);
    await page.waitForFunction(() => { const v = document.querySelector('video'); return v.paused && Math.abs(v.currentTime - 3) < .02; });
    await page.waitForTimeout(3_100);
    check(`${platform}: recording practice stays on its sentence without automatic next`,
      await page.locator('video').evaluate(v => v.paused && Math.abs(v.currentTime - 3) < .02));
    await page.locator('h1').click(); await page.keyboard.press('r');
    await panel.getByRole('button', { name: '停止录音', exact: true }).waitFor();
    check(`${platform}: R starts recording only in microphone mode using a synthetic device`);
    await page.waitForTimeout(1_100); await page.keyboard.press('r');
    const audio = panel.getByLabel('录音回放', { exact: true }); await audio.waitFor({ state: 'attached' });
    await audio.evaluate(element => new Promise(resolve => {
      if (element.readyState >= 1) resolve(); else element.addEventListener('loadedmetadata', resolve, { once: true });
    }));
    check(`${platform}: recording is saved as playable audio`, await audio.evaluate(element => element.duration > 0 && !element.error));
    for (const durationMs of [1_400, 1_700]) {
      await page.keyboard.press('r'); await panel.getByRole('button', { name: '停止录音', exact: true }).waitFor();
      await page.waitForTimeout(durationMs); await page.keyboard.press('r');
      await panel.getByRole('button', { name: '录音', exact: true }).waitFor();
      await panel.getByRole('button', { name: '录音', exact: true }).isEnabled();
      await panel.getByRole('button', { name: '选择录音', exact: true }).click();
      await panel.getByRole('button', { name: `录音 #${durationMs === 1_400 ? 2 : 3}`, exact: true }).waitFor();
      await panel.keyboard.press('Escape');
    }
    check(`${platform}: custom player removes native download/speed and duplicate recording history`,
      await audio.getAttribute('controls') === null && await panel.locator('.practice-recordings details').count() === 0);
    await page.keyboard.press('p');
    await panel.getByRole('img', { name: /^音高曲线/ }).waitFor();
    check(`${platform}: existing pitch chart still renders in recording practice`);
    await panel.locator('.practice-amplitude-reference .recharts-area-area').waitFor();
    await panel.waitForFunction(() => !!document.querySelector('.practice-pitch-reference .recharts-line-curve')?.getAttribute('d'));
    check(`${platform}: volume area is filled and pitch is an unfilled line with speech gaps`,
      (await panel.locator('.practice-amplitude-reference .recharts-area-area').getAttribute('fill')).startsWith('url(')
      && await panel.locator('.practice-pitch-reference .recharts-line-curve').getAttribute('fill') === 'none'
      && (await panel.locator('.practice-pitch-reference .recharts-line-curve').getAttribute('d') ?? '').split('M').length > 2
      && await panel.locator('.practice-progress .recharts-area-area').count() === 0);
    await panel.getByRole('button', { name: '显示音量强度', exact: true }).click();
    check(`${platform}: volume toggle hides only amplitude shading`, await panel.locator('.practice-amplitude-reference').count() === 0
      && await panel.locator('.practice-pitch-reference').count() > 0);
    await panel.getByRole('button', { name: '显示音量强度', exact: true }).click();
    await panel.getByRole('button', { name: '显示原声曲线', exact: true }).click();
    check(`${platform}: source toggle hides original pitch and volume together`, await panel.locator('.practice-pitch-reference').count() === 0
      && await panel.locator('.practice-amplitude-reference').count() === 0);
    await panel.getByRole('button', { name: '显示原声曲线', exact: true }).click();
    const selectedRecordings = [];
    for (const number of [1, 2, 3]) {
      await panel.getByRole('button', { name: '选择录音', exact: true }).click();
      check(`${platform}: numbered menu exposes all three recordings`, await panel.locator('.practice-recording-choice').count() === 3);
      await panel.getByRole('button', { name: `录音 #${number}`, exact: true }).click();
      await panel.waitForFunction(() => document.querySelector('.practice-pitch-recording .recharts-line-curve')?.getAttribute('d'));
      const selection = await panel.evaluate(async () => {
        const container = document.querySelector('.practice-recordings'), player = container.querySelector('audio');
        const db = await new Promise((resolve, reject) => { const req = indexedDB.open('VideoLanguageHelperPractice'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
        const row = await new Promise((resolve, reject) => { const req = db.transaction('recordings').objectStore('recordings').get(container.dataset.recordingId); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
        db.close();
        const digest = async blob => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(n => n.toString(16).padStart(2, '0')).join('');
        return { id: row.id, take: row.take, storedHash: await digest(row.audio), playingHash: await digest(await (await fetch(player.src)).blob()),
          paused: player.paused, time: player.currentTime, rate: player.playbackRate, curve: document.querySelector('.practice-pitch-recording .recharts-line-curve').getAttribute('d') };
      });
      selectedRecordings.push(selection);
      check(`${platform}: choosing recording #${number} selects its exact stored audio and resets without autoplay`,
        selection.take === number && selection.storedHash === selection.playingHash && selection.paused && selection.time === 0 && selection.rate === 1);
      await panel.getByRole('button', { name: '播放录音', exact: true }).click();
      await panel.waitForFunction(() => document.querySelector('.practice-recordings audio').currentTime > .1);
      check(`${platform}: recording #${number} plays at normal speed`, await audio.evaluate(el => !el.paused && el.playbackRate === 1));
    }
    (report.recordingSelections ??= {})[platform] = selectedRecordings;
    check(`${platform}: switching takes updates both recording audio and orange contour`,
      new Set(selectedRecordings.map(row => row.playingHash)).size === 3 && new Set(selectedRecordings.map(row => row.curve)).size === 3);
    await panel.getByRole('button', { name: '暂停录音回放', exact: true }).click();
    await panel.getByRole('slider', { name: '录音播放进度' }).fill('0.5');
    check(`${platform}: recording progress seeks the native audio`, await audio.evaluate(el => Math.abs(el.currentTime - .5) < .05));
    await assertSmartFollow(`${platform}: recording changes keep the highlight safely aligned`);
    await panel.getByRole('button', { name: '选择录音', exact: true }).click();
    await screenshot(`recording-menu-${platform}-simulated-test-browser.png`);
    await panel.setViewportSize({ width: 320, height: 760 });
    await assertSmartFollow(`${platform}: narrow recording view retains the highlight breathing room`);
    const narrowFits = () => {
      const boxes = [...document.querySelector('.practice-playback-row').children].map(el => el.getBoundingClientRect());
      const menu = document.querySelector('.practice-recordings-menu').getBoundingClientRect();
      return menu.left >= 0 && menu.right <= innerWidth && menu.bottom <= innerHeight
        && boxes.every(box => box.left >= 0 && box.right <= innerWidth)
        && boxes.every((box, i) => boxes.slice(i + 1).every(other => box.right <= other.left + 1));
    };
    await panel.waitForFunction(narrowFits);
    check(`${platform}: custom recording controls and open menu fit a narrow sidebar`, await panel.evaluate(narrowFits));
    await screenshot(`recording-menu-narrow-${platform}-simulated-test-browser.png`);
    await panel.setViewportSize({ width: 430, height: 900 });
    await panel.getByRole('button', { name: '删除录音 #2', exact: true }).click();
    await panel.getByRole('button', { name: '录音 #2', exact: true }).waitFor({ state: 'detached' });
    check(`${platform}: deleting a different recording preserves the selected take and stable numbers`,
      await panel.getByRole('button', { name: '录音 #3', exact: true }).getAttribute('aria-pressed') === 'true'
      && await panel.locator('.practice-recording-choice').count() === 2);
    await panel.getByRole('button', { name: '录音 #1', exact: true }).click();
    await panel.getByRole('button', { name: '选择录音', exact: true }).click();
    await panel.getByRole('button', { name: '删除录音 #1', exact: true }).click();
    await panel.waitForFunction(() => document.querySelector('.practice-recordings audio')?.currentTime === 0);
    await panel.getByRole('button', { name: '选择录音', exact: true }).click();
    check(`${platform}: deleting the selected take falls back to the remaining recording without autoplay`,
      await panel.getByRole('button', { name: '录音 #3', exact: true }).getAttribute('aria-pressed') === 'true'
      && await audio.evaluate(el => el.paused && el.currentTime === 0));
    await panel.keyboard.press('Escape');
    // Like a user inspecting the exercise, scroll its card into view after
    // the top-follow assertion. Do not hide an off-screen chart in the evidence.
    await panel.mouse.move(200, 400); await panel.mouse.wheel(0, 300);
    // The compositor applies wheel deltas asynchronously. Wait for it before
    // positioning the card, otherwise a pending wheel can undo the capture frame.
    await panel.waitForTimeout(200);
    await panel.locator('.practice-card').evaluate(el => {
      const rect = el.getBoundingClientRect();
      const top = document.querySelector('.echo-toast').getBoundingClientRect().bottom;
      const bottom = document.querySelector('.echo-player').getBoundingClientRect().top;
      scrollBy({ top: (rect.top + rect.bottom - top - bottom) / 2, behavior: 'instant' });
    });
    await panel.waitForFunction(() => {
      const card = document.querySelector('.practice-card').getBoundingClientRect();
      return card.top >= document.querySelector('.echo-toast').getBoundingClientRect().bottom
        && card.bottom <= document.querySelector('.echo-player').getBoundingClientRect().top;
    });
    const help = panel.getByRole('button', { name: '如何读懂音高图表', exact: true });
    await help.hover();
    const helpBubble = panel.getByRole('tooltip').filter({ hasText: '如何读懂图表' }); await helpBubble.waitFor();
    check(`${platform}: chart hover has the reference explanation, high contrast and viewport collision safety`,
      (await helpBubble.innerText()).includes('底部阴影区域表示音量强度，空白处代表停顿')
      && await helpBubble.evaluate(el => {
        const style = getComputedStyle(el), bounds = el.getBoundingClientRect();
        return style.backgroundColor === 'rgb(23, 32, 43)' && style.color === 'rgb(255, 255, 255)'
          && bounds.left >= 8 && bounds.right <= innerWidth - 8 && bounds.top >= 8 && bounds.bottom <= innerHeight - 8;
      }));
    check(`${platform}: complete pitch card and recording controls are visible for screenshot review`, await panel.locator('.practice-card').evaluate(el => {
      const card = el.getBoundingClientRect();
      return card.top >= document.querySelector('.echo-toast').getBoundingClientRect().bottom
        && card.bottom <= document.querySelector('.echo-player').getBoundingClientRect().top;
    }));
    await screenshot(`pitch-help-${platform}-simulated-test-browser.png`);
    await panel.keyboard.press('Escape'); await helpBubble.waitFor({ state: 'detached' });
    await help.focus(); await helpBubble.waitFor();
    check(`${platform}: keyboard focus opens help and Escape dismisses without toggling the chart`);
    await panel.keyboard.press('Escape'); await helpBubble.waitFor({ state: 'detached' });
    await microphone.hover();
    await panel.getByRole('tooltip').filter({ hasText: '跟读模式已开启' }).waitFor();
    await screenshot(`microphone-help-${platform}-simulated-test-browser.png`);
    check(`${platform}: active microphone hint states pause, S replay and F close`,
      (await panel.getByRole('tooltip').filter({ hasText: '跟读模式已开启' }).innerText()).includes('按 S 重播；F 关闭'));
    const practiceScreenshot = `recording-${platform}-simulated-test-browser.png`;
    await panel.screenshot({ path: join(evidence, practiceScreenshot) }); report.screenshots.push(practiceScreenshot);
    await page.keyboard.press('h'); await panel.getByRole('textbox', { name: '听写输入' }).waitFor();
    check(`${platform}: H remains available only within recording practice`);
    const dictationInput = panel.getByRole('textbox', { name: '听写输入' });
    await dictationInput.fill(''); await dictationInput.press('f');
    check(`${platform}: dictation input keeps F as text without closing practice`, await dictationInput.inputValue() === 'f'
      && await microphone.getAttribute('aria-pressed') === 'true');
    await page.locator('#movie_player').focus(); await page.keyboard.press('h');
    // The previous test only sampled the first sentence. Cover a real seek before capture.
    await panel.locator('.echo-cue').nth(2).click();
    await page.waitForFunction(() => { const v = document.querySelector('video'); return v.paused && Math.abs(v.currentTime - 8) < .02; });
    await panel.getByRole('button', { name: '录音', exact: true }).click();
    await panel.getByRole('button', { name: '停止录音', exact: true }).waitFor();
    await page.waitForTimeout(1_100); await panel.getByRole('button', { name: '停止录音', exact: true }).click();
    await panel.getByRole('button', { name: '录音', exact: true }).waitFor();
    await page.locator('video').evaluate(video => {
      window.__captureEvents = [];
      for (const type of ['seeking', 'seeked', 'play', 'pause', 'emptied']) video.addEventListener(type, () => window.__captureEvents.push({ type, time: video.currentTime, seeking: video.seeking, wallMs: performance.now() }));
    });
    await panel.getByRole('button', { name: '音高曲线', exact: true }).click();
    await panel.locator('.practice-pitch-reference .recharts-line-curve').waitFor();
    check(`${platform}: nonzero segment captures original audio after seeking without self-cancellation`);
    (report.captureEvents ??= {})[platform] = await page.evaluate(() => window.__captureEvents);
    // Invalidate just this session's cached original by leaving/reentering another segment.
    await panel.locator('.echo-cue').nth(1).click();
    await page.waitForFunction(() => { const v = document.querySelector('video'); return v.paused && Math.abs(v.currentTime - 5) < .02; });
    await panel.getByRole('button', { name: '录音', exact: true }).click();
    await panel.getByRole('button', { name: '停止录音', exact: true }).waitFor();
    await page.waitForTimeout(1_100); await panel.getByRole('button', { name: '停止录音', exact: true }).click();
    await panel.getByRole('button', { name: '录音', exact: true }).waitFor();
    await panel.getByRole('button', { name: '音高曲线', exact: true }).click();
    await panel.getByText('正在播放片段并采集原声…', { exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('video').paused && document.querySelector('video').currentTime > 3.1);
    await page.locator('video').evaluate(v => { v.currentTime = 12; });
    await panel.getByText('原声采集已取消', { exact: false }).waitFor();
    // SVG horizontal pitch lines have zero geometric height but a visible stroke.
    await panel.locator('.practice-pitch-recording .recharts-line-curve').waitFor({ state: 'attached' });
    await panel.locator('.practice-chart').waitFor();
    await panel.waitForFunction(() => !!document.querySelector('.practice-pitch-recording .recharts-line-curve')?.getAttribute('d'));
    check(`${platform}: manual seek cancels original capture but keeps the selected recording curve and playback`,
      await panel.getByRole('button', { name: '播放录音', exact: true }).isEnabled()
      && await page.locator('video').evaluate(v => v.paused && v.currentTime === 12));
    (report.captureCancellations ??= {})[platform] = { message: await panel.locator('.practice-pitch-notice').innerText(),
      events: await page.evaluate(() => window.__captureEvents),
      recordingCurve: await panel.locator('.practice-pitch-recording .recharts-line-curve').getAttribute('d') };
    await screenshot(`recording-fallback-${platform}-simulated-test-browser.png`);
    await panel.getByRole('button', { name: '重试原声', exact: true }).click();
    await panel.locator('.practice-pitch-reference .recharts-line-curve').waitFor();
    check(`${platform}: retry restores original alongside the existing recording curve`, await panel.locator('.practice-pitch-recording .recharts-line-curve').count() === 1);
    await panel.locator('.echo-cue').first().click();
    await panel.getByRole('button', { name: '选择录音', exact: true }).click();
    check(`${platform}: saved recording and number survive leaving and reopening its sentence`,
      await panel.getByRole('button', { name: '录音 #3', exact: true }).getAttribute('aria-pressed') === 'true'
      && await panel.locator('.practice-recording-choice').count() === 1);
    await panel.keyboard.press('Escape');
    await panel.locator('.echo-cue').last().click(); await assertSmartFollow(`${platform}: last sentence centers with trailing scroll space`);
    await panel.getByRole('button', { name: '向前扩展片段', exact: true }).click();
    await assertSmartFollow(`${platform}: multi-sentence practice range centers as one visible block`);
    await panel.getByRole('button', { name: '收缩片段开头', exact: true }).click();
    await assertSmartFollow(`${platform}: contracted practice range re-centers as one block`);
    await panel.setViewportSize({ width: 320, height: 760 });
    await assertSmartFollow(`${platform}: narrow-sidebar wrapping preserves safe smart alignment`);
    const narrowFooterGeometry = await panel.locator('.echo-player').evaluate(footer => [...footer.querySelectorAll('button')].map(button => ({
      name: button.getAttribute('aria-label'), box: button.getBoundingClientRect().toJSON(),
      children: [...button.children].map(child => ({ tag: child.tagName, text: child.textContent?.trim(), box: child.getBoundingClientRect().toJSON() }))
        .filter(item => item.box.width > 0 && item.box.height > 0),
    })));
    (report.narrowFooterGeometry ??= {})[platform] = narrowFooterGeometry;
    check(`${platform}: narrow footer controls do not overlap or leave the viewport`, narrowFooterGeometry.every(button => {
      const box = button.box;
      return box.left >= 0 && box.right <= 320 && box.top >= 0 && box.bottom <= 760
        && button.children.every(child => child.box.left >= box.left - 1 && child.box.right <= box.right + 1
          && child.box.top >= box.top - 1 && child.box.bottom <= box.bottom + 1);
    }) && narrowFooterGeometry.every((button, i) => narrowFooterGeometry.slice(i + 1).every(other =>
      button.box.right <= other.box.left + 1 || other.box.right <= button.box.left + 1
      || button.box.bottom <= other.box.top + 1 || other.box.bottom <= button.box.top + 1)));
    await microphone.hover();
    await screenshot(`narrow-top-follow-${platform}-simulated-test-browser.png`);
    await panel.setViewportSize({ width: 430, height: 900 });
    await assertSmartFollow(`${platform}: restored sidebar size preserves smart alignment`);
    await panel.mouse.wheel(0, -120); await panel.waitForTimeout(200);
    const manualScroll = await panel.evaluate(() => scrollY); await panel.waitForTimeout(350);
    check(`${platform}: media updates do not fight manual scrolling`, Math.abs(await panel.evaluate(() => scrollY) - manualScroll) < 2);
    await verifyAssessment({ panel, page, platform, fixture: youdaoFixture, check, screenshot });
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
  await captureRuntimeHashes(id);
  await copyFile(join(evidence, 'assessment-result-youtube-simulated-test-browser.png'), join(artifacts, 'verification_latest.png'));
  await writeFile(join(artifacts, 'verification_latest.json'), JSON.stringify(report, null, 2));
  log(`PASS ${report.checks.length}/${report.checks.length}; warnings=${report.warnings.length}`);
  log(`SCREENSHOT ${join(artifacts, 'verification_latest.png')}`);
  log(`BUILD_SHA256 ${report.buildSha256}`);
} catch (error) {
  report.passed = false; report.failure = error.stack; report.finishedAt = new Date().toISOString();
  if (page) report.failureMedia = await page.locator('video').evaluate(v => ({ time: v.currentTime, paused: v.paused,
    timeline: window.__shadowingTimeline, captureEvents: window.__captureEvents })).catch(() => null);
  if (page) await writeFile(join(evidence, 'failure-page.html'), await page.content().catch(() => 'unavailable'));
  if (panel) { await panel.screenshot({ path: join(evidence, 'failure-simulated-test-browser.png') }).catch(() => {});
    await writeFile(join(evidence, 'failure-panel.html'), await panel.content().catch(() => 'unavailable'));
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
