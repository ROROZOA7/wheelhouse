import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewCheck } from '$lib/preview';
import { taskSummary } from '../../../../tests/helpers/task-summary';

vi.mock('$app/state', () => ({ page: { data: {} } }));
const { previewChecks } = await import('$lib/client/previewchecks.svelte');
const { default: MoveCard } = await import('./MoveCard.svelte');

/** A Harbour card for a task awaiting review, while its worker's preview answers and once it stops. */

const URL = 'http://127.0.0.1:47811/';
const LIVE: PreviewCheck = {
	url: URL,
	reportedAt: null,
	state: 'live',
	reason: null,
	checkedAt: '2026-11-04T00:00:00Z'
};
const STOPPED: PreviewCheck = {
	...LIVE,
	state: 'down',
	reason: 'The worker will bring it back; it shows here again as soon as it answers.'
};

const task = taskSummary('wh-1', 'needs-review', {
	attention: { kind: 'review', owner: 'captain', text: 'Ready for your review.', url: null },
	preview: { url: URL, reportedAt: '2026-11-04T00:00:00Z' }
});

let answer: PreviewCheck = LIVE;
let app: ReturnType<typeof mount> | null = null;
beforeEach(() => {
	answer = LIVE;
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(JSON.stringify(answer), { status: 200 }))
	);
});
afterEach(() => {
	if (app) unmount(app);
	app = null;
	previewChecks.clear();
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

const previewLinks = () =>
	[...document.querySelectorAll('a')].filter((a) => a.getAttribute('href') === URL);
const evidence = () => document.querySelector('[data-review="preview"]')!.textContent ?? '';

async function drawn() {
	app = mount(MoveCard, { target: document.body, props: { task } });
	await vi.waitFor(() => expect(previewChecks.checks['wh-1']).toBeDefined());
	flushSync();
}

describe('MoveCard', () => {
	it('links the preview while it answers', async () => {
		await drawn();
		expect(previewLinks().length).toBe(2);
		expect(evidence()).toContain(URL);
	});

	it('links nothing to a preview that has stopped, and says why', async () => {
		answer = STOPPED;
		await drawn();
		expect(previewLinks()).toEqual([]);
		expect(evidence()).toContain('Preview stopped.');
		expect(evidence()).toContain(STOPPED.reason);
	});
});
