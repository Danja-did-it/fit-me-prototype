// Dev helper: opens the app in headless Chrome, prints console errors,
// saves a screenshot. Usage: node scripts/check.mjs [url] [screenshot.png] [js-to-run]
// Optional env: FRONT=photo.jpg SIDE=photo.jpg (fed into the file inputs),
//               MOBILE=1 (phone viewport), CAMERA=1 (clicks "Kamera starten" using Chrome's fake camera)
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
const shot = process.argv[3] || 'check.png';
const script = process.argv[4];

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
         '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
// MOBILE=1 -> phone-sized viewport with touch
const page = await browser.newPage(process.env.MOBILE
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  : { viewport: { width: 1000, height: 700 } });
const errors = [];
page.on('console', (m) => { if (m.text().includes('GL Driver Message')) return; if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('requestfailed', (r) => errors.push('[requestfailed] ' + r.url()));
page.on('response', (r) => { if (r.status() >= 400) errors.push('[http ' + r.status() + '] ' + r.url()); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
// feed test photos into the scan inputs and wait for the result
for (const [env, id] of [['FRONT', '#fileFront'], ['SIDE', '#fileSide']]) {
  if (!process.env[env]) continue;
  await page.evaluate(() => (document.getElementById('status').textContent = ''));
  await page.setInputFiles(id, process.env[env]);
  await page.waitForFunction(() => /erkannt|Keine Person|Fehler/.test(document.getElementById('status').textContent), null, { timeout: 60000 })
    .catch(() => console.log('TIMEOUT waiting for scan'));
  console.log(env, '->', await page.textContent('#status'));
}
if (process.env.CAMERA) {
  await page.click('#camBtn');
  await page.waitForTimeout(2000);
  console.log('camera ->', await page.evaluate(() => { const v = document.getElementById('video'); return v.videoWidth + 'x' + v.videoHeight; }));
}
if (script) console.log('eval:', JSON.stringify(await page.evaluate(script)));
await page.screenshot({ path: shot });
console.log(errors.length ? errors.join('\n') : 'no console errors/warnings');
await browser.close();
