import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { Sandboxes, SandboxServer, SANDBOX_PATH, sandboxPage, signCsp } from './sandbox';

/** GET a path from the sandbox with a given Host header. */
function get(base: string, p: string, host?: string) {
	const u = new URL(p, base);
	return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>(
		(resolve, reject) => {
			const req = request(
				{
					host: u.hostname,
					port: u.port,
					path: u.pathname + u.search,
					headers: { host: host ?? u.host }
				},
				(res) => {
					let body = '';
					res.on('data', (c) => (body += c));
					res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
				}
			);
			req.on('error', reject);
			req.end();
		}
	);
}

describe('the MCP app sandbox', () => {
	const sandbox = new SandboxServer();
	let base = '';
	/** The signed sandbox page for `csp`, framed by `host`. */
	const page = (csp: object, host = 'http://127.0.0.1:4310') => {
		const at = sandbox.url(csp);
		if (!('url' in at)) throw new Error(at.reason);
		const u = new URL(at.url);
		u.searchParams.set('host', host);
		return u;
	};
	beforeAll(async () => {
		await sandbox.start();
		base = page({}).origin;
	});
	afterAll(() => sandbox.close());

	it('listens on loopback, on a port of its own', () => {
		expect(base).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
	});

	it('serves the proxy with the app’s policy, framed only by the Wheelhouse page named', async () => {
		const u = page({ connectDomains: ['https://api.example.com'] });
		expect(u.pathname).toBe(SANDBOX_PATH);
		const r = await get(base, u.pathname + u.search);
		expect(r.status).toBe(200);
		expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
		const policy = String(r.headers['content-security-policy']);
		expect(policy).toContain("default-src 'none'");
		expect(policy).toContain("connect-src 'self' https://api.example.com");
		expect(policy).toContain('frame-ancestors http://127.0.0.1:4310');
		expect(r.headers['cache-control']).toBe('no-store');
		expect(r.body).toContain('"http://127.0.0.1:4310"');
		expect(r.body).toContain('ui/notifications/sandbox-');
	});

	it('refuses a framing page that is not Wheelhouse on loopback', async () => {
		for (const host of ['https://evil.example.com', 'http://127.0.0.1.evil.com', 'null', '']) {
			const u = page({}, host);
			expect((await get(base, u.pathname + u.search)).status).toBe(400);
		}
	});

	it('serves only a policy it signed: not an unsigned, changed or otherwise-signed one', async () => {
		const wide = JSON.stringify({ connectDomains: ['https://evil.example'] });
		const tries = (u: URL) => get(base, u.pathname + u.search).then((r) => r.status);

		const unsigned = page({});
		unsigned.searchParams.delete('sig');
		expect(await tries(unsigned)).toBe(400);
		const noPolicy = page({});
		noPolicy.searchParams.delete('csp');
		expect(await tries(noPolicy)).toBe(400);

		const changed = page({ connectDomains: ['https://api.example.com'] });
		changed.searchParams.set('csp', wide);
		expect(await tries(changed)).toBe(400);

		const otherKey = page({});
		otherKey.searchParams.set('csp', wide);
		otherKey.searchParams.set('sig', signCsp(Buffer.alloc(32, 7), wide));
		expect(await tries(otherKey)).toBe(400);

		// Another sandbox's signature, for the very same policy, is no good here either.
		const other = new SandboxServer();
		await other.start();
		const theirs = other.url({});
		other.close();
		if (!('url' in theirs)) throw new Error(theirs.reason);
		const borrowed = page({});
		borrowed.searchParams.set('sig', new URL(theirs.url).searchParams.get('sig')!);
		expect(await tries(borrowed)).toBe(400);

		expect(await tries(page({}))).toBe(200);
	});

	it('serves nothing else, and answers loopback Host headers only', async () => {
		expect((await get(base, '/')).status).toBe(404);
		expect((await get(base, '/api/fleet')).status).toBe(404);
		const u = page({});
		expect((await get(base, u.pathname + u.search, 'evil.example.com')).status).toBe(421);
	});

	it('keeps the host origin from breaking out of its script', () => {
		expect(sandboxPage('http://127.0.0.1:1</script>')).not.toContain('</script>"');
	});

	it('tells the page of the app’s first uncaught error, which the app cannot forge', () => {
		const HOST = 'http://127.0.0.1:4310';
		const script = /<script>([\s\S]*)<\/script>/.exec(sandboxPage(HOST))![1];
		type Listener = (e: unknown) => void;
		const steps: string[] = [];
		const toPage: { message: Record<string, unknown>; origin: string }[] = [];
		const appListeners: Record<string, Listener[]> = {};
		const app = {
			addEventListener: (type: string, fn: Listener) => {
				steps.push(`listen ${type}`);
				(appListeners[type] ??= []).push(fn);
			},
			postMessage: () => {}
		};
		const inner = {
			setAttribute: () => {},
			contentWindow: app,
			contentDocument: {
				open: () => steps.push('open'),
				write: () => steps.push('write'),
				close: () => {}
			}
		};
		const parent = {
			postMessage: (message: never, origin: string) => toPage.push({ message, origin })
		};
		let onMessage: Listener = () => {};
		const win = {
			self: {},
			top: {},
			parent,
			addEventListener: (_: string, fn: Listener) => (onMessage = fn)
		};
		const doc = { createElement: () => inner, body: { appendChild: () => {} } };
		new Function('window', 'document', script)(win, doc);
		onMessage({
			source: parent,
			origin: HOST,
			data: { method: 'ui/notifications/sandbox-resource-ready', params: { html: '<p>app</p>' } }
		});
		// Listening after open(), which clears a window's listeners, and before the app runs.
		expect(steps).toEqual(['open', 'listen error', 'listen unhandledrejection', 'write']);
		// The app cannot say it on its own behalf.
		onMessage({
			source: app,
			origin: 'null',
			data: { method: 'ui/notifications/sandbox-app-error', params: { message: 'forged' } }
		});
		const fail = {
			name: 'TypeError',
			message: "Cannot read properties of undefined (reading 'length')"
		};
		appListeners.error[0]({ error: fail, message: 'Uncaught TypeError' });
		appListeners.unhandledrejection[0]({ reason: 'later' });
		expect(toPage.slice(1)).toEqual([
			{
				message: {
					jsonrpc: '2.0',
					method: 'ui/notifications/sandbox-app-error',
					params: { message: "TypeError: Cannot read properties of undefined (reading 'length')" }
				},
				origin: HOST
			}
		]);
	});
});

describe('the sandboxes, one for each MCP server', () => {
	const sandboxes = new Sandboxes();
	afterAll(() => sandboxes.close());

	const origin = async (key: string) => {
		const at = await sandboxes.url(key, {});
		if (!('url' in at)) throw new Error(at.reason);
		return new URL(at.url).origin;
	};

	it('gives two servers different origins, and one server the same one each time', async () => {
		const [a, b] = await Promise.all([origin('demo/one@'), origin('demo/two@')]);
		expect(a).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		expect(b).not.toBe(a);
		expect(await origin('demo/one@')).toBe(a);
		expect(await origin('demo/one@project')).not.toBe(a);
	});

	it('serves each server’s signed policy from its own sandbox only', async () => {
		const at = await sandboxes.url('demo/one@', {});
		if (!('url' in at)) throw new Error(at.reason);
		const u = new URL(at.url);
		u.searchParams.set('host', 'http://127.0.0.1:4310');
		expect((await get(u.origin, u.pathname + u.search)).status).toBe(200);
		expect((await get(await origin('demo/two@'), u.pathname + u.search)).status).toBe(400);
	});
});
