import { spawnSync } from 'node:child_process';

// Do not silently commit an old index after testing or repairing a different worktree.
export function checkCommitIndex(root) {
  const paths = ['entrypoints', 'components', 'lib', 'public', 'scripts', 'tests', 'package.json', 'package-lock.json', 'wxt.config.ts'];
  const diff = spawnSync('git', ['diff', '--quiet', '--', ...paths], { cwd: root, encoding: 'utf8' });
  if (diff.status !== 0) return { ok: false, reason: 'Unstaged source/config differs from the commit index. Commit blocked; doctor never stages files for you.' };
  const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '--', ...paths], { cwd: root, encoding: 'utf8' });
  if (untracked.status !== 0 || untracked.stdout.trim()) return { ok: false, reason: 'Untracked source/config is not in the commit index. Commit blocked.' };
  return { ok: true };
}
