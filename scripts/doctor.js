import { readFile, writeFile, mkdir, open, unlink, rename, readdir, stat } from 'node:fs/promises';
import { appendFileSync, existsSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import assert from 'node:assert/strict';
import { repairSidebar, repairPlayback } from './lib/doctor-repair.js';
import { checkCommitIndex } from './lib/doctor-index.js';

const root = fileURLToPath(new URL('../', import.meta.url)), artifacts = join(root, 'artifacts');
const runId = new Date().toISOString().replaceAll(/[:.]/g, '-');
const evidence = join(artifacts, 'doctor', runId), lockPath = join(artifacts, 'doctor.lock');
const preCommit = process.argv.includes('--pre-commit');
const sourceOnly = process.argv.includes('--repair-only');
const hash = text => createHash('sha256').update(text).digest('hex');
await mkdir(evidence, { recursive: true });
const logPath = join(evidence, 'doctor.log');
const log = message => { const line = `[doctor] ${message}\n`; process.stdout.write(line); appendFileSync(logPath, line); };
const report = { startedAt: new Date().toISOString(), root, environment: `${process.platform} / Node ${process.version}`,
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), preCommit,
  evidenceTier: 'static repair + source units + compiled extension in independent test browser', repairs: [], steps: [] };
let lock;
async function acquireLock() {
  try { return await open(lockPath, 'wx'); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const previous = JSON.parse(await readFile(lockPath, 'utf8'));
    assert.ok(Number.isInteger(previous.pid) && previous.pid > 0, 'Invalid doctor lock; refusing to delete an unknown file');
    let alive = true; try { process.kill(previous.pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; }
    assert.ok(!alive, `Doctor already running (PID ${previous.pid}); no parallel repairs/builds allowed`);
    await unlink(lockPath); return open(lockPath, 'wx');
  }
}
function run(name, command, args, quiet = false) {
  log(`RUN ${name}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', YLH_VERIFICATION_DIR: evidence } });
    let output = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 180_000);
    const consume = chunk => {
      const text = chunk.toString(); output += text;
      appendFileSync(join(evidence, `${name}.log`), text);
      if (!quiet) { process.stdout.write(text); appendFileSync(logPath, text); }
    };
    child.stdout.on('data', consume); child.stderr.on('data', consume);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer); report.steps.push({ name, exitCode: code, timedOut });
      if (quiet) for (const line of output.split(/\r?\n/).filter(line => /^(?:#|ℹ) (tests|pass|fail) /.test(line))) log(line);
      log(`${name} EXIT ${code}`);
      if (code === 0 && !timedOut) resolve(); else reject(new Error(`${name} failed (${timedOut ? 'timeout' : `exit ${code}`}); see ${name}.log`));
    });
  });
}
try {
  lock = await acquireLock(); await lock.writeFile(JSON.stringify({ pid: process.pid, runId }));
  log(`START ${runId}`); log(`HEAD ${report.head} (working-tree build)`);
  const plans = [];
  for (const [relative, repair] of [['entrypoints/sidepanel/main.tsx', repairSidebar], ['lib/playback-machine.ts', repairPlayback]]) {
    const path = join(root, relative), before = await readFile(path, 'utf8'), result = repair(before);
    assert.equal(repair(result.source).source, result.source, `Repair must be idempotent: ${relative}`);
    plans.push({ relative, path, before, after: result.source, fixes: result.fixes });
  }
  // Plan all repairs first; do not partially change files if a later source is ambiguous.
  for (const plan of plans) {
    assert.equal(await readFile(plan.path, 'utf8'), plan.before, `Concurrent edit detected: ${plan.relative}`);
    if (plan.before !== plan.after) {
      await writeFile(join(evidence, plan.relative.replaceAll('/', '_') + '.before'), plan.before);
      await writeFile(plan.path, plan.after);
      report.repairs.push({ path: plan.relative, fixes: plan.fixes, beforeHash: hash(plan.before), afterHash: hash(plan.after) });
      log(`REPAIRED ${plan.relative}: ${plan.fixes.join('; ')}`);
    } else log(`PASS ${plan.relative}: no repair needed`);
  }
  if (preCommit) {
    assert.equal(report.repairs.length, 0, 'Self-healing changed working-tree source; old staged code must not be committed. Review the repair and stage explicitly.');
    const index = checkCommitIndex(root); assert.ok(index.ok, index.reason);
    log('PASS commit index matches tested source');
  }
  if (!sourceOnly) {
    // Preserve any older success image as history before refreshing the latest proof.
    await rename(join(artifacts, 'verification_latest.png'), join(evidence, 'previous-verification.png')).catch(error => { if (error.code !== 'ENOENT') throw error; });
    const tests = (await readdir(join(root, 'tests'))).filter(name => name.endsWith('.test.ts')).sort().map(name => `tests/${name}`);
    await run('unit', process.execPath, ['--experimental-strip-types', '--test', '--test-reporter=tap', ...tests], true);
    const buildStarted = Date.now();
    const npmCli = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')]
      .find(path => path?.endsWith('.js') && existsSync(path));
    if (npmCli) await run('build', process.execPath, [npmCli, 'run', 'build']);
    else {
      assert.notEqual(process.platform, 'win32', 'npm CLI not found; launch doctor through npm run doctor');
      await run('build', 'npm', ['run', 'build']);
    }
    const htmlPath = join(root, '.output/chrome-mv3/sidepanel.html');
    assert.ok((await stat(htmlPath)).mtimeMs >= buildStarted - 2000, 'Build output timestamp was not refreshed');
    log(`PASS fresh build timestamp ${(await stat(htmlPath)).mtime.toISOString()}`);
    await run('typecheck', process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit']);
    await run('e2e', process.execPath, ['scripts/verify-extension.js']);
    const browser = JSON.parse(await readFile(join(evidence, 'browser-report.json'), 'utf8'));
    assert.equal(browser.passed, true); report.buildSha256 = browser.buildSha256; report.e2eChecks = browser.checks.length;
    assert.equal(browser.sourceSha256, hash(await readFile(join(root, 'entrypoints/sidepanel/main.tsx'))), 'Source changed during verification');
  }
  report.passed = true;
  log(sourceOnly ? 'SOURCE REPAIR ONLY PASSED (no build/browser claim)' : `SUCCESS: source + build + ${report.e2eChecks} extension checks`);
  if (!sourceOnly) log(`SCREENSHOT ${join(artifacts, 'verification_latest.png')}`);
} catch (error) {
  report.passed = false; report.error = error.stack; log(`FAIL: ${error.message}`); process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(join(evidence, 'doctor-report.json'), JSON.stringify(report, null, 2));
  log(`RAW_LOG ${logPath}`);
  if (lock) { await lock.close(); await unlink(lockPath); }
}
