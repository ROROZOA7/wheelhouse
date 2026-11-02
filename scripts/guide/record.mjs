// Records one pass of the Wheelhouse guide against a running demo Wheelhouse (record.sh starts it).
// Frames come from Chrome's screencast (CDP Page.startScreencast), each with its own timestamp,
// so encode.sh can turn them into constant-rate video at any fps without dropped motion.
// Usage: node record.mjs <pass> <out dir>     pass: tour | chat | review
// Env: WH_URL (default http://127.0.0.1:4950), CHROME_PATH (see chrome.mjs).
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchOptions } from './chrome.mjs';

const HERE = import.meta.dirname;
const PASS = process.argv[2];
const OUT = path.resolve(process.argv[3]);
const BASE = process.env.WH_URL ?? 'http://127.0.0.1:4950';
const VIEW = { width: 1440, height: 900 };
// PNG frames keep unchanged pixels identical between frames, which APNG diffing depends on.
const FORMAT = process.env.FRAME_FORMAT ?? 'png';

// ------------------------------------------------------------------ recorder
class Recorder {
	constructor(cdp, dir) {
		this.cdp = cdp;
		this.dir = dir;
		this.frames = [];
		this.writes = [];
		this.marks = [];
		mkdirSync(path.join(dir, 'frames'), { recursive: true });
	}
	async start() {
		this.cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
			this.cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
			const file = `f${String(this.frames.length).padStart(5, '0')}.${FORMAT === 'png' ? 'png' : 'jpg'}`;
			this.frames.push({ ts: metadata.timestamp, file });
			this.writes.push(writeFile(path.join(this.dir, 'frames', file), Buffer.from(data, 'base64')));
		});
		await this.cdp.send('Page.startScreencast', {
			format: FORMAT,
			quality: 95,
			maxWidth: VIEW.width,
			maxHeight: VIEW.height,
			everyNthFrame: 1
		});
		this.t0 = Date.now() / 1000;
	}
	mark(name, extra = {}) {
		this.marks.push({ name, at: +(Date.now() / 1000 - this.t0).toFixed(2), ...extra });
	}
	async stop() {
		const end = Date.now() / 1000;
		await this.cdp.send('Page.stopScreencast');
		await Promise.all(this.writes);
		const f = this.frames;
		if (!f.length) throw new Error('no frames captured');
		// The first frame stands in from the start; each frame lasts until the next one.
		let list = 'ffconcat version 1.0\n';
		for (let i = 0; i < f.length; i++) {
			const next = i + 1 < f.length ? f[i + 1].ts : end;
			const from = i === 0 ? Math.min(f[0].ts, this.t0) : f[i].ts;
			list += `file 'frames/${f[i].file}'\nduration ${Math.max(0.001, next - from).toFixed(4)}\n`;
		}
		list += `file 'frames/${f[f.length - 1].file}'\n`; // concat demuxer needs the last file twice
		writeFileSync(path.join(this.dir, 'concat.txt'), list);
		writeFileSync(
			path.join(this.dir, 'chapters.json'),
			JSON.stringify(
				{ duration: +(end - this.t0).toFixed(2), crop: this.crop ?? null, marks: this.marks },
				null,
				2
			)
		);
		// No pass holds still for 20 s; a gap that long means Chrome or the machine stalled (sleep, load).
		const gap = Math.max(...f.map((x, i) => (i + 1 < f.length ? f[i + 1].ts : end) - x.ts));
		if (gap > 20)
			throw new Error(`${PASS}: Chrome sent no frames for ${gap.toFixed(0)} s; re-record`);
		const fps = f.length / (end - this.t0);
		console.log(
			`${PASS}: ${f.length} frames over ${(end - this.t0).toFixed(1)} s (${fps.toFixed(1)} fps average)`
		);
	}
}

// ------------------------------------------------------------------ browser and actions
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
	viewport: VIEW,
	deviceScaleFactor: 1,
	colorScheme: 'light',
	reducedMotion: 'no-preference'
});
await ctx.addInitScript({
	content: `try { localStorage.setItem('wheelhouse-theme', 'light'); } catch {}\n${readFileSync(path.join(HERE, 'overlay.js'), 'utf8')}`
});
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const rec = new Recorder(cdp, OUT);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
let mouse = { x: 720, y: 520 };

