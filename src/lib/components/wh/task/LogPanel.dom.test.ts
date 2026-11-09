import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskDetail, TaskSummary } from '$lib/types';

vi.mock('$lib/client/live.svelte', () => ({ live: { now: Date.now() } }));
// The output inspector samples the worker's terminal; not under test here.
vi.mock('$lib/components/wh/OutputInspector.svelte', async () => ({
	default: (await import('./testdata/Empty.svelte')).default
}));

import LogPanel from './LogPanel.svelte';

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
});

const task = { id: 'wh-1' } as TaskSummary;

function render(timeline: TaskDetail['timeline']) {
	app = mount(LogPanel, {
		target: document.body,
		props: { task, detail: { timeline, gaps: [] } as unknown as TaskDetail, sampling: false }
	});
	flushSync();
	return document.body.textContent ?? '';
}

describe('LogPanel', () => {
	it('shows the reason there is no history, once (the server says how to turn it on)', () => {
		const reason = 'The ledger is off. Turn it on by creating config/fleet-ledger.';
		const text = render({ available: false, reason });
		expect(text.split('config/fleet-ledger').length - 1).toBe(1);
	});

	it('shows the history when there is some', () => {
		const text = render({
			available: true,
			source: 'the ledger',
			observedAt: null,
			value: [{ at: '2026-11-08T10:00:00Z', kind: 'cleaned-up', state: null, text: 'Cleaned up' }]
		});
		expect(text).toContain('Cleaned up');
	});
});
