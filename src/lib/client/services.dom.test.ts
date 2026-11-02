import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addressRewrites } from './addresses.svelte';
import { launchAndOpen, watchService } from './services';

/** Starting a companion service from a page served at localhost:4310, and the tab it opens. */

let tab: { document: { write(): void }; location: { href: string }; close(): void };
beforeEach(() => {
	(window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(
		'http://localhost:4310/tasks/a'
	);
	tab = { document: { write() {} }, location: { href: '' }, close: vi.fn() };
	vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
	vi.stubGlobal(
		'fetch',
		vi.fn(
			async () =>
				new Response(JSON.stringify({ state: 'running', url: 'http://127.0.0.1:7000/' }), {
					status: 200
				})
		)
	);
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	addressRewrites.to = null;
});

describe('launchAndOpen', () => {
	it('opens the started service at its own address with no rewrite on', async () => {
		await launchAndOpen({ plugin: 'p', service: 's' }, 'token');
		expect(tab.location.href).toBe('http://127.0.0.1:7000/');
	});

	it('opens it at the rewrite’s host while one is on, as a link to it would', async () => {
		addressRewrites.to = '{port}.localhost';
		await launchAndOpen({ plugin: 'p', service: 's' }, 'token');
		expect(tab.location.href).toBe('http://7000.localhost:4310/');
		await launchAndOpen({ plugin: 'p', service: 's' }, 'token', 'http://localhost:7000/docs');
		expect(tab.location.href).toBe('http://7000.localhost:4310/docs');
	});
});

describe('watchService', () => {
	it('looks again while the service is starting, and stops once it is not', async () => {
		const states = ['starting', 'starting', 'running'];
		const fetch = vi.fn(
			async (_url: string) =>
				new Response(JSON.stringify({ state: states.shift() ?? 'running' }), { status: 200 })
		);
		vi.stubGlobal('fetch', fetch);
		const seen: string[] = [];
		watchService({ plugin: 'p', service: 's', project: 'alpha' }, (v) => seen.push(v!.state), 5);
		await vi.waitFor(() => expect(seen).toEqual(['starting', 'starting', 'running']));
		await new Promise((r) => setTimeout(r, 30));
		expect(fetch).toHaveBeenCalledTimes(3);
		expect(String(fetch.mock.calls[0][0])).toBe('/api/services?plugin=p&service=s&project=alpha');
	});

	it('stops looking when asked', async () => {
		const fetch = vi.fn(
			async () => new Response(JSON.stringify({ state: 'starting' }), { status: 200 })
		);
		vi.stubGlobal('fetch', fetch);
		const stop = watchService({ plugin: 'p', service: 's' }, () => {}, 5);
		await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
		stop();
		const calls = fetch.mock.calls.length;
		await new Promise((r) => setTimeout(r, 30));
		expect(fetch.mock.calls.length).toBe(calls);
	});
});
