import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HowItWorked } from '$lib/howitworked';
import HowItWorkedPanel from './HowItWorkedPanel.svelte';

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

async function render(value: HowItWorked, shown = true) {
	const fetchMock = vi.fn(async () => new Response(JSON.stringify(value), { status: 200 }));
	vi.stubGlobal('fetch', fetchMock);
	app = mount(HowItWorkedPanel, { target: document.body, props: { taskId: 'wh-7', shown } });
	flushSync();
	await vi.waitFor(() => {
		if (shown) expect(document.body.textContent).not.toContain('Reading the worker');
	});
	await tick();
	return fetchMock;
}

const how: HowItWorked = {
	available: true,
	harness: 'claude',
	matchedBy: 'worktree, branch and the task’s time window',
	events: [
		{
			at: '2026-11-08T10:00:01Z',
			kind: 'skill',
			name: 'core:tdd',
			line: 'read SKILL.md',
			ok: null,
			durationMs: null,
			exit: null
		},
		{
			at: '2026-11-08T10:00:02Z',
			kind: 'bash',
			name: 'Bash',
			line: 'npm test',
			ok: false,
			durationMs: 3000,
			exit: 1
		}
	],
	dropped: 0,
	summary: {
		skills: { 'core:tdd': 1 },
		mcp: {},
		bash: { runs: 1, failed: 1 },
		edits: 0,
		files: 0,
		agents: 0,
		tokens: { input: 1200, output: 300, cacheRead: 0 },
		sessions: 1,
		from: '2026-11-08T10:00:01Z',
		to: '2026-11-08T10:00:02Z'
	},
	conformance: {
		pack: 'core@0.1.0',
		used: ['core:tdd'],
		unused: ['core:implement'],
		outside: [],
		mcpOutside: [],
		basis: 'A skill counts as used when the session read its SKILL.md from the pack.'
	}
};

describe('HowItWorkedPanel', () => {
	it('reads nothing until its tab is open', async () => {
		const f = await render(how, false);
		expect(f).not.toHaveBeenCalled();
	});

	it('shows the summary, the playbook check and the timeline', async () => {
		await render(how);
		expect(document.querySelector('[data-how-summary]')?.textContent).toContain('1 failed');
		expect(document.querySelector('[data-unused]')?.textContent).toContain('core:implement');
		const items = document.querySelectorAll('[data-how-timeline] li');
		expect(items).toHaveLength(2);
		expect(items[1].textContent).toContain('exit 1');
	});

	it('says why when the session cannot be read', async () => {
		await render({ available: false, reason: 'Not available for codex workers yet.' });
		expect(document.querySelector('[data-how-unavailable]')?.textContent).toMatch(/codex/);
	});
});