/** Glide the cursor along a gentle arc, firing real mouse moves so hovers happen. */
async function move(x, y, ms = 750) {
	const from = { ...mouse };
	const dx = x - from.x;
	const dy = y - from.y;
	const dist = Math.hypot(dx, dy);
	if (dist < 2) return;
	const steps = Math.max(8, Math.round(ms / 16));
	const bow = Math.min(60, dist * 0.12); // perpendicular offset at mid-path
	const nx = -dy / dist;
	const ny = dx / dist;
	for (let i = 1; i <= steps; i++) {
		const t = ease(i / steps);
		const arc = Math.sin(Math.PI * t) * bow;
		await page.mouse.move(from.x + dx * t + nx * arc, from.y + dy * t + ny * arc);
		await sleep(ms / steps);
	}
	mouse = { x, y };
}
async function box(target) {
	const loc = typeof target === 'string' ? page.locator(target).first() : target;
	await loc.waitFor({ state: 'visible', timeout: 15000 });
	const b = await loc.boundingBox();
	if (!b) throw new Error(`no box for ${target}`);
	return b;
}
async function moveTo(target, { dx = 0.5, dy = 0.5, ms } = {}) {
	const b = await box(target);
	const x = b.x + b.width * dx;
	const y = b.y + b.height * dy;
	await move(x, y, ms ?? Math.min(1100, 450 + Math.hypot(x - mouse.x, y - mouse.y) * 0.6));
}
async function click(target, opts = {}) {
	await moveTo(target, opts);
	await sleep(160);
	await page.mouse.down();
	await sleep(90);
	await page.mouse.up();
	await sleep(opts.after ?? 300);
}
async function type(text, delay = 42) {
	for (const ch of text) {
		await page.keyboard.type(ch);
		await sleep(delay + Math.random() * 30 + (ch === ' ' ? 25 : 0));
	}
}
/** Ease the nearest scrollable ancestor (or the window) so the target sits where we want it. */
async function scrollTo(target, { block = 'start', offset = 24, ms = 1400 } = {}) {
	const loc = typeof target === 'string' ? page.locator(target).first() : target;
	await loc.waitFor({ state: 'attached', timeout: 15000 });
	await loc.evaluate(
		(el, { block, offset, ms }) =>
			new Promise((done) => {
				let sc = el.parentElement;
				while (sc && sc !== document.body) {
					const s = getComputedStyle(sc);
					if (/(auto|scroll)/.test(s.overflowY) && sc.scrollHeight > sc.clientHeight + 4) break;
					sc = sc.parentElement;
				}
				const win = !sc || sc === document.body;
				const view = win ? { top: 0, height: innerHeight } : sc.getBoundingClientRect();
				const r = el.getBoundingClientRect();
				const cur = win ? scrollY : sc.scrollTop;
				const max = win
					? document.documentElement.scrollHeight - innerHeight
					: sc.scrollHeight - sc.clientHeight;
				let to =
					block === 'end'
						? cur + r.bottom - view.top - view.height + offset
						: cur + r.top - view.top - (block === 'center' ? (view.height - r.height) / 2 : offset);
				to = Math.max(0, Math.min(max, to));
				const t0 = performance.now();
				const e = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
				const step = (now) => {
					const t = Math.min(1, (now - t0) / ms);
					const y = cur + (to - cur) * e(t);
					if (win) scrollTo(0, y);
					else sc.scrollTop = y;
					if (t < 1) requestAnimationFrame(step);
					else done();
				};
				requestAnimationFrame(step);
			}),
		{ block, offset, ms }
	);
}
async function scrollWindow(y, ms = 1400) {
	await page.evaluate(
		({ y, ms }) =>
			new Promise((done) => {
				const cur = scrollY;
				const t0 = performance.now();
				const e = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
				const step = (now) => {
					const t = Math.min(1, (now - t0) / ms);
					scrollTo(0, cur + (y - cur) * e(t));
					if (t < 1) requestAnimationFrame(step);
					else done();
				};
				requestAnimationFrame(step);
			}),
		{ y, ms }
	);
}
async function caption(kicker, text, side) {
	rec.mark(kicker, { text });
	await page.evaluate((c) => window.__guide.caption(c), kicker ? { kicker, text, side } : null);
}
async function title(t) {
	await page.evaluate((t) => window.__guide.title(t), t);
}
async function goto(p, ready) {
	await page.goto(BASE + p, { waitUntil: 'domcontentloaded' });
	if (ready) await page.getByText(ready).first().waitFor({ timeout: 30000 });
	await page.mouse.move(mouse.x, mouse.y);
}
const card = (text) => page.locator('article').filter({ hasText: text }).last();
const nav = (href) => page.locator(`a[href="${href}"]:visible`).first();

