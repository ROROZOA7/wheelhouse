// Builds a synthetic Firstmate home for recording the Wheelhouse guide (scripts/guide/record.sh).
// Everything here is made up: projects, tasks, people, chat, PRs and paths.
// Run it from the Wheelhouse checkout (it reads tests/helpers/fake-firstmate.ts).
// Usage: node build-demo.mjs <root>   (root must not exist yet)
// Env: APPSHOTS, the made-up Lumen app's screenshots (appshots.mjs writes them).
import { execFileSync } from 'node:child_process';
import {
	chmodSync,
	copyFileSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	utimesSync,
	writeFileSync,
	existsSync
} from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(process.argv[2] ?? '/tmp/wheelhouse-demo');
if (existsSync(ROOT)) throw new Error(`${ROOT} exists; pick a fresh root`);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FM = path.join(ROOT, 'firstmate');
const HOME = path.join(ROOT, 'home');
const NM_LOGS = path.join(HOME, '.no-mistakes', 'logs');
const NM_WT = path.join(HOME, '.no-mistakes', 'worktrees');
const PROJECTS = path.join(HOME, '.claude', 'projects');
const WT = path.join(ROOT, 'worktrees');
const STATE = path.join(ROOT, 'wh-state');
const NOW = Math.floor(Date.now() / 1000);
const M = 60;
const H = 3600;
const D = 86400;
const at = (agoSec) => NOW - agoSec;
const iso = (ts) => new Date(ts * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
const isoMs = (ts) => new Date(ts * 1000).toISOString();

function write(file, content, mode) {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
	if (mode) chmodSync(file, mode);
}
/** Set a file's birth time (macOS moves it back when mtime goes earlier) and then its mtime. */
function times(file, start, end) {
	utimesSync(file, start, start);
	utimesSync(file, end, end);
}
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function runId() {
	let s = '01JD';
	for (const b of randomBytes(22)) s += B32[b % 32];
	return s;
}

// ------------------------------------------------------------------ Firstmate scripts
const LOG_CALL = `printf '%s' "$(basename "$0")" >> "$ROOT/calls.log"; printf ' %s' "$@" >> "$ROOT/calls.log"; echo >> "$ROOT/calls.log"`;
write(
	path.join(FM, 'bin', 'fm-fleet-snapshot.sh'),
	`#!/usr/bin/env bash
# fm-fleet-snapshot.sh - demo. Output contract: \`--json\` prints fm-fleet-snapshot.v1.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
${LOG_CALL}
cat "$ROOT/demo/snapshot.json"
`,
	0o755
);
write(
	path.join(FM, 'bin', 'fm-peek.sh'),
	`#!/usr/bin/env bash
# Usage: fm-peek.sh <target> [lines=40]
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
${LOG_CALL}
f="$ROOT/demo/peek/$1.txt"
[ -f "$f" ] && cat "$f" || echo "(no output)"
`,
	0o755
);
// fm-inbox.sh: the test suite's working stand-in for the inbox contract.
const helper = execFileSync(
	'sed',
	['-n', '/^const INBOX = `/,/^`;$/p', path.join(process.cwd(), 'tests/helpers/fake-firstmate.ts')],
	{ encoding: 'utf8' }
);
const inbox = helper
	.replace(/^const INBOX = `/, '')
	.replace(/`;\s*$/, '')
	.replace(/\\\\/g, '\\')
	.replace(/\\`/g, '`');
write(path.join(FM, 'bin', 'fm-inbox.sh'), inbox, 0o755);
write(path.join(FM, 'demo', 'ready-held.json'), readyJson('held'));
// The inbox stand-in reads ready.json from the install root.
write(path.join(FM, 'ready.json'), readyJson('free'));
function readyJson(lock) {
	return {
		schema: 'fm-primary-ready.v1',
		home: 'demo',
		observed_at: iso(NOW),
		lock: { state: lock, pid: 1, live_harness: lock === 'held' },
		wake_consumer: { state: 'healthy', reason: 'supervised', beacon_age_seconds: 12 },
		posture: { state: 'present' },
		can_receive: true
	};
}
write(
	path.join(FM, 'data', 'projects.md'),
	`# Projects

- lumen [no-mistakes-prod-only +yolo] - Photo sharing for friends and family (web app) (added 2026-08-02)
- tidepool [no-mistakes] - A friendly HTTP client for Node, published on npm (added 2026-08-10)
- atlas [direct-PR] - The product documentation site (added 2026-09-01)
- ai-innovations-chat-agent [no-mistakes] - A support chat agent for the help centre (added 2026-09-12)
- ai-innovations-workflow [no-mistakes] - Workflow automation that routes support tickets (added 2026-09-14)
- ai-innovations-evals [direct-PR] - Evaluation suite for the chat agent's answers (added 2026-09-20)
- logline [local-only] - A small command-line tool for tidying shell history (added 2026-10-01)
`
);
for (const p of [
	'lumen',
	'tidepool',
	'atlas',
	'ai-innovations-chat-agent',
	'ai-innovations-workflow',
	'ai-innovations-evals',
	'logline'
]) {
	const dir = path.join(FM, 'projects', p);
	mkdirSync(dir, { recursive: true });
	execFileSync('git', ['init', '-q', '-b', 'main', dir]);
	if (p !== 'logline')
		execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', `git@github.com:example/${p}.git`]);
}

// ------------------------------------------------------------------ fake tools on PATH
const BIN = path.join(ROOT, 'fakebin');
write(
	path.join(BIN, 'no-mistakes'),
	`#!/usr/bin/env bash
# demo: answers only \`no-mistakes axi status --run <id>\`
if [ "$1" = axi ] && [ "$2" = status ] && [ "$3" = --run ] && [ -f "${ROOT}/nm-status/$4.toon" ]; then
  cat "${ROOT}/nm-status/$4.toon"; exit 0
fi
echo "demo no-mistakes: unsupported" >&2; exit 1
`,
	0o755
);
write(
	path.join(BIN, 'quota-axi'),
	`#!/usr/bin/env bash
cat "${ROOT}/quota.json"
`,
	0o755
);
const SESSION = randomUUID();
const CHAT_DIR = path.join(PROJECTS, '-demo-firstmate');
const CHAT = path.join(CHAT_DIR, `${SESSION}.jsonl`);
write(
	path.join(BIN, 'claude'),
	`#!/usr/bin/env bash
# demo: \`claude -p\` is the PR review plugin's reviewer (fake-reviewer.mjs); anything else stands in
# for the Firstmate session, recording its transcript the way the SessionStart hook would.
for a in "$@"; do
  case "$a" in -p|--version) exec node "${path.join(HERE, 'fake-reviewer.mjs')}" "$@" ;; esac
done
mkdir -p "${STATE}/firstmate"
printf '%s' '${JSON.stringify({ session_id: SESSION, transcript_path: CHAT, cwd: FM, hook_event_name: 'SessionStart', source: 'startup' })}' > "${STATE}/firstmate/session-start.json"
clear
cat "${ROOT}/screen.txt"
exec sleep 86400
`,
	0o755
);
write(path.join(ROOT, 'quota.json'), {
	providers: [
		{
			provider: 'claude',
			state: { status: 'ok' },
			windows: [
				{
					id: 'five_hour',
					label: '5-hour',
					percentRemaining: 58,
					resetsAt: isoMs(at(-2 * H - 10 * M))
				},
				{
					id: 'seven_day',
					label: '7-day',
					percentRemaining: 64,
					resetsAt: isoMs(at(-3 * D - 5 * H))
				},
				{
					id: 'seven_day_opus',
					label: '7-day Opus',
					percentRemaining: 41,
					resetsAt: isoMs(at(-3 * D - 5 * H))
				}
			]
		}
	]
});

// ------------------------------------------------------------------ worktrees with real diffs
function git(cwd, ...args) {
	execFileSync('git', args, {
		cwd,
		stdio: 'ignore',
		env: {
			...process.env,
			GIT_AUTHOR_NAME: 'Demo Crew',
			GIT_AUTHOR_EMAIL: 'crew@example.com',
			GIT_COMMITTER_NAME: 'Demo Crew',
			GIT_COMMITTER_EMAIL: 'crew@example.com'
		}
	});
}
function worktree(id, base, changes) {
	const dir = path.join(WT, id);
	mkdirSync(dir, { recursive: true });
	git(dir, 'init', '-q', '-b', 'main');
	for (const [f, c] of Object.entries(base)) write(path.join(dir, f), c);
	git(dir, 'add', '-A');
	git(dir, 'commit', '-q', '-m', 'base');
	git(dir, 'checkout', '-q', '-b', `fm/${id}`);
	for (const [f, c] of Object.entries(changes)) write(path.join(dir, f), c);
	git(dir, 'add', '-A');
	git(dir, 'commit', '-q', '-m', `work on ${id}`);
	return dir;
}

const lumenBase = {
	'package.json': '{\n  "name": "lumen",\n  "private": true\n}\n',
	'src/app.css':
		':root {\n  --bg: #fbfaf7;\n  --ink: #1d1b18;\n}\n\nbody {\n  background: var(--bg);\n  color: var(--ink);\n}\n',
	'src/routes/+layout.svelte':
		'<script>\n  import "../app.css";\n  let { children } = $props();\n</script>\n\n<header><a href="/">Lumen</a></header>\n{@render children()}\n',
	'src/lib/server/albums.ts':
		'export async function album(id: string) {\n  return db.album.find(id);\n}\n',
	'README.md':
		'# Lumen\n\nPhoto sharing for friends and family.\n\n## Albums\n\nAlbums are private to their owner until shared.\n',
	'docs/adr/0002-album-privacy.md':
		'# Albums are private by default\n\nStatus: accepted\n\n## Context\n\nPeople share family photos. Most albums should never be found by anyone outside the family.\n\n## Decision\n\nEvery album starts private to its owner. Sharing is always an explicit act, and a share can be withdrawn at any time.\n\n## Consequences\n\n- Shared links must be revocable and should expire.\n- Originals stay private; only shared copies are served to others.\n',
	'docs/sharing.md':
		'# Sharing\n\nHow sharing works in Lumen today.\n\n## Inviting people\n\nInvite someone by email and they can see the album once they sign in.\n'
};
const wtDark = worktree('lumen-dark-mode', lumenBase, {
	'src/app.css':
		':root {\n  --bg: #fbfaf7;\n  --ink: #1d1b18;\n}\n\n:root[data-theme="dark"] {\n  --bg: #161513;\n  --ink: #f1eee8;\n}\n\n@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {\n    --bg: #161513;\n    --ink: #f1eee8;\n  }\n}\n\nbody {\n  background: var(--bg);\n  color: var(--ink);\n}\n',
	'src/lib/theme.ts':
		"export type Theme = 'light' | 'dark' | 'system';\n\nexport function applyTheme(theme: Theme) {\n  const root = document.documentElement;\n  if (theme === 'system') delete root.dataset.theme;\n  else root.dataset.theme = theme;\n  localStorage.setItem('theme', theme);\n}\n",
	'src/lib/components/ThemeToggle.svelte':
		'<script lang="ts">\n  import { applyTheme, type Theme } from \'$lib/theme\';\n  let theme = $state<Theme>(\'system\');\n</script>\n\n<select bind:value={theme} onchange={() => applyTheme(theme)} aria-label="Theme">\n  <option value="system">System</option>\n  <option value="light">Light</option>\n  <option value="dark">Dark</option>\n</select>\n',
	'src/routes/+layout.svelte':
		'<script>\n  import "../app.css";\n  import ThemeToggle from "$lib/components/ThemeToggle.svelte";\n  let { children } = $props();\n</script>\n\n<header><a href="/">Lumen</a><ThemeToggle /></header>\n{@render children()}\n'
});
// The share-links PR is the one the live PR review demo reads: several commits with real
// messages, a lockfile bump, a formatting-only hunk and a test snapshot to fold away.
const ALBUMS_BASE =
	"import { db } from './db';\n\nexport async function album(id: string) {\n  return db.album.find(id);\n}\n\nexport async function albumsFor(owner: string) {\n  return db.album.where({ owner });\n}\n\nexport async function rename(id: string, title: string) {\n  return db.album.update(id, { title });\n}\n\nexport async function remove(id: string) {\n    return db.album.delete(id);\n}\n";
const shareBase = {
	...lumenBase,
	'src/lib/server/albums.ts': ALBUMS_BASE,
	'package-lock.json':
		'{\n  "name": "lumen",\n  "lockfileVersion": 3,\n  "packages": {\n    "node_modules/nanoid": {\n      "version": "5.0.7"\n    }\n  }\n}\n'
};
const LINKS_V1 =
	"import { randomBytes } from 'node:crypto';\n\nexport interface ShareLink {\n  token: string;\n  albumId: string;\n  expiresAt: Date | null;\n  allowDownloads: boolean;\n}\n\nexport function createLink(albumId: string, days: number | null, allowDownloads = days !== null): ShareLink {\n  const token = randomBytes(9).toString('base64url');\n  const expiresAt = days ? new Date(Date.now() + days * 86_400_000) : null;\n  return { token, albumId, expiresAt, allowDownloads };\n}\n\nexport const isExpired = (l: ShareLink, now = new Date()) => !!l.expiresAt && l.expiresAt <= now;\n";
const shareCommits = [
	{
		msg: 'feat(share): share an album with a link that expires\n\nA link carries a random token, an optional expiry and a downloads switch.\nLinks that never expire start with downloads off, as the captain asked.',
		files: {
			'src/lib/server/links.ts': LINKS_V1,
			'src/lib/components/ShareDialog.svelte':
				'<script lang="ts">\n  let { album } = $props();\n  let days = $state<number | null>(7);\n</script>\n\n<dialog open>\n  <h2>Share “{album.title}”</h2>\n  <label>Link expires <select bind:value={days}><option value={1}>Tomorrow</option><option value={7}>In 7 days</option><option value={30}>In 30 days</option><option value={null}>Never</option></select></label>\n</dialog>\n',
			'src/lib/server/albums.ts': ALBUMS_BASE.replace(
				'export async function albumsFor',
				'/** The album a share link opens, for a visitor without an account. */\nexport async function albumForLink(token: string) {\n  const link = await db.link.find(token);\n  return link ? db.album.find(link.albumId) : null;\n}\n\nexport async function albumsFor'
			)
		}
	},
	{
		msg: 'feat(share): a friendly page for expired links\n\nVisitors usually have no account, so an expired link explains itself\ninstead of answering with an error.',
		files: {
			'src/routes/s/[token]/+page.server.ts':
				"import { error } from '@sveltejs/kit';\nimport { findLink, isExpired } from '$lib/server/links';\n\nexport async function load({ params }) {\n  const link = await findLink(params.token);\n  if (!link) error(404, 'Link not found');\n  return { link, expired: isExpired(link) };\n}\n",
			'src/routes/s/[token]/+page.svelte':
				'<script>\n  let { data } = $props();\n</script>\n\n{#if data.expired}\n  <h1>This link has expired</h1>\n  <p>Ask the person who shared it for a new link.</p>\n{:else}\n  <Album id={data.link.albumId} readonly />\n{/if}\n'
		}
	},
	{
		msg: 'no-mistakes(review): use 12-byte share tokens\n\nThe token is the only thing protecting a shared album; Firstmate asked\nfor the longer token after the automated review raised it.',
		files: { 'src/lib/server/links.ts': LINKS_V1.replace('randomBytes(9)', 'randomBytes(12)') }
	},
	{
		msg: 'test: link expiry and the share dialog',
		files: {
			'tests/links.test.ts':
				"import { createLink, isExpired } from '../src/lib/server/links';\n\ntest('a link expires after its days', () => {\n  const l = createLink('a1', 7);\n  expect(isExpired(l, new Date(Date.now() + 8 * 86_400_000))).toBe(true);\n});\n\ntest('a link that never expires starts without downloads', () => {\n  expect(createLink('a1', null).allowDownloads).toBe(false);\n});\n",
			'tests/__snapshots__/share-dialog.test.ts.snap':
				'// Vitest Snapshot v1\n\nexports[`share dialog > renders the expiry choices 1`] = `\n"<dialog open><h2>Share “Lisbon”</h2><label>Link expires <select><option>Tomorrow</option><option>In 7 days</option><option>In 30 days</option><option>Never</option></select></label></dialog>"\n`;\n'
		}
	},
	{
		msg: 'docs: sharing guide, README and the token decision record',
		files: {
			'docs/adr/0004-share-link-tokens.md':
				'# Share links use 12-byte random tokens\n\nStatus: accepted\n\n## Context\n\nA share link works without an account, so its token is the only thing protecting the album. Links are pasted into chats and emails, so they should stay short.\n\n## Decision\n\nTokens are 12 random bytes, base64url encoded (16 characters). Links expire after a day, a week, a month, or never, and the owner can withdraw any link.\n\n## Consequences\n\n- Guessing a live token is not practical.\n- An expired link shows a friendly page rather than a 404, because the people opening it often have no account.\n',
			'docs/sharing.md':
				'# Sharing\n\nHow sharing works in Lumen: who can see an album, how links behave, and what happens when they run out.\n\n## Inviting people\n\nInvite someone by email and they can see the album once they sign in.\n\n## Share links\n\nAnyone with a share link can view the album without an account.\n\n- **Expiry:** tomorrow, in 7 days, in 30 days, or never.\n- **Downloads:** on or off per link. Links that never expire start with downloads off.\n- **Withdraw:** the album owner can withdraw a link at any time from the album menu.\n',
			'README.md':
				'# Lumen\n\nPhoto sharing for friends and family.\n\n## Albums\n\nAlbums are private to their owner until shared, by invitation or with a share link. See [Sharing](docs/sharing.md).\n'
		}
	},
	{
		msg: 'chore: bump nanoid and tidy albums.ts',
		files: {
			'package-lock.json':
				'{\n  "name": "lumen",\n  "lockfileVersion": 3,\n  "packages": {\n    "node_modules/nanoid": {\n      "version": "5.0.9"\n    }\n  }\n}\n',
			'src/lib/server/albums.ts': null
		}
	}
];
function worktreeCommits(id, base, commits) {
	const dir = path.join(WT, id);
	mkdirSync(dir, { recursive: true });
	git(dir, 'init', '-q', '-b', 'main');
	for (const [f, c] of Object.entries(base)) write(path.join(dir, f), c);
	git(dir, 'add', '-A');
	git(dir, 'commit', '-q', '-m', 'base');
	git(dir, 'checkout', '-q', '-b', `fm/${id}`);
	for (const c of commits) {
		for (const [f, text] of Object.entries(c.files)) {
			const file = path.join(dir, f);
			// null: re-indent the file's last function (a formatting-only change)
			if (text === null)
				writeFileSync(
					file,
					readFileSync(file, 'utf8').replace(
						'    return db.album.delete(id);',
						'  return db.album.delete(id);'
					)
				);
			else write(file, text);
		}
		git(dir, 'add', '-A');
		git(dir, 'commit', '-q', '-m', c.msg);
	}
	return dir;
}
const wtShare = worktreeCommits('lumen-share-links', shareBase, shareCommits);
const tideBase = {
	'package.json': '{\n  "name": "tidepool",\n  "version": "2.3.0"\n}\n',
	'src/client.ts':
		'export async function request(url: string, init: RequestInit = {}) {\n  const res = await fetch(url, init);\n  if (!res.ok) throw new HttpError(res.status);\n  return res;\n}\n',
	'README.md': '# tidepool\n\nA friendly HTTP client for Node.\n'
};
const wtTide = worktree('tidepool-retry-backoff', tideBase, {
	'src/retry.ts':
		"export interface RetryOptions {\n  retries?: number;\n  baseMs?: number;\n  maxMs?: number;\n  /** Retry POST and PATCH only when the caller says the request is idempotent. */\n  idempotent?: boolean;\n}\n\nconst SAFE = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);\n\nexport function canRetry(method: string, o: RetryOptions) {\n  return SAFE.has(method.toUpperCase()) || o.idempotent === true;\n}\n\n/** Full jitter, capped at maxMs. */\nexport function delay(attempt: number, o: RetryOptions) {\n  const cap = o.maxMs ?? 10_000;\n  const exp = Math.min(cap, (o.baseMs ?? 200) * 2 ** attempt);\n  return Math.random() * exp;\n}\n",
	'src/client.ts':
		"import { canRetry, delay, type RetryOptions } from './retry';\n\nexport async function request(url: string, init: RequestInit & { retry?: RetryOptions } = {}) {\n  const o = init.retry ?? {};\n  for (let attempt = 0; ; attempt++) {\n    const res = await fetch(url, init);\n    if (res.ok) return res;\n    const again = attempt < (o.retries ?? 3) && res.status >= 500 && canRetry(init.method ?? 'GET', o);\n    if (!again) throw new HttpError(res.status);\n    await sleep(delay(attempt, o));\n  }\n}\n",
	'test/retry.test.ts':
		"import { canRetry, delay } from '../src/retry';\n\ntest('POST is retried only when idempotent', () => {\n  expect(canRetry('POST', {})).toBe(false);\n  expect(canRetry('POST', { idempotent: true })).toBe(true);\n});\n\ntest('jitter never exceeds maxMs', () => {\n  for (let i = 0; i < 20; i++) expect(delay(i, { maxMs: 1000 })).toBeLessThanOrEqual(1000);\n});\n",
	'README.md':
		'# tidepool\n\nA friendly HTTP client for Node.\n\n## Retries\n\nFailed GET, HEAD, PUT and DELETE requests are retried up to 3 times with jittered backoff. POST and PATCH are retried only with `retry: { idempotent: true }`.\n'
});
const wtSearch = worktree(
	'atlas-search',
	{ 'package.json': '{\n  "name": "atlas"\n}\n', 'astro.config.mjs': 'export default {};\n' },
	{
		'src/components/Search.astro':
			'<div id="search" role="search"></div>\n<script>\n  // index loaded on first focus\n</script>\n',
		'astro.config.mjs':
			"import pagefind from 'astro-pagefind';\n\nexport default { integrations: [pagefind()] };\n"
	}
);
const wtExport = worktree('lumen-album-export', lumenBase, {
	'src/lib/server/export.ts':
		'export async function exportAlbum(id: string) {\n  // zip every original in the album\n}\n',
	'src/routes/albums/[id]/export/+server.ts': 'export const GET = () => new Response(null);\n'
});
const wtOnboard = worktree('lumen-onboarding', lumenBase, {
	'src/routes/welcome/+page.svelte': '<h1>Welcome to Lumen</h1>\n',
	'src/routes/tour/+page.svelte': '<Tour steps={["upload", "albums", "share"]} />\n',
	'src/lib/components/Tour.svelte':
		'<script>\n  let { steps } = $props();\n  let i = $state(0);\n</script>\n'
});

// ------------------------------------------------------------------ the fleet ledger
const ledger = [];
const ev = (ts, event, task, extra = {}) => ledger.push({ v: 1, ts, event, task, ...extra });
const status = (ts, task, state, text, key) =>
	ev(ts, 'task.status', task, { state, text, ...(key ? { key } : {}) });
const runs = []; // { id, task, steps: [[step, start, end]], ci: text }
function defaultTestLog() {
	return `running test command: npm test\n\n RUN  v3.2.4\n\n ✓ tests/unit.test.ts (24 tests) 61ms\n ✓ tests/routes.test.ts (9 tests) 140ms\n\n Test Files  2 passed (2)\n      Tests  33 passed (33)\n   Duration  1.4s\n\nbaseline tests passed, asking agent to gather live evidence...\n\nclaude started pid=3101\n\nStarted the app against a throwaway database and drove the changed pages.Every scenario behaves as the brief describes.Tearing down the server and temp files.\nclaude exited pid=3101 status=success\n`;
}
const TIDE_TEST_LOG = `running test command: npm test

 RUN  v3.2.4

 ✓ test/client.test.ts (11 tests) 38ms
 ❯ test/retry.test.ts (8 tests | 2 failed) 44ms
   ✓ POST is retried only when idempotent
   × jitter never exceeds maxMs
   × gives up after the configured retries

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/retry.test.ts > retry > jitter never exceeds maxMs
AssertionError: expected 1187.4 to be less than or equal to 1000
 ❯ test/retry.test.ts:12:52
     10|   for (let i = 0; i < 20; i++) {
     11|     const d = delay(i, { maxMs: 1000 });
     12|     expect(d).toBeLessThanOrEqual(1000);
       |                                                    ^

⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  test/retry.test.ts > retry > gives up after the configured retries
AssertionError: expected "fetch" to be called 4 times, but got 5 times
 ❯ test/retry.test.ts:31:19

⎯⎯⎯⎯⎯⎯⎯[2/2]⎯

 Test Files  1 failed | 1 passed (2)
      Tests  2 failed | 17 passed (19)
   Duration  0.9s

configured test command failed
fix round starting after round 1
user-fix round

claude started pid=3170

Two retry tests fail: the cap is applied before the jitter, and the loop makes one attempt too many.Moving the cap after the jitter and counting the first attempt as attempt zero.
`;

function nmRun(task, startAgo, plan, ciText = 'CI checks passed') {
	const id = runId();
	let t = at(startAgo);
	const steps = [];
	for (const [step, secs] of plan) {
		steps.push([step, t, t + secs]);
		t += secs;
	}
	runs.push({ id, task, steps, ci: ciText });
	return { id, end: t };
}

const pr = (repo, n) =>
	`https://github.com/${repo === 'lumen' ? 'lumen-app/lumen' : repo === 'tidepool' ? 'tidepool-js/tidepool' : repo.startsWith('ai-innovations') ? `ai-innovations/${repo.slice(15)}` : 'lumen-app/atlas'}/pull/${n}`;
const DECISIONS = []; // { task, run, findings, answer }

/** A finished ship task: built, validated, ready, merged. */
function landed(
	id,
	repo,
	title,
	model,
	startAgo,
	buildMin,
	reviewMin,
	ciMin,
	mergeAfterMin,
	n,
	decision
) {
	const t0 = at(startAgo);
	ev(t0, 'task.dispatched', id, { kind: 'ship', project: repo, harness: 'claude', model });
	status(t0 + 60, id, 'working', 'read the brief; starting');
	status(t0 + Math.round(buildMin * 0.5) * M, id, 'working', `implemented ${title.toLowerCase()}`);
	const v = t0 + buildMin * M;
	status(v, id, 'paused', 'no-mistakes validation running');
	const r = nmRun(id, NOW - v, [
		['intent', 20],
		['rebase', 25],
		['review', Math.round(reviewMin * 0.55) * M],
		['test', Math.round(reviewMin * 0.25) * M],
		['document', Math.round(reviewMin * 0.08) * M],
		['lint', Math.round(reviewMin * 0.07) * M],
		['push', 15],
		['pr', 20],
		['ci', ciMin * M]
	]);
	if (decision) {
		const askAt = v + Math.round(reviewMin * 0.3) * M;
		const key = `nm-${r.id}-review`;
		const file = path.join(FM, 'data', id, `nm-${r.id}-findings.txt`);
		status(
			askAt,
			id,
			'needs-decision',
			`ask-user findings=${decision.findings.map((f) => f.id).join(',')} file=${file}`,
			key
		);
		status(askAt + 3 * M, id, 'resolved', `answered: ${decision.answer}`, key);
		DECISIONS.push({ task: id, file, findings: decision.findings });
	}
	const ready = r.end;
	const url = pr(repo, n);
	status(ready, id, 'done', `PR ${url} checks green`);
	ev(ready, 'task.pr_ready', id, { pr: url });
	ev(ready + mergeAfterMin * M, 'task.merged', id, { via: 'captain', pr: url });
	ev(ready + mergeAfterMin * M + 120, 'task.cleaned_up', id);
	return { id, repo, title, url, mergedAt: ready + mergeAfterMin * M };
}

const L = [
	landed(
		'lumen-upload-progress',
		'lumen',
		'Upload progress and resumable uploads',
		'opus',
		7 * H,
		70,
		26,
		6,
		95,
		138,
		{
			findings: [
				{
					id: 'resume-token-leak',
					severity: 'warning',
					file: 'src/lib/server/uploads.ts',
					line: '88',
					description:
						'The resume token is logged at info level when an upload restarts. Tokens let anyone finish the upload, so they should not reach the logs.'
				}
			],
			answer:
				'FIX. Drop the token from the log line and log the upload id instead; the token is a credential.'
		}
	),
	landed(
		'tidepool-timeouts',
		'tidepool',
		'Per-request timeouts',
		'sonnet',
		10 * H,
		45,
		18,
		5,
		140,
		57
	),
	landed(
		'lumen-exif-strip',
		'lumen',
		'Strip location data from shared photos',
		'opus',
		1 * D + 6 * H,
		55,
		22,
		7,
		60,
		135,
		{
			findings: [
				{
					id: 'heic-orientation',
					severity: 'warning',
					file: 'src/lib/server/exif.ts',
					line: '41',
					description:
						'Stripping EXIF from HEIC files also drops the orientation tag, so portrait photos would show sideways.'
				},
				{
					id: 'original-kept',
					severity: 'info',
					file: 'src/lib/server/exif.ts',
					line: '12',
					description:
						'The original file with location data is still kept in storage. Is that intended?'
				}
			],
			answer:
				'Decisions on lumen-exif-strip review: - heic-orientation: FIX. Apply the orientation to the pixels before stripping, so photos stay upright. - original-kept: KEEP as is. The brief says originals stay private to the owner; only shared copies are stripped.'
		}
	),
	landed(
		'atlas-dark-code',
		'atlas',
		'Readable code blocks in dark mode',
		'sonnet',
		1 * D + 2 * H,
		35,
		14,
		4,
		180,
		41
	),
	landed(
		'lumen-a11y-pass',
		'lumen',
		'Keyboard navigation and focus rings',
		'opus',
		2 * D + 3 * H,
		80,
		30,
		6,
		240,
		131,
		{
			findings: [
				{
					id: 'focus-trap',
					severity: 'error',
					file: 'src/lib/components/Lightbox.svelte',
					line: '57',
					description:
						'The lightbox traps focus but Escape does not close it, so keyboard users cannot leave it.'
				}
			],
			answer: 'FIX. Close the lightbox on Escape and return focus to the photo that opened it.'
		}
	),
	landed(
		'tidepool-types',
		'tidepool',
		'Stricter TypeScript types',
		'sonnet',
		3 * D + 1 * H,
		60,
		20,
		5,
		300,
		54
	),
	landed(
		'atlas-broken-links',
		'atlas',
		'Fix 23 broken links',
		'haiku',
		4 * D + 4 * H,
		25,
		10,
		4,
		90,
		38,
		{
			findings: [
				{
					id: 'redirects',
					severity: 'info',
					file: 'astro.config.mjs',
					line: '9',
					description:
						'Old URLs could get redirects instead of only fixing the links inside the docs; external sites still link to them.'
				}
			],
			answer:
				'DEFER to a follow-up task: redirects need the hosting config, which this change does not touch.'
		}
	),
	landed(
		'chat-agent-citations',
		'ai-innovations-chat-agent',
		'Cite help articles in answers',
		'opus',
		3 * H,
		50,
		20,
		5,
		30,
		64
	),
	landed(
		'workflow-sla-alerts',
		'ai-innovations-workflow',
		'Alert before a ticket breaches its SLA',
		'sonnet',
		9 * H,
		40,
		16,
		5,
		70,
		29
	),
	landed(
		'evals-tone-checks',
		'ai-innovations-evals',
		'Score answers for tone',
		'sonnet',
		1 * D + 4 * H,
		30,
		12,
		4,
		100,
		17
	),
	landed(
		'lumen-image-cdn',
		'lumen',
		'Serve thumbnails from the CDN',
		'opus',
		5 * D + 2 * H,
		65,
		24,
		6,
		120,
		127
	)
];

// Live tasks -------------------------------------------------------
// A. Share links: ready for review, with screenshots and a live preview.
const A = 'lumen-share-links';
const aStart = at(2 * H + 40 * M);
ev(aStart, 'task.dispatched', A, {
	kind: 'ship',
	project: 'lumen',
	harness: 'claude',
	model: 'opus'
});
status(aStart + 60, A, 'working', 'read the brief; starting on share links');
status(aStart + 35 * M, A, 'working', 'link model and expiry done; building the share dialog');
status(aStart + 62 * M, A, 'working', 'friendly page for expired links; adding tests');
const aVal = aStart + 78 * M;
status(aVal, A, 'paused', 'no-mistakes validation running');
const aRun = nmRun(A, NOW - aVal, [
	['intent', 18],
	['rebase', 22],
	['review', 24 * M],
	['test', 9 * M],
	['document', 2 * M],
	['lint', 70],
	['push', 14],
	['pr', 25],
	['ci', 6 * M]
]);
runs.at(-1).testLog = `running test command: npm test

 RUN  v3.2.4

 ✓ tests/links.test.ts (6 tests) 22ms
 ✓ tests/albums.test.ts (14 tests) 51ms
 ✓ tests/share-dialog.test.ts (5 tests) 140ms

 Test Files  3 passed (3)
      Tests  25 passed (25)
   Duration  1.1s

baseline tests passed, asking agent to gather live evidence...

claude started pid=3201

Started Lumen on a throwaway database and signed in as the demo owner.Shared an album with a 7-day link and opened it in a private window: it shows without an account.Moved the clock past expiry: the friendly expired page shows, with a way to ask for a new link.Turned downloads off for a link: the download button is gone and the file route refuses.Tearing down the server and the database.
claude exited pid=3201 status=success
`;
runs.at(-1).docLog = `housekeeping: updating documentation and linting in one pass...

claude started pid=4201

Sharing guide and README describe share links; adding the decision record for the token length.Lint and the type check pass on the changed files.
claude exited pid=4201 status=success

committed agent fixes: no-mistakes(document): Record the share-link token decision and describe link expiry in the sharing guide

housekeeping lint result recorded for the lint step: 0 unresolved items

document findings: 0 unresolved items
`;
{
	const key = `nm-${aRun.id}-review`;
	const file = path.join(FM, 'data', A, `nm-${aRun.id}-findings.txt`);
	status(
		aVal + 9 * M,
		A,
		'needs-decision',
		`ask-user findings=expired-404,token-length file=${file}`,
		key
	);
	status(
		aVal + 12 * M,
		A,
		'resolved',
		'answered: Decisions on lumen-share-links review: - expired-404: KEEP the friendly page. Links are shared with people who have no account, so a plain 404 would read as broken. - token-length: FIX. Use 12 random bytes instead of 9; the token is the only thing protecting the album.',
		key
	);
	DECISIONS.push({
		task: A,
		file,
		findings: [
			{
				id: 'expired-404',
				severity: 'info',
				file: 'src/routes/s/[token]/+page.server.ts',
				line: '7',
				description:
					'Expired links show a friendly page with status 200. Should they return 404 instead, so crawlers drop them?'
			},
			{
				id: 'token-length',
				severity: 'warning',
				file: 'src/lib/server/links.ts',
				line: '11',
				description:
					'Share tokens are 9 random bytes. They are the only protection on a shared album, so a longer token is safer against guessing.'
			}
		]
	});
}
status(aRun.end - 4 * M, A, 'working', 'preview http://127.0.0.1:4951/');
const aPr = pr('lumen', 142);
status(aRun.end, A, 'done', `PR ${aPr} checks green`);
ev(aRun.end, 'task.pr_ready', A, { pr: aPr });
{
	// What gh tells the PR review plugin about #142: the worktree's real commits and diff.
	const log = execFileSync(
		'git',
		['-C', wtShare, 'log', '--reverse', '--format=%H%x09%s', 'main..HEAD'],
		{ encoding: 'utf8' }
	)
		.trim()
		.split('\n');
	const diff = execFileSync('git', ['-C', wtShare, 'diff', 'main...HEAD'], { encoding: 'utf8' });
	const stat = execFileSync('git', ['-C', wtShare, 'diff', '--numstat', 'main...HEAD'], {
		encoding: 'utf8'
	})
		.trim()
		.split('\n')
		.map((l) => l.split('\t'));
	const sum = (i) => stat.reduce((n, r) => n + (Number(r[i]) || 0), 0);
	const head = execFileSync('git', ['-C', wtShare, 'rev-parse', 'HEAD'], {
		encoding: 'utf8'
	}).trim();
	const view = {
		number: 142,
		title: 'Shareable album links with expiry',
		body: '## Intent\nShare an album with people who have no account, with a link that expires.\n\n## What changed\n- Share links with a random token, an expiry and a downloads switch\n- A friendly page for expired links\n- The sharing guide and a decision record for the token length\n\n## Evidence\nThe validation drove the app: a 7-day link opens without an account, an expired link shows the friendly page, and downloads can be turned off per link.',
		url: aPr,
		author: { login: 'lumen-crew' },
		state: 'OPEN',
		isDraft: false,
		baseRefName: 'main',
		headRefName: `fm/${A}`,
		headRefOid: head,
		additions: sum(0),
		deletions: sum(1),
		changedFiles: stat.length,
		createdAt: iso(aRun.end - 6 * M),
		commits: log.map((l) => ({ oid: l.split('\t')[0], messageHeadline: l.split('\t')[1] })),
		statusCheckRollup: ['check', 'lint', 'test', 'build'].map((name) => ({
			__typename: 'CheckRun',
			name,
			status: 'COMPLETED',
			conclusion: 'SUCCESS',
			detailsUrl: `https://github.com/lumen-app/lumen/actions/runs/${name.length}`
		}))
	};
	write(path.join(ROOT, 'gh', 'pr-142.view.json'), view);
	write(path.join(ROOT, 'gh', 'pr-142.diff'), diff);
	const { number, title, url, author, isDraft, additions, deletions, changedFiles, headRefName } =
		view;
	write(path.join(ROOT, 'gh', 'pr-list.json'), [
		{
			number,
			title,
			url,
			author,
			isDraft,
			updatedAt: iso(aRun.end),
			additions,
			deletions,
			changedFiles,
			headRefName
		}
	]);
}

// B. Retry with backoff: in checks, a fix round after Firstmate answered.
const Bt = 'tidepool-retry-backoff';
const bStart = at(1 * H + 50 * M);
ev(bStart, 'task.dispatched', Bt, {
	kind: 'ship',
	project: 'tidepool',
	harness: 'claude',
	model: 'opus'
});
status(bStart + 60, Bt, 'working', 'read the brief; starting');
status(bStart + 30 * M, Bt, 'working', 'retry loop and jittered delay in place');
status(bStart + 55 * M, Bt, 'working', 'POST retried only when idempotent, as Firstmate asked');
const bVal = bStart + 92 * M;
status(bVal, Bt, 'paused', 'no-mistakes validation running');
const bRunId = runId();
runs.push({
	id: bRunId,
	task: Bt,
	steps: [
		['intent', bVal, bVal + 20],
		['rebase', bVal + 20, bVal + 45],
		['review', bVal + 45, at(9 * M)],
		['test', at(9 * M), NOW - 20]
	],
	ci: null,
	testLog: TIDE_TEST_LOG,
	reviewLog:
		'reviewing changes\nfound 3 findings\nfix round starting after round 1\nauto-fix round\ncommitted agent fixes\nreviewing changes\nfound 1 finding\nfix round starting after round 2\nuser-fix round\n'
});
{
	const key = `nm-${bRunId}-review`;
	const file = path.join(FM, 'data', Bt, `nm-${bRunId}-findings.txt`);
	status(at(14 * M), Bt, 'needs-decision', `ask-user findings=jitter-cap file=${file}`, key);
	status(
		at(11 * M),
		Bt,
		'resolved',
		'answered: FIX. Cap the jittered delay at maxMs so a retry never waits longer than the documented ceiling.',
		key
	);
	DECISIONS.push({
		task: Bt,
		file,
		findings: [
			{
				id: 'jitter-cap',
				severity: 'warning',
				file: 'src/retry.ts',
				line: '17',
				description:
					'The jittered delay can exceed maxMs on the last attempt, which the README promises never happens.'
			}
		]
	});
}
write(
	path.join(ROOT, 'nm-status', `${bRunId}.toon`),
	`run:
  id: ${bRunId}
  branch: fm/${Bt}
  status: fixing
  findings: 6 total, 0 awaiting
  steps[9]{step,status,findings,duration_ms}:
    intent,completed,0,20000
    rebase,completed,0,25000
    review,completed,4,${(at(9 * M) - bVal - 45) * 1000}
    test,fixing,2,0
    document,pending,0,
    lint,pending,0,
    push,pending,0,
    pr,pending,0,
    ci,pending,0,
  active_steps[1]{step,status,active_for,round_active_for,round}:
    test,fixing,9m,2m10s,fix 1
`
);

// C. Dark mode: building, live console.
const C = 'lumen-dark-mode';
const cStart = at(42 * M);
ev(cStart, 'task.dispatched', C, {
	kind: 'ship',
	project: 'lumen',
	harness: 'claude',
	model: 'sonnet'
});
status(cStart + 60, C, 'working', 'read the brief; starting');
status(at(9 * M), C, 'working', 'theme tokens and toggle done; checking every page in dark');

// D. Docs search: the worker asked a question Firstmate is weighing.
const Dt = 'atlas-search';
const dStart = at(40 * M);
ev(dStart, 'task.dispatched', Dt, {
	kind: 'ship',
	project: 'atlas',
	harness: 'claude',
	model: 'sonnet'
});
status(dStart + 60, Dt, 'working', 'read the brief; comparing search options');
status(
	dStart + 12 * M,
	Dt,
	'needs-decision',
	'Should search cover the v2 docs as well, or only the current docs?',
	'search-scope'
);
status(
	dStart + 15 * M,
	Dt,
	'resolved',
	'answered: Only the current docs. Versioned docs come next and will get their own search.',
	'search-scope'
);
status(
	at(6 * M),
	Dt,
	'needs-decision',
	'Pagefind (static, nothing to run) or Algolia DocSearch (hosted, needs an API key)?',
	'search-engine'
);

// E. Onboarding: held for the captain's call.
const E = 'lumen-onboarding';
const eStart = at(75 * M);
ev(eStart, 'task.dispatched', E, {
	kind: 'ship',
	project: 'lumen',
	harness: 'claude',
	model: 'opus'
});
status(eStart + 60, E, 'working', 'read the brief; building both designs to compare');
status(at(12 * M), E, 'paused', 'both designs built; waiting for the captain to choose');

// F. Bundle-size scout: report ready.
const F = 'tidepool-bundle-scout';
const fStart = at(1 * H + 28 * M);
ev(fStart, 'task.dispatched', F, {
	kind: 'scout',
	project: 'tidepool',
	harness: 'claude',
	model: 'sonnet'
});
status(fStart + 60, F, 'working', 'measuring the bundle across the last 10 releases');
status(at(16 * M), F, 'done', 'report ready: the 40% growth is the bundled URL polyfill');

// G. Album export: the automated review is parked on three questions for Firstmate.
const G = 'lumen-album-export';
const gStart = at(1 * H + 10 * M);
ev(gStart, 'task.dispatched', G, {
	kind: 'ship',
	project: 'lumen',
	harness: 'claude',
	model: 'opus'
});
status(gStart + 60, G, 'working', 'read the brief; starting on album export');
status(gStart + 30 * M, G, 'working', 'zip export streaming; adding the download button');
const gVal = gStart + 52 * M;
status(gVal, G, 'paused', 'no-mistakes validation running');
const gRunId = runId();
const gAsk = at(4 * M);
runs.push({
	id: gRunId,
	task: G,
	steps: [
		['intent', gVal, gVal + 20],
		['rebase', gVal + 20, gVal + 45],
		['review', gVal + 45, NOW - 10]
	],
	ci: null,
	reviewLog:
		'reviewing changes\nfound 5 findings\nfix round starting after round 1\nauto-fix round\ncommitted agent fixes\nreviewing changes\nfound 3 findings\nawaiting approval\n'
});
const gFindings = [
	{
		id: 'F1',
		severity: 'warning',
		file: 'src/lib/server/export.ts',
		line: '23',
		description:
			'Exports zip the originals, including photos whose location data is stripped only from shared copies. An owner exporting their own album gets their location data back, which is expected, but a shared viewer allowed to export would get it too. Either strip location data for anyone but the owner, or only let the owner export.'
	},
	{
		id: 'F2',
		severity: 'info',
		file: 'src/routes/albums/[id]/export/+server.ts',
		line: '9',
		description:
			'Large albums are zipped in memory before the download starts. An album of 2,000 photos needs about 6 GB. Streaming the zip as it is built would keep memory flat, at the cost of not knowing the final size up front (no Content-Length, so browsers show no progress bar).'
	},
	{
		id: 'F3',
		severity: 'info',
		file: 'README.md',
		line: '14',
		description:
			'The README says exports include comments, but comments are not built yet (they are queued as lumen-comments). Remove the sentence, or keep it as a promise for the next release.'
	}
];
const gKey = `nm-${gRunId}-review`;
const gFile = path.join(FM, 'data', G, `nm-${gRunId}-findings.txt`);
status(gAsk, G, 'needs-decision', `ask-user findings=F1,F2,F3 file=${gFile}`, gKey);
DECISIONS.push({ task: G, file: gFile, findings: gFindings });
write(
	path.join(ROOT, 'nm-status', `${gRunId}.toon`),
	`run:
  id: ${gRunId}
  branch: fm/${G}
  status: awaiting_approval
  findings: 5 total, 3 awaiting
  awaiting_agent: parked 4m
  steps[9]{step,status,findings,duration_ms}:
    intent,completed,0,20000
    rebase,completed,0,25000
    review,awaiting_approval,3,
    test,pending,0,
    document,pending,0,
    lint,pending,0,
    push,pending,0,
    pr,pending,0,
    ci,pending,0,
gate:
  step: review
  status: awaiting_approval
  findings[3]{id,severity,file,action,description}:
${gFindings.map((f) => `    ${f.id},${f.severity},${f.file},ask-user,"${f.description.slice(0, 60)}"`).join('\n')}
`
);
// The answer Firstmate will send, for answer-demo.sh to deliver while the preview runs.
write(path.join(ROOT, 'answer', 'answer.env'), `TASK=${G}\nKEY=${gKey}\nRUN=${gRunId}\n`);

ledger.sort((a, b) => a.ts - b.ts);
write(
	path.join(FM, 'state', 'fleet-ledger.jsonl'),
	ledger.map((r) => JSON.stringify(r)).join('\n') + '\n'
);

// no-mistakes run logs, timed so the insights see each step's span.
for (const r of runs) {
	const dir = path.join(NM_LOGS, r.id);
	for (const [step, start, end] of r.steps) {
		const file = path.join(dir, `${step}.log`);
		let text = `${step} step\n`;
		if (step === 'rebase') text = `rebasing branch fm/${r.task} onto origin/main\nup to date\n`;
		if (step === 'review')
			text =
				r.reviewLog ??
				'reviewing changes\nfound 2 findings\nfix round starting after round 1\ncommitted agent fixes\nreviewing changes\nno findings\n';
		if (step === 'ci') text = `watching CI for branch fm/${r.task}\n${r.ci}\n`;
		if (step === 'test') text = r.testLog ?? defaultTestLog();
		if (step === 'document')
			text =
				r.docLog ??
				'housekeeping: updating documentation and linting in one pass...\n\nclaude started pid=4101\n\nThe docs already describe this change; nothing to add.\nclaude exited pid=4101 status=success\n\nno agent changes to commit\n\nhousekeeping lint result recorded for the lint step: 0 unresolved items\n\ndocument findings: 0 unresolved items\n';
		if (step === 'lint')
			text = 'lint assessed in the combined document+lint housekeeping pass: 0 unresolved items\n';
		write(file, text);
		times(file, start, end);
	}
}

// ------------------------------------------------------------------ data folders
for (const d of DECISIONS) {
	write(
		d.file,
		d.findings
			.map(
				(f) =>
					`id: ${f.id}\nseverity: ${f.severity}\nfile: ${f.file}\nline: ${f.line}\ndescription: ${f.description}\nauthority: ask-user`
			)
			.join('\n\n') + '\n'
	);
}
write(path.join(FM, 'data', A, 'contributions.json'), {
	schema: 'fm-contributions.v1',
	records: [
		{
			url: aPr,
			kind: 'pr',
			checked_at: iso(at(3 * M)),
			observation: {
				state: 'open',
				draft: false,
				review_decision: null,
				checks: [
					{ name: 'typecheck', status: 'completed', conclusion: 'success' },
					{ name: 'unit tests', status: 'completed', conclusion: 'success' },
					{ name: 'e2e (chromium)', status: 'completed', conclusion: 'success' },
					{ name: 'lint', status: 'completed', conclusion: 'success' }
				]
			}
		}
	]
});
// The task's brief, as Firstmate wrote it: the PR review cites its intent and spec.
write(
	path.join(FM, 'data', A, 'brief.md'),
	`# Task
## Captain's intent
"let people share an album with a link, no account needed, and make sure links can run out"

## Firstmate spec
- An album owner can create a share link that works without an account.
- Links expire tomorrow, in 7 days, in 30 days, or never.
- Downloads can be turned off per link; links that never expire start with downloads off.
- An expired link must not look broken to the person opening it.
- Record the token design in a decision record.

# Setup
You are in a disposable git worktree of lumen.
`
);
write(
	path.join(FM, 'data', A, 'report.md'),
	'# Share links\n\nAlbums can now be shared with a link that works without an account. Links expire after a day, a week or a month (or never), downloads can be turned off per link, and an expired link shows a friendly page instead of an error. Tokens are 12 random bytes.\n'
);
write(
	path.join(FM, 'data', F, 'report.md'),
	'# Why the bundle grew 40%\n\nThe growth since 2.1 is almost all the bundled URL polyfill, pulled in by a transitive dependency for Node 16 support. Node 18+ has URL built in, so dropping Node 16 from `engines` and the polyfill brings the bundle back to 2.0 size. Recommended: ship it in 3.0.\n'
);
write(
	path.join(FM, 'data', E, 'report.md'),
	'# Onboarding\n\nBoth designs are built behind /tour and /welcome.\n'
);

// Worker consoles, as fm-peek.sh shows them.
write(
	path.join(FM, 'demo', 'peek', `${C}.txt`),
	`⏺ Update(src/app.css)
  ⎿  Added 14 lines
⏺ Bash(npm run check)
  ⎿  svelte-check found 0 errors and 0 warnings
⏺ Now checking each page in dark mode. Album grid first.
⏺ Bash(npx playwright screenshot --color-scheme=dark /albums/lisbon)
  ⎿  Saved screenshot to tmp/albums-dark.png
⏺ The share dialog's border is invisible on the dark background; fixing the token.
⏺ Update(src/lib/components/ShareDialog.svelte)
  ⎿  Updated 2 lines
⏺ Rechecking the album grid and the share dialog in dark mode.
`
);
write(
	path.join(FM, 'demo', 'peek', `${Bt}.txt`),
	`⏺ Firstmate answered: cap the jittered delay at maxMs.
⏺ Update(src/retry.ts)
  ⎿  Updated 3 lines
⏺ Bash(npm test -- retry)
  ⎿  ✓ test/retry.test.ts (6 tests) 41ms
⏺ Responding to the review gate with the fix.
`
);
write(
	path.join(FM, 'demo', 'peek', `${Dt}.txt`),
	`⏺ Both options index the 412 pages fine. Pagefind adds 38 KB on first search and needs no service;
  DocSearch needs an Algolia application and an API key in the deploy settings.
⏺ Raised the choice to Firstmate.
`
);
write(
	path.join(FM, 'demo', 'peek', `${E}.txt`),
	'⏺ Both designs are built: /tour (3 steps) and /welcome (one page). Waiting for the captain.\n'
);
write(
	path.join(FM, 'demo', 'peek', `${A}.txt`),
	'⏺ PR is open and CI is green. Preview running at http://127.0.0.1:4951/\n'
);

// ------------------------------------------------------------------ steering inboxes
// Firstmate's messages to each worker (fm-task-inbox.v1); handled/ means the worker has read it.
function inboxMsg(task, n, ts, body, handled) {
	const dir = path.join(FM, 'state', `${task}.inbox`, ...(handled ? ['handled'] : []));
	write(
		path.join(dir, `${String(n).padStart(3, '0')}.msg`),
		`schema=fm-task-inbox.v1\nat=${iso(ts)}\n--\n${body}\n`
	);
}
inboxMsg(
	A,
	1,
	aStart + 20 * M,
	'The captain wants links that never expire to start with downloads off. Keep the expiry choices to tomorrow, 7 days, 30 days and never.',
	true
);
inboxMsg(
	A,
	2,
	aVal + 12 * M - 30,
	`Decisions on lumen-share-links review: - expired-404: KEEP the friendly page. Links are shared with people who have no account, so a plain 404 would read as broken. - token-length: FIX. Use 12 random bytes instead of 9; the token is the only thing protecting the album.\nRun: no-mistakes axi respond --run ${aRun.id} --action fix --ids token-length`,
	true
);
inboxMsg(
	Bt,
	1,
	at(1 * H + 30 * M) + 20,
	'Hard requirement from the captain: never retry POST or PATCH unless the caller passes retry.idempotent: true. The automated review will check for it.',
	true
);
inboxMsg(
	Bt,
	2,
	at(11 * M) - 20,
	`FIX. Cap the jittered delay at maxMs so a retry never waits longer than the documented ceiling.\nRun: no-mistakes axi respond --run ${bRunId} --action fix --ids jitter-cap`,
	true
);
inboxMsg(
	Dt,
	1,
	dStart + 15 * M - 10,
	'Only the current docs. Versioned docs come next and will get their own search, so keep the index per version.',
	true
);
inboxMsg(
	C,
	1,
	at(3 * M),
	'When you check pages in dark mode, include the upload sheet: its border disappears on the dark background in the captain’s screenshot.',
	false
);

// ------------------------------------------------------------------ worker transcripts: the docs each session opened
function workerSession(wt, task, startTs, calls) {
	const dir = path.join(PROJECTS, wt.replace(/[^A-Za-z0-9]/g, '-'));
	const lines = calls.map(([name, file], i) =>
		JSON.stringify({
			type: 'assistant',
			timestamp: isoMs(startTs + i * 90),
			cwd: wt,
			gitBranch: `fm/${task}`,
			message: {
				role: 'assistant',
				content: [
					{ type: 'tool_use', id: `toolu_w${i}`, name, input: { file_path: path.join(wt, file) } }
				]
			}
		})
	);
	write(path.join(dir, `${randomUUID()}.jsonl`), lines.join('\n') + '\n');
}
workerSession(wtShare, A, aStart + 2 * M, [
	['Read', 'README.md'],
	['Read', 'docs/adr/0002-album-privacy.md'],
	['Read', 'docs/sharing.md'],
	['Read', 'src/lib/server/albums.ts'],
	['Edit', 'docs/sharing.md'],
	['Edit', 'README.md'],
	['Write', 'docs/adr/0004-share-link-tokens.md']
]);
workerSession(wtTide, Bt, bStart + 2 * M, [
	['Read', 'README.md'],
	['Read', 'src/client.ts'],
	['Edit', 'README.md']
]);

// ------------------------------------------------------------------ the pull request, as gh reports it
write(
	path.join(BIN, 'gh'),
	`#!/usr/bin/env bash
# demo: answers \`gh pr view <url> --json body,files\` from canned pull requests, and the PR review
# plugin's \`gh pr list\`, \`gh pr view 142 --repo ...\` and \`gh pr diff 142 --repo ...\`; everything else fails.
D="${path.join(ROOT, 'gh')}"
case "$1 $2 $3" in
  "pr list "*) cat "$D/pr-list.json"; exit 0 ;;
  "pr view 142") cat "$D/pr-142.view.json"; exit 0 ;;
  "pr diff 142") cat "$D/pr-142.diff"; exit 0 ;;
esac
if [ "$1" = pr ] && [ "$2" = view ] && [ "$5" = body,files ]; then
  f="${ROOT}/gh/pr-\${3##*/}.json"
  [ -f "$f" ] && cat "$f" || echo '{"body":"","files":[]}'
  exit 0
fi
if [ "$1" = pr ] && [ "$2" = view ] && [ "$5" = title,body,number ]; then
  f="${ROOT}/gh/pr-\${3##*/}.json"
  [ -f "$f" ] && cat "$f" || echo '{"title":null,"body":"","number":null}'
  exit 0
fi
echo "demo gh: unsupported" >&2; exit 1
`,
	0o755
);
write(path.join(ROOT, 'gh', 'pr-142.json'), {
	title: 'Shareable album links with expiry',
	number: 142,
	files: [
		'src/lib/server/links.ts',
		'src/routes/s/[token]/+page.server.ts',
		'src/routes/s/[token]/+page.svelte',
		'src/lib/components/ShareDialog.svelte',
		'docs/adr/0004-share-link-tokens.md',
		'docs/sharing.md',
		'README.md',
		'tests/links.test.ts'
	].map((p) => ({ path: p })),
	body: `## Intent

Let album owners share an album with a link that works without an account.

## What Changed

- **Share links:** an album can be shared with a link that expires tomorrow, in 7 days, in 30 days or never. Downloads can be turned off per link, and links that never expire start with them off.
- **Expired links:** an expired link shows a friendly page that asks the visitor to request a new one.
- **Docs:** the sharing guide and README describe share links, and a new decision record explains the 12-byte token.

## Risk Assessment

✅ Low: the token is 12 random bytes and every link can be withdrawn.

## Testing

I started Lumen on a throwaway database and drove sharing end to end as an album owner and as a visitor without an account. All four scenarios passed. The server and database were torn down afterwards.

- Live validation: ✅ go - 4 of 4 scenarios driven live against the product

| Scenario | Result | Live | Evidence |
| --- | --- | --- | --- |
| An owner shares an album with a 7-day link and a visitor without an account opens it | ✅ pass | live | share-open.png |
| A visitor opens an expired link and sees the friendly expired page | ✅ pass | live | expired.png |
| An owner turns downloads off and the visitor cannot download | ✅ pass | live | no-download.png; the file route answers 403 |
| Adversarial: a guessed token does not open any album | ✅ pass | live | 10,000 random tokens all answered 404 |
`
});

// ------------------------------------------------------------------ the fleet snapshot
function row(id, o) {
	return {
		id,
		kind: o.kind ?? 'ship',
		harness: 'claude',
		mode: 'no-mistakes',
		yolo: 'off',
		branch: `fm/${id}`,
		project: path.join(FM, 'projects', o.repo),
		paths: {
			status_log: { present: true, last_event: o.last ?? null },
			worktree: { path: o.worktree ?? null, present: !!o.worktree },
			report: { path: path.join(FM, 'data', id, 'report.md'), present: !!o.report }
		},
		current_state: {
			state: o.state,
			source: o.source ?? 'pane',
			detail: o.detail ?? null,
			observed_at: iso(NOW),
			freshness: 'fresh'
		},
		endpoint: { exists: true, freshness: 'fresh', target: `firstmate:${id}` },
		pr: { url: o.pr ?? null, source: o.pr ? 'meta' : 'absent' },
		hints: { open_decisions: o.decisions ?? [] },
		backlog: backlog(id, 'in_flight', o)
	};
}
function backlog(id, state, o) {
	return {
		id,
		state,
		title: o.title,
		repo: o.repo,
		kind: o.kind ?? 'ship',
		since: o.since ?? iso(NOW).slice(0, 10),
		pr_url: o.pr ?? null,
		completion: o.completion ?? { verb: null, date: null },
		captain_actionable: !!o.hold,
		hold_reason: o.hold ?? null,
		unresolved_blocker_ids: o.blockers ?? []
	};
}
const snapshot = {
	schema: 'fm-fleet-snapshot.v1',
	generated: iso(NOW),
	fm_home: FM,
	roots: { fm_root: FM, data: path.join(FM, 'data'), state: path.join(FM, 'state') },
	tasks: [
		row(A, {
			repo: 'lumen',
			title: 'lumen: Shareable album links with expiry',
			state: 'done',
			worktree: wtShare,
			pr: aPr,
			report: true
		}),
		row(Bt, {
			repo: 'tidepool',
			title: 'tidepool: Retry failed requests with backoff',
			state: 'working',
			source: 'run-step',
			detail: `validating (fixing) run: ${bRunId}`,
			worktree: wtTide
		}),
		row(C, {
			repo: 'lumen',
			title: 'lumen: Dark mode across the app',
			state: 'working',
			detail: 'harness busy',
			worktree: wtDark
		}),
		row(Dt, {
			repo: 'atlas',
			title: 'atlas: Instant search for the docs',
			state: 'paused',
			detail: 'waiting on a decision',
			worktree: wtSearch,
			decisions: [
				{
					key: 'search-engine',
					verb: 'needs-decision',
					summary:
						'Pagefind (static, nothing to run) or Algolia DocSearch (hosted, needs an API key)?'
				}
			]
		}),
		row(E, {
			repo: 'lumen',
			title: 'lumen: New-user onboarding',
			state: 'paused',
			detail: 'waiting for the captain',
			worktree: wtOnboard,
			hold: 'Both onboarding designs are ready to compare: a 3-step tour or a single welcome page. Which should ship?'
		}),
		row(G, {
			repo: 'lumen',
			title: 'lumen: Export an album as a zip',
			state: 'paused',
			source: 'run-step',
			detail: `validating (parked) run: ${gRunId}`,
			worktree: wtExport,
			decisions: [{ key: gKey, verb: 'needs-decision', summary: 'ask-user findings=F1,F2,F3' }]
		}),
		row(F, {
			repo: 'tidepool',
			kind: 'scout',
			title: 'tidepool: Why did the bundle grow 40%?',
			state: 'done',
			report: true
		})
	],
	backlog: {
		present: true,
		records: [
			backlog('atlas-versioned-docs', 'queued', {
				repo: 'atlas',
				title: 'atlas: Versioned docs for v2 and v3',
				blockers: [Dt]
			}),
			backlog('tidepool-streaming', 'queued', {
				repo: 'tidepool',
				title: 'tidepool: Stream response bodies',
				blockers: [Bt]
			}),
			backlog('chat-agent-handoff', 'queued', {
				repo: 'ai-innovations-chat-agent',
				title: 'ai-innovations-chat-agent: Hand off to a person when unsure'
			}),
			backlog('workflow-routing-rules', 'queued', {
				repo: 'ai-innovations-workflow',
				title: 'ai-innovations-workflow: Route tickets by product area'
			}),
			backlog('lumen-comments', 'queued', {
				repo: 'lumen',
				title: 'lumen: Comments on shared photos'
			}),
			...L.map((l) =>
				backlog(l.id, 'done', {
					repo: l.repo,
					title: `${l.repo}: ${l.title}`,
					pr: l.url,
					since: iso(l.mergedAt - 3 * H).slice(0, 10),
					completion: { verb: 'merged', date: iso(l.mergedAt).slice(0, 10) }
				})
			)
		]
	},
	main_inventory: { valid: true, orphan_in_flight: [] }
};
write(path.join(FM, 'demo', 'snapshot.json'), snapshot);

// ------------------------------------------------------------------ screenshots (filled in by shoot-app.sh)
mkdirSync(path.join(FM, 'data', A, 'screenshots'), { recursive: true });
mkdirSync(path.join(FM, 'data', E, 'screenshots'), { recursive: true });
mkdirSync(path.join(FM, 'data', 'lumen-upload-progress', 'screenshots'), { recursive: true });
// Screenshots of the made-up Lumen app (site/index.html), taken by appshots.mjs.
for (const t of [A, E, 'lumen-upload-progress']) {
	const src = path.join(process.env.APPSHOTS ?? path.join(ROOT, 'appshots'), t);
	if (!existsSync(src)) continue;
	// Newest last: the last file by name leads the card.
	readdirSync(src)
		.sort()
		.forEach((f, i) => {
			const dst = path.join(FM, 'data', t, 'screenshots', f);
			copyFileSync(path.join(src, f), dst);
			utimesSync(dst, at(30 * M - i * 60), at(30 * M - i * 60));
		});
}

// ------------------------------------------------------------------ Claude Code transcripts
// The Firstmate conversation.
const chat = [];
let parent = null;
const base = (ts) => ({
	uuid: randomUUID(),
	parentUuid: parent,
	timestamp: isoMs(ts),
	sessionId: SESSION,
	cwd: FM,
	gitBranch: 'main',
	version: '2.1.40',
	userType: 'external'
});
const push = (r) => {
	chat.push(r);
	parent = r.uuid;
	return r;
};
const usage = (k = 1) => ({
	input_tokens: 40 * k,
	cache_creation_input_tokens: 2000 * k,
	cache_read_input_tokens: 60000 * k,
	output_tokens: 600 * k
});
let msgN = 0;
function captain(ts, text) {
	push({
		...base(ts),
		type: 'user',
		origin: { kind: 'human' },
		message: { role: 'user', content: text }
	});
}
function wake(ts, text) {
	push({
		...base(ts),
		type: 'user',
		origin: { kind: 'task-notification' },
		message: { role: 'user', content: `<task-notification>${text}</task-notification>` }
	});
}
function turn(ts, blocks, durationSec) {
	const id = `msg_demo${++msgN}`;
	let t = ts;
	for (const b of blocks) {
		t += b.after ?? 3;
		if (b.tool) {
			const tid = `toolu_demo${msgN}_${chat.length}`;
			push({
				...base(t),
				type: 'assistant',
				message: {
					id,
					role: 'assistant',
					model: 'claude-opus-5-5',
					content: [{ type: 'tool_use', id: tid, name: b.tool, input: b.input }],
					usage: usage()
				}
			});
			t += 2;
			push({
				...base(t),
				type: 'user',
				message: {
					role: 'user',
					content: [{ type: 'tool_result', tool_use_id: tid, content: b.result ?? '' }]
				},
				sourceToolAssistantUUID: parent
			});
		} else if (b.think) {
			push({
				...base(t),
				type: 'assistant',
				message: {
					id,
					role: 'assistant',
					model: 'claude-opus-5-5',
					content: [{ type: 'thinking', thinking: '', signature: 'c2lnbmF0dXJl' }],
					usage: usage()
				}
			});
		} else if (b.ask) {
			push({
				...base(t),
				type: 'assistant',
				message: {
					id,
					role: 'assistant',
					model: 'claude-opus-5-5',
					content: [
						{
							type: 'tool_use',
							id: `toolu_ask${msgN}`,
							name: 'AskUserQuestion',
							input: { questions: b.ask }
						}
					],
					usage: usage()
				}
			});
		} else {
			push({
				...base(t),
				type: 'assistant',
				message: {
					id,
					role: 'assistant',
					model: 'claude-opus-5-5',
					content: [{ type: 'text', text: b.text }],
					usage: usage(0.5)
				}
			});
		}
	}
	if (durationSec !== null)
		push({
			...base(ts + durationSec),
			type: 'system',
			subtype: 'turn_duration',
			durationMs: durationSec * 1000
		});
}
push({ type: 'ai-title', aiTitle: 'Morning fleet check', sessionId: SESSION });
captain(at(1 * H + 45 * M), 'Morning! What’s on the board today?');
turn(
	at(1 * H + 45 * M),
	[
		{ think: true, after: 4 },
		{
			tool: 'Bash',
			input: { command: 'bin/fm-fleet-snapshot.sh --json', description: 'Read the fleet' },
			result: '{ "schema": "fm-fleet-snapshot.v1", … }'
		},
		{
			tool: 'Read',
			input: { file_path: `${FM}/data/projects.md` },
			result: '- lumen …\n- tidepool …\n- atlas …'
		},
		{
			text: 'Morning, captain. Here’s the board across **lumen**, **tidepool** and **atlas**:\n\n- **Share links** (lumen) is building the share dialog.\n- **Retry with backoff** (tidepool) just started.\n- **Onboarding** (lumen) and **Docs search** (atlas) start next.\n\nNothing needs you yet. I’ll bring you anything that does.',
			after: 6
		}
	],
	24
);
captain(
	at(1 * H + 30 * M),
	'Make sure tidepool never retries a POST unless the caller asks for it. And can someone find out why the bundle grew so much in 2.3?'
);
turn(
	at(1 * H + 30 * M),
	[
		{ think: true, after: 3 },
		{
			tool: 'Bash',
			input: {
				command:
					"bin/fm-inbox.sh note tidepool-retry-backoff 'Hard requirement: never retry POST/PATCH unless retry.idempotent is true.'",
				description: 'Pass the rule to the tidepool worker'
			},
			result: 'queued note 1729830000-ab12cd'
		},
		{
			tool: 'Skill',
			input: { skill: 'dispatch', args: 'scout tidepool: why did the bundle grow 40% in 2.3?' },
			result: 'Launching skill: dispatch'
		},
		{
			tool: 'Bash',
			input: {
				command: 'bin/fm-dispatch.sh tidepool-bundle-scout --kind scout',
				description: 'Start the scout'
			},
			result: 'dispatched tidepool-bundle-scout'
		},
		{
			text: 'Done. The POST rule is now a hard requirement for **Retry with backoff**, and the automated review will check for it.\n\nI’ve sent a scout to measure the bundle across the last ten releases. Its report will land here.',
			after: 5
		}
	],
	41
);
for (const ago of [80 * M, 62 * M, 47 * M]) {
	wake(at(ago), 'fleet check');
	turn(
		at(ago),
		[
			{
				tool: 'Bash',
				input: { command: 'bin/fm-fleet-snapshot.sh --json', description: 'Check the fleet' },
				result: '{ … }'
			},
			{ text: 'Captain, shipshape.' }
		],
		9
	);
}
wake(at(22 * M), 'lumen-share-links: done: PR checks green');
turn(
	at(22 * M),
	[
		{
			tool: 'Bash',
			input: {
				command: `gh pr view ${aPr} --json state,statusCheckRollup`,
				description: 'Check the pull request'
			},
			result: '{"state":"OPEN", "statusCheckRollup": [ … 4 passed … ]}'
		},
		{ tool: 'Read', input: { file_path: `${FM}/data/${A}/report.md` }, result: '# Share links …' },
		{
			text: `**Share links** is ready for your review: [lumen#142](${aPr}).\n\nCI is green, there are three screenshots, and a live preview is running. The review raised two questions and I answered both:\n\n- Expired links show a **friendly page**, not a 404, since they’re shared with people who have no account.\n- Share tokens are now **12 random bytes**.\n\nOpen *Decided for you* if you’d have called either differently.`,
			after: 6
		}
	],
	31
);
wake(at(15 * M), 'tidepool-bundle-scout: done: report ready');
turn(
	at(15 * M),
	[
		{
			tool: 'Read',
			input: { file_path: `${FM}/data/${F}/report.md` },
			result: '# Why the bundle grew 40% …'
		},
		{
			text: 'The scout found it: the **40% growth is the bundled URL polyfill**, pulled in for Node 16. Dropping Node 16 in 3.0 brings the bundle back to its 2.0 size. Want me to queue that for 3.0?',
			after: 5
		}
	],
	18
);
captain(at(6 * M), 'Yes, queue it for 3.0. Where is onboarding at?');
turn(
	at(6 * M),
	[
		{ think: true, after: 3 },
		{
			tool: 'Bash',
			input: {
				command: 'bin/fm-backlog.sh add tidepool-drop-node16 --after tidepool-streaming',
				description: 'Queue the 3.0 change'
			},
			result: 'queued tidepool-drop-node16'
		},
		{
			text: 'Queued for 3.0.\n\nOnboarding has both designs built, with screenshots on the task page. This one is your call:',
			after: 4
		},
		{
			ask: [
				{
					header: 'Onboarding',
					question: 'Which onboarding design should ship?',
					multiSelect: false,
					options: [
						{
							label: '3-step tour',
							description: 'Walks new users through uploading, albums and sharing.'
						},
						{
							label: 'Single welcome page',
							description: 'One page with the three actions; quicker to skip.'
						},
						{
							label: 'Ship the tour, A/B test later',
							description: 'Ship the tour now and test it against the welcome page.'
						}
					]
				}
			],
			after: 3
		}
	],
	null
);
write(CHAT, chat.map((r) => JSON.stringify(r)).join('\n') + '\n');

// Worker, review and other sessions: only their token counts matter (Headroom).
function usageSession(cwd, branch, fromAgo, toAgo, perHour) {
	const file = path.join(PROJECTS, `-demo-${path.basename(cwd)}`, `${randomUUID()}.jsonl`);
	const lines = [];
	for (let t = at(fromAgo); t < at(toAgo); t += Math.round(3600 / perHour)) {
		lines.push(
			JSON.stringify({
				type: 'assistant',
				timestamp: isoMs(t),
				cwd,
				gitBranch: branch,
				message: { role: 'assistant', usage: usage(1 + ((t / 600) % 3)) }
			})
		);
	}
	write(file, lines.join('\n') + '\n');
}
usageSession(wtShare, `fm/${A}`, 2 * H + 40 * M, 22 * M, 40);
usageSession(wtTide, `fm/${Bt}`, 1 * H + 50 * M, 1 * M, 40);
usageSession(wtDark, `fm/${C}`, 42 * M, 1 * M, 40);
usageSession(wtSearch, `fm/${Dt}`, 40 * M, 6 * M, 30);
usageSession(wtOnboard, `fm/${E}`, 75 * M, 12 * M, 30);
usageSession(path.join(WT, F), `fm/${F}`, 1 * H + 28 * M, 16 * M, 25);
for (const r of runs) {
	const s = r.steps[0][1];
	const e = r.steps.at(-1)[2];
	usageSession(path.join(NM_WT, r.id, 'repo'), 'HEAD', NOW - s, Math.max(0, NOW - e), 30);
}
for (const l of L.slice(0, 6))
	usageSession(
		path.join(WT, l.id),
		`fm/${l.id}`,
		NOW - l.mergedAt + 3 * H,
		NOW - l.mergedAt + 30 * M,
		30
	);
usageSession(path.join(ROOT, 'elsewhere', 'notes'), 'main', 6 * D, 6 * D - 2 * H, 20);
usageSession(path.join(ROOT, 'elsewhere', 'notes'), 'main', 20 * H, 19 * H, 20);
// Firstmate's own background use through the day.
{
	const lines = [];
	for (let t = at(23 * H); t < NOW; t += 600)
		lines.push(
			JSON.stringify({
				type: 'assistant',
				timestamp: isoMs(t),
				cwd: FM,
				gitBranch: 'main',
				message: { role: 'assistant', usage: usage(0.6) }
			})
		);
	write(
		path.join(PROJECTS, '-demo-firstmate-earlier', `${randomUUID()}.jsonl`),
		lines.join('\n') + '\n'
	);
}

write(
	path.join(ROOT, 'screen.txt'),
	[
		'',
		' ☐ Onboarding',
		'',
		'Which onboarding design should ship?',
		'',
		'❯ 1. 3-step tour',
		'     Walks new users through uploading, albums and sharing.',
		'  2. Single welcome page',
		'     One page with the three actions; quicker to skip.',
		'  3. Ship the tour, A/B test later',
		'     Ship the tour now and test it against the welcome page.',
		'  4. Type something.',
		'─'.repeat(60),
		'  5. Chat about this',
		'',
		'Enter to select · ↑/↓ to navigate · Esc to cancel',
		''
	].join('\n')
);
mkdirSync(STATE, { recursive: true });
mkdirSync(path.join(ROOT, 'wh-config'), { recursive: true });
mkdirSync(path.join(ROOT, 'tmux'), { recursive: true });
mkdirSync(path.join(ROOT, 'site'), { recursive: true });
copyFileSync(path.join(HERE, 'site', 'index.html'), path.join(ROOT, 'site', 'index.html'));
console.log(
	JSON.stringify({ ROOT, FM, HOME, STATE, SESSION, CHAT, bRunId, aRun: aRun.id }, null, 2)
);
