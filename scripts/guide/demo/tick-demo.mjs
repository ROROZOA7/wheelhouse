#!/usr/bin/env node
// Keeps the demo crew moving so live behaviour is visible: every 20 s the dark-mode worker
// reports its next step (a ledger status line and a new console), and the snapshot is re-stamped.
// Usage: node tick-demo.mjs <demo root>
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2]);
const FM = path.join(ROOT, 'firstmate');
const SNAP = path.join(FM, 'demo', 'snapshot.json');
const LEDGER = path.join(FM, 'state', 'fleet-ledger.jsonl');
const C = 'lumen-dark-mode';
const STEPS = [
	[
		'checking the album grid in dark mode',
		'⏺ Bash(npx playwright screenshot --color-scheme=dark /albums/lisbon)\n  ⎿  Saved screenshot to tmp/albums-dark.png'
	],
	[
		'fixing the share dialog border on dark paper',
		'⏺ Update(src/lib/components/ShareDialog.svelte)\n  ⎿  Updated 2 lines'
	],
	[
		'checking the upload sheet, as Firstmate asked',
		'⏺ Bash(npx playwright screenshot --color-scheme=dark /upload)\n  ⎿  Saved screenshot to tmp/upload-dark.png'
	],
	[
		'running the type check',
		'⏺ Bash(npm run check)\n  ⎿  svelte-check found 0 errors and 0 warnings'
	],
	['comparing light and dark side by side', '⏺ Read(tmp/albums-dark.png)\n  ⎿  Read image (212 KB)']
];
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
let i = 0;
function tick() {
	const [text, console] = STEPS[i++ % STEPS.length];
	const now = Date.now();
	appendFileSync(
		LEDGER,
		JSON.stringify({
			v: 1,
			ts: Math.floor(now / 1000),
			event: 'task.status',
			task: C,
			state: 'working',
			text
		}) + '\n'
	);
	writeFileSync(
		path.join(FM, 'demo', 'peek', `${C}.txt`),
		`${console}\n⏺ ${text[0].toUpperCase()}${text.slice(1)}.\n`
	);
	const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
	snap.generated = iso(now);
	for (const t of snap.tasks) {
		t.current_state.observed_at = iso(now);
		if (t.id === C) t.current_state.detail = text;
	}
	writeFileSync(SNAP, JSON.stringify(snap, null, 2));
}
tick();
setInterval(tick, 20_000);
