// Dev helper: opens the app in headless Chrome, prints console errors,
// saves a screenshot. Usage: node scripts/check.mjs [url] [screenshot.png] [js-to-run]
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
const shot = process.argv[3] || 'check.png';
const script = process.argv[4];

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
         '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errors = [];
page.on('console', (m) => { if (m.text().includes('GL Driver Message')) return; if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('requestfailed', (r) => errors.push('[requestfailed] ' + r.url()));
page.on('response', (r) => { if (r.status() >= 400) errors.push('[http ' + r.status() + '] ' + r.url()); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
if (script) console.log('eval:', JSON.stringify(await page.evaluate(script)));
await page.screenshot({ path: shot });
console.log(errors.length ? errors.join('\n') : 'no console errors/warnings');
await browser.close();