// ------------------------------------------------------------------ the flows
/** Chat: a live preview card, then a decision answered with a note. */
async function chatFlow({ captions }) {
	if (captions)
		await caption(
			'Chat',
			'Firstmate’s replies carry live previews of the work, straight from the worker’s running app.'
		);
	// Frame the whole preview card just above the composer.
	await scrollTo(previewFooter(), { block: 'end', offset: 24, ms: captions ? 1500 : 10 });
	await sleep(captions ? 600 : 300);
	await moveTo(page.getByText('Shareable album links with expiry').first(), {
		ms: captions ? 900 : 700
	});
	await sleep(captions ? 500 : 250);
	await move(mouse.x + 120, mouse.y + 200, 800); // drift over the preview itself
	await sleep(captions ? 2400 : 600);
	if (captions)
		await caption(
			'Decisions',
			'Decisions arrive as cards. Add a note, pick an answer, and Firstmate passes it on.'
		);
	const decision = card('Both onboarding designs');
	await scrollTo(decision, { block: 'center', ms: captions ? 1500 : 1100 });
	await sleep(captions ? 500 : 300);
	await click(decision.getByPlaceholder(/Add a note/), { dx: 0.3 });
	await type('Ship the tour; we can A/B test it later.', captions ? 42 : 26);
	await sleep(300);
	await click(decision.getByRole('button', { name: 'Approve' }), { after: 300 });
	await page.getByText('You answered').first().waitFor({ timeout: 10000 });
	await move(mouse.x + 260, mouse.y - 60, 800);
	await sleep(captions ? 2800 : 1300);
}
const previewFooter = () => page.getByText('Pull request #142', { exact: true }).first();

/** PR review: from the task page, open the pull request in the PR review plugin's tab and read its stages. */
async function reviewFlow({ captions }) {
	const hold = (ms) => sleep(captions ? ms * 1.4 : ms);
	await click(page.getByRole('link', { name: 'Review PR #142' }).first(), { after: 200 });
	// The engine was started before recording. A pull request it has not reviewed waits in the
	// tab's box for Review; one it keeps (the clip's, read before recording) opens at once.
	const go = page.getByRole('button', { name: 'Review', exact: true }).first();
	const walkthrough = page.getByText('Albums can be shared with a link').first();
	await Promise.race([go.waitFor({ timeout: 30000 }), walkthrough.waitFor({ timeout: 30000 })]);
	if (!(await walkthrough.isVisible())) {
		await expectEnabled(go);
		await hold(500);
		await click(go, { after: 200 });
		await walkthrough.waitFor({ timeout: 30000 });
	}
	await hold(1700);
	await click(stage(/Quality pass/), { after: 200 });
	await page.getByText('A rule hidden in a default argument').first().waitFor({ timeout: 30000 });
	await hold(1700);
	await click(stage(/Links and their expiry/), { after: 200 });
	await page.getByText('Making a link').first().waitFor({ timeout: 30000 });
	await hold(500);
	await scrollTo(page.getByText('Making a link').first(), { offset: 140, ms: 1300 });
	await move(mouse.x + 160, mouse.y + 120, 700);
	await hold(captions ? 1800 : 1500);
	if (captions) {
		await click(stage(/Skim pile/), { after: 200 });
		await page.getByText('Points to the sharing guide.').first().waitFor({ timeout: 30000 });
		await hold(1500);
	}
}
const stage = (name) => page.getByRole('button', { name }).first();
async function expectEnabled(loc) {
	await loc.waitFor({ state: 'visible', timeout: 30000 });
	for (let i = 0; i < 150 && !(await loc.isEnabled()); i++) await sleep(200);
}

