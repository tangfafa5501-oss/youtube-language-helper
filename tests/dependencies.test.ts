import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const manifest = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const forbiddenIconPackage = /(?:^|node_modules\/)(?:lucide(?:-react)?|@fortawesome\/[^/]+)(?:$|\/)/;

test('runtime manifest and lockfile contain no full icon package', () => {
  for (const name of [...Object.keys(manifest.dependencies), ...Object.keys(lock.packages)]) {
    assert.equal(forbiddenIconPackage.test(name), false, name);
  }
  assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies);
});

test('UI uses only local licensed icon assets with decorative accessibility', () => {
  for (const directory of ['components/', 'entrypoints/']) {
    for (const path of readdirSync(new URL(directory, root), { recursive: true, encoding: 'utf8' })) {
      if (!path.endsWith('.tsx')) continue;
      assert.doesNotMatch(read(`${directory}${path.replaceAll('\\', '/')}`), /from\s+['"](?:lucide|@fortawesome)/);
    }
  }
  const icons = read('components/icons.tsx');
  assert.equal(icons.match(/<Svg>/g)?.length, 5);
  assert.match(icons, /<svg[^>]*aria-hidden="true"[^>]*focusable="false"/);
  assert.doesNotMatch(icons, /Glyph|ylh-icon-glyph/);
  assert.match(icons, /<span[^>]*aria-hidden="true"/);
  for (const name of ['mic', 'book-open', 'refresh-cw', 'audio-lines', 'ear', 'activity']) {
    assert.match(read(`public/icons/${name}.svg`), /<svg/);
  }
  assert.match(read('public/licenses/lucide.txt'), /ISC License/);
});

test('development dependencies are limited to the build toolchain and explicit extension verification', () => {
  assert.deepEqual(Object.keys(manifest.devDependencies).sort(), [
    '@types/react', '@types/react-dom', '@wxt-dev/module-react', 'playwright', 'typescript', 'wxt',
  ]);
  assert.equal(manifest.scripts.test, 'node --experimental-strip-types --test tests/*.test.ts');
});
