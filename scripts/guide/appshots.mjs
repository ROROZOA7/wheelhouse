// Screenshots of the made-up Lumen app (demo/site/index.html) that the demo crew "took" as
// evidence. build-demo.mjs copies them into each task's screenshots folder.
// Usage: node appshots.mjs <out dir>
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchOptions } from './chrome.mjs';

const OUT = path.resolve(process.argv[2]);
const SITE = pathToFileURL(path.join(import.meta.dirname, 'demo', 'site', 'index.html')).href;
// task -> [file, the site's ?view=]
const SHOTS = {
	'lumen-share-links': [
		['1-expired-link.png', 'expired'],
		['2-album.png', 'album'],
		['3-share-dialog.png', 'share']
	],
	'lumen-onboarding': [
		['tour.png', 'tour'],
		['welcome.png', 'welcome']
	],
	'lumen-upload-progress': [['upload-progress.png', 'album']]
};

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({
	viewport: { width: 1280, height: 800 },
	deviceScaleFactor: 1
});
for (const [task, shots] of Object.entries(SHOTS)) {
	mkdirSync(path.join(OUT, task), { recursive: true });
	for (const [file, view] of shots) {
		await page.goto(`${SITE}?view=${view}`);
		await page.screenshot({ path: path.join(OUT, task, file) });
	}
}
await browser.close();
