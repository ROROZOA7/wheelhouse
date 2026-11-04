import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewCheck } from '$lib/preview';
import { LIVE_RECHECK_MS, PreviewChecks, STOPPED_RECHECK_MS } from './previewchecks.svelte';

/** The shared preview checks: one per task however many watch it, sooner while stopped, at once on focus. */

const check = (state: PreviewCheck['state']): PreviewCheck => ({
	url: 'http://127.0.0.1:5173/',
	reportedAt: null,
	state,
	reason: state === 'down' ? 'The worker will bring it back.' : null,
	checkedAt: '2026-11-04T00:00:00Z'
});

let answer: PreviewCheck['state'] = 'down';
let fetcher: ReturnType<typeof vi.fn>;
let checks: PreviewChecks;

beforeEach(() => {
	vi.useFakeTimers();
	answer = 'down';
	fetcher = vi.fn(async () => new Response(JSON.stringify(check(answer))));
	vi.stubGlobal('fetch', fetcher);
	checks = new PreviewChecks();
});
afterEach(() => {
	checks.clear();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

const settle = () => vi.advanceTimersByTimeAsync(0);

describe('PreviewChecks', () => {
	it('checks a task once however many places watch it, and stops when none do', async () => {
		const a = checks.watch('t-1');
		const b = checks.watch('t-1');
		await settle();
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(fetcher).toHaveBeenCalledWith('/api/tasks/t-1/preview');
		expect(checks.stopped('t-1')).toBe(true);
		a();
		await vi.advanceTimersByTimeAsync(STOPPED_RECHECK_MS);
		expect(fetcher).toHaveBeenCalledTimes(2);
		b();
		await vi.advanceTimersByTimeAsync(LIVE_RECHECK_MS * 2);
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it('checks a stopped preview again soon, so it shows once the worker brings it back', async () => {
		checks.watch('t-1');
		await settle();
		expect(checks.stopped('t-1')).toBe(true);
		answer = 'live';
		await vi.advanceTimersByTimeAsync(STOPPED_RECHECK_MS);
		expect(checks.checks['t-1'].state).toBe('live');
		expect(checks.stopped('t-1')).toBe(false);
		// One that answers is checked less often.
		await vi.advanceTimersByTimeAsync(STOPPED_RECHECK_MS);
		expect(fetcher).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(LIVE_RECHECK_MS - STOPPED_RECHECK_MS);
		expect(fetcher).toHaveBeenCalledTimes(3);
	});

	it('checks every watched preview at once when the window regains focus', async () => {
		answer = 'live';
		checks.watch('t-1');
		checks.watch('t-2');
		await settle();
		expect(fetcher).toHaveBeenCalledTimes(2);
		answer = 'down';
		window.dispatchEvent(new Event('focus'));
		await settle();
		expect(fetcher).toHaveBeenCalledTimes(4);
		expect(checks.stopped('t-1')).toBe(true);
		expect(checks.stopped('t-2')).toBe(true);
	});

	it('does not check while the tab is hidden, and checks when it is shown', async () => {
		checks.watch('t-1');
		await settle();
		const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
		await vi.advanceTimersByTimeAsync(STOPPED_RECHECK_MS * 3);
		expect(fetcher).toHaveBeenCalledTimes(1);
		hidden.mockReturnValue('visible');
		document.dispatchEvent(new Event('visibilitychange'));
		await settle();
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it('says when Wheelhouse could not be asked, and keeps the last check', async () => {
		answer = 'live';
		checks.watch('t-1');
		await settle();
		fetcher.mockImplementationOnce(async () => new Response('', { status: 500 }));
		await vi.advanceTimersByTimeAsync(LIVE_RECHECK_MS);
		expect(checks.failed['t-1']).toBe(true);
		expect(checks.checks['t-1'].state).toBe('live');
	});
});