/**
 * Starts the PR review plugin's engine (its companion service) before recording, as the captain
 * does once from the tab, so the recording opens a pull request straight away. Launching opens a
 * short-lived tab of its own, which is closed here.
 */
async function startReviewEngine() {
	ctx.on('page', (p) => {
		if (p !== page) p.close().catch(() => {});
	});
	await goto('/projects/lumen/pr-review/review', 'Review a pull request');
	const start = page.getByRole('button', { name: 'Start the engine' });
	const box = page.getByPlaceholder(/github\.com/);
	await Promise.race([start.waitFor({ timeout: 30000 }), box.waitFor({ timeout: 30000 })]).catch(
		() => {}
	);
	if (await start.isVisible().catch(() => false)) await start.click();
	await start.waitFor({ state: 'hidden', timeout: 60000 });
}

/**
 * Has the engine read the clip's pull request before recording, every stage, so the clip's Review
 * link reopens it at once: the tab's own Review button sits outside the clip's crop.
 */
async function readReviewAhead() {
	await goto(
		`/projects/lumen/pr-review/review?pr=${encodeURIComponent(PR)}`,
		'Review a pull request'
	);
	const go = page.getByRole('button', { name: 'Review', exact: true }).first();
	await expectEnabled(go);
	await go.click();
	await page.getByText('Albums can be shared with a link').first().waitFor({ timeout: 60000 });
	// Visit every stage, so each is read before the clip opens it.
	for (const [name, text] of [
		[/Quality pass/, 'A rule hidden in a default argument'],
		[/Links and their expiry/, 'Making a link'],
		[/The expired-link page/, 'Loading the link'],
		[/The share dialog/, 'Choosing the expiry'],
		[/Skim pile/, 'Points to the sharing guide.']
	]) {
		await stage(name).click();
		await page.getByText(text).first().waitFor({ timeout: 120000 });
	}
}
const PR = 'https://github.com/lumen-app/lumen/pull/142';

