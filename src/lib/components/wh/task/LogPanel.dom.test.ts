import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskDetail, TaskSummary } from '$lib/types';

const health = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('$lib/client/live.svelte', () => ({
	currentHealth: () => health.value,
	live: { now: Date.now() }
}));
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
const detail = (timeline: TaskDetail['timeline']) =>
	({ timeline, gaps: [] }) as unknown as TaskDetail;
const off = { available: false, reason: 'The ledger is off.' } as const;

function render(ledgerAvailable: boolean, timeline: TaskDetail['timeline']) {
	health.value = { ledger: { available: ledgerAvailable, reason: null } };
	app = mount(LogPanel, {
		target: document.body,
		props: { task, detail: detail(timeline), sampling: false }
	});
	flushSync();
	return document.querySelector('[data-history-off]');
}

describe('LogPanel history notice', () => {
	it('says how to turn history on when the fleet ledger is off', () => {
		expect(render(false, off)?.textContent).toMatch(/History is off.*config\/fleet-ledger/s);
	});

	it('says nothing more when the ledger is on but has no history for the task', () => {
		expect(render(true, { available: false, reason: 'No history for this task.' })).toBeNull();
	});

	it('shows the history when there is some', () => {
		const el = render(false, {
			available: true,
			source: 'the ledger',
			observedAt: null,
			value: [{ at: '2026-11-08T10:00:00Z', kind: 'cleaned-up', state: null, text: 'Cleaned up' }]
		});
		expect(el).toBeNull();
		expect(document.body.textContent).toContain('Cleaned up');
	});
});
