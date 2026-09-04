import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { repairSidebar, repairPlayback } from '../scripts/lib/doctor-repair.js';
import { checkCommitIndex } from '../scripts/lib/doctor-index.js';

const sidebar = readFileSync(new URL('../entrypoints/sidepanel/main.tsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const playback = readFileSync(new URL('../lib/playback-machine.ts', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const buttonId = sidebar.indexOf('id="btn-sentence-shadowing"');
const buttonStart = sidebar.lastIndexOf('<button', buttonId), buttonEnd = sidebar.indexOf('</button>', buttonId) + 9;

test('doctor keeps healthy source byte-identical and idempotent', () => {
  assert.equal(repairSidebar(sidebar).source, sidebar); assert.equal(repairSidebar(sidebar).fixes.length, 0);
  assert.equal(repairPlayback(playback).source, playback); assert.equal(repairPlayback(playback).fixes.length, 0);
  assert.equal(repairSidebar(sidebar.replaceAll('\n', '\r\n')).fixes.length, 0);
});
test('doctor restores a deleted button immediately before replay without touching microphone', () => {
  const missing = sidebar.slice(0, buttonStart) + sidebar.slice(buttonEnd);
  const repaired = repairSidebar(missing);
  assert.match(repaired.source, /id="btn-sentence-shadowing"/); assert.match(repaired.source, /onClick=\{toggleShadowing\}/);
  assert.equal(repairSidebar(repaired.source).fixes.length, 0);
  assert.ok(sidebar.includes('data-play-mode-control="practice"'));
  assert.equal(repaired.source.slice(repaired.source.indexOf('data-play-mode-control="practice"')), sidebar.slice(sidebar.indexOf('data-play-mode-control="practice"')));
});
test('doctor replaces alert handler instead of accepting matching words in a placeholder', () => {
  const broken = sidebar.slice(0, buttonStart) + '<button id="btn-sentence-shadowing" onClick={() => alert("逐句跟读")}>逐句跟读</button>' + sidebar.slice(buttonEnd);
  const repaired = repairSidebar(broken); assert.equal(repaired.fixes.length, 1); assert.doesNotMatch(repaired.source, /alert\(/);
  assert.match(repaired.source, /onClick=\{toggleShadowing\}/);
});
test('doctor restores missing and transient-only mode banners', () => {
  const start = sidebar.indexOf('<p className="echo-toast"'), end = sidebar.indexOf('</p>', start) + 4;
  for (const replacement of ['', '{playback ? <p className="echo-toast" role="status">{playback}</p> : null}']) {
    const result = repairSidebar(sidebar.slice(0, start) + replacement + sidebar.slice(end));
    assert.ok(result.fixes.includes('restored persistent mode banner')); assert.equal(repairSidebar(result.source).fixes.length, 0);
  }
});
test('doctor rejects renamed integration anchors and duplicate controls instead of rewriting broadly', () => {
  assert.throws(() => repairSidebar(sidebar.replace('const toggleShadowing =', 'const differentMode =')), /existing toggleShadowing/);
  assert.throws(() => repairSidebar(sidebar.slice(0, buttonEnd) + sidebar.slice(buttonStart, buttonEnd) + sidebar.slice(buttonEnd)), /Duplicate/);
});
test('doctor restores a missing boundary method, but leaves all other controller code intact', () => {
  const start = playback.indexOf('  enforceBoundary('), end = playback.indexOf('\n  clear(', start);
  const missing = playback.slice(0, start) + playback.slice(end);
  const restored = repairPlayback(missing);
  assert.equal(restored.fixes.length, 1); assert.match(restored.source, /video\.pause\(\)/);
  assert.equal(restored.source.slice(0, start), playback.slice(0, start));
  assert.equal(restored.source.slice(restored.source.indexOf('\n  clear(')), playback.slice(end));
  assert.equal(repairPlayback(restored.source).fixes.length, 0);
});
test('doctor does not accept pause text in a comment as an executable boundary brake', () => {
  const start = playback.indexOf('  enforceBoundary('), end = playback.indexOf('\n  clear(', start);
  const broken = playback.slice(0, start) + playback.slice(start, end).replace('video.pause();', '// video.pause();') + playback.slice(end);
  assert.equal(repairPlayback(broken).fixes.length, 1);
});
test('doctor restores removed boundary guard and timeupdate binding', () => {
  const broken = playback.replace('if (detectedMs < current.segment.endMs - leadMs) return;', '')
    .replace("video.addEventListener('timeupdate', () => this.enforceBoundary('media-event'), { signal });", '');
  assert.equal(repairPlayback(broken).fixes.length, 2);
  assert.equal(repairPlayback(repairPlayback(broken).source).fixes.length, 0);
});

test('doctor restores the timed next-sentence call instead of accepting indefinite waiting', () => {
  const broken = playback.replace("if (paused.mode === 'shadowing') this.scheduleShadowing(paused, owner);", '');
  const restored = repairPlayback(broken);
  assert.equal(restored.fixes.length, 1);
  assert.match(restored.source, /waitDurationMs = current.segment.endMs - current.segment.startMs/);
  assert.match(restored.source, /this.scheduleShadowing\(paused, owner\)/);
  assert.equal(repairPlayback(restored.source).fixes.length, 0);
});
test('pre-commit blocks unstaged and untracked sources without staging them automatically', t => {
  const root = mkdtempSync(join(tmpdir(), 'ylh-index-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git(['init']); writeFileSync(join(root, 'package.json'), '{}\n'); git(['add', 'package.json']);
  assert.equal(checkCommitIndex(root).ok, true);
  writeFileSync(join(root, 'package.json'), '{"changed":true}\n'); assert.equal(checkCommitIndex(root).ok, false);
  assert.equal(execFileSync('git', ['show', ':package.json'], { cwd: root, encoding: 'utf8' }), '{}\n');
  git(['add', 'package.json']); writeFileSync(join(root, 'wxt.config.ts'), 'export default {};\n');
  assert.equal(checkCommitIndex(root).ok, false);
});