async function tour() {
	await startReviewEngine();
	await goto('/', 'Firstmate is asking you');
	await sleep(1500);
	await rec.start();
	await page.evaluate(() => window.__guide.cursor(false));
	await title({
		kicker: 'A short tour',
		heading: 'Wheelhouse',
		sub: 'One calm page on your own machine to talk to Firstmate, see what your crew is doing, and review real results.'
	});
	await sleep(4200);
	await title(null);
	await page.evaluate(() => window.__guide.cursor(true));
	await sleep(500);

	await caption(
		'Home',
		'Talk to Firstmate on the right. On deck, on the left, shows what each of your crew is doing.'
	);
	await moveTo(page.getByText('Instant search for the docs').first(), { ms: 900 });
	await sleep(1300);
	await moveTo(page.getByText('Export an album as a zip').first(), { ms: 700 });
	await sleep(1500);
	await move(1050, 420, 900);
	await chatFlow({ captions: true });

	await caption(
		'Harbour',
		'The Harbour: every project at a glance, with what needs you and what is under way.'
	);
	await click(nav('/harbour'), { after: 200 });
	await page.getByText('things need you').first().waitFor({ timeout: 15000 });
	await sleep(1300);
	await moveTo(page.getByText('Review: Shareable album links').first(), { ms: 900 });
	await sleep(1200);
	await scrollTo(page.getByText('chat-agent').first(), { block: 'center', ms: 1500 });
	await sleep(900);
	await scrollTo(page.getByText('things need you').first(), { offset: 400, ms: 1200 });
	await sleep(500);

	await caption(
		'Project',
		'Each project has its own page: what waits on you, what is under way, and what landed.'
	);
	await click(
		page
			.locator('a, button')
			.filter({ hasText: /^lumen$/ })
			.first(),
		{ after: 200 }
	);
	await page.getByText('Your move').first().waitFor({ timeout: 15000 });
	await sleep(1300);
	await scrollTo(page.getByText('Your move').first(), { offset: 110, ms: 1500 });
	await sleep(1200);

	await caption(
		'Task',
		'A task page follows each stage, with the worker’s screenshots and a live preview to click around.'
	);
	await click(page.getByText('Shareable album links with expiry').last(), { after: 200 });
	await page.getByRole('link', { name: 'Review PR #142' }).first().waitFor({ timeout: 15000 });
	await sleep(1400);
	await moveTo(page.getByText('screenshots/3-share-dialog').first(), { dy: -2.5, ms: 900 });
	await sleep(1500);

	await caption(
		'PR review',
		'Review opens the pull request in a plugin’s tab: a walkthrough, a quality pass, then the key changes stop by stop.'
	);
	await reviewFlow({ captions: true });

	await caption(
		'Plugins',
		'Plugins add tabs, pages and cards. Turn them on, and choose their projects, in Settings.'
	);
	await scrollWindow(0, 900);
	await click(page.getByRole('link', { name: 'Settings' }).first(), { after: 200 });
	await sleep(1000);
	const pluginsTab = page.getByRole('link', { name: /^Plugins$/i }).first();
	if (await pluginsTab.isVisible().catch(() => false)) await click(pluginsTab, { after: 200 });
	await page.getByText('GitHub issues').first().waitFor({ timeout: 15000 });
	await sleep(1000);
	await moveTo(page.getByText('GitHub issues').first(), { ms: 800 });
	await sleep(900);
	await moveTo(page.getByText('Project links').first(), { ms: 600 });
	await sleep(900);
	await moveTo(page.getByText('PR review').last(), { ms: 600 });
	await sleep(1800);

	await caption('Help', 'This tour is always one click away, under Help in the header.');
	await moveTo(page.getByRole('button', { name: 'Help' }), { ms: 900 });
	await sleep(2600);

	await caption(null);
	await page.evaluate(() => window.__guide.cursor(false));
	await title({
		kicker: 'Get started',
		heading: 'Wheelhouse',
		sub: '<code>npm install -g @chrisjowen/wheelhouse</code>'
	});
	await sleep(4500);
	await rec.stop();
}

// Each clip keeps only the column its flow happens in, at native pixels, so its text stays crisp
// at the width GitHub shows a README image (about 880 px).
const CROP = {
	chat: { x: 669, y: 57, width: 771, height: 843 }, // Firstmate's chat column
	review: { x: 208, y: 57, width: 852, height: 843 } // the task page's left column, then the tab's passage and stage
};

async function chatClip() {
	rec.crop = CROP.chat;
	await goto('/', 'Firstmate is asking you');
	await sleep(1500);
	await page.evaluate(() => window.__guide.cursor(true));
	await scrollTo(previewFooter(), { block: 'end', offset: 24, ms: 10 });
	await page.mouse.move(1150, 260);
	mouse = { x: 1150, y: 260 };
	await sleep(500);
	await rec.start();
	await sleep(300);
	await chatFlow({ captions: false });
	await rec.stop();
}

async function reviewClip() {
	rec.crop = CROP.review;
	await startReviewEngine();
	await readReviewAhead();
	await goto('/tasks/lumen-share-links', 'Review evidence');
	await sleep(1200);
	await page.mouse.move(520, 420);
	mouse = { x: 520, y: 420 };
	await rec.start();
	await sleep(300);
	await reviewFlow({ captions: false });
	await rec.stop();
}

try {
	if (PASS === 'tour') await tour();
	else if (PASS === 'chat') await chatClip();
	else if (PASS === 'review') await reviewClip();
	else throw new Error(`unknown pass ${PASS}; use tour, chat or review`);
} catch (e) {
	await page.screenshot({ path: path.join(OUT, 'failure.png') }).catch(() => {});
	throw e;
} finally {
	// browser.close() can hang after a long screencast; never let it keep the run waiting.
	await Promise.race([browser.close(), sleep(5000)]);
}
process.exit(0);
