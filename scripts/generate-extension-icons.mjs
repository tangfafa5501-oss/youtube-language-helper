import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = await readFile(join(root, 'public/icon-source.svg'), 'utf8');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const size of [16, 32, 48, 96, 128]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}svg{display:block;width:100%;height:100%}</style>${source}`);
    await page.screenshot({ path: join(root, `public/icon-${size}.png`), omitBackground: true });
    await page.close();
  }
} finally {
  await browser.close();
}
