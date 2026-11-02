import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServiceSpec } from '../../plugins/types';
import {
	launchable,
	parseElapsed,
	refuseSpec,
	ServiceManager,
	serviceEnv,
	type Processes
} from './services';

/**
 * The service manager against a real (tiny) server: it starts a service
 * detached, waits for its health check, refuses what it must not start, and
 * says why a start failed.
 */

let dir: string;
const started: string[] = [];

/** A free loopback port. */
function freePort(): Promise<number> {
	return new Promise((resolve) => {
		const s = createServer();
		s.listen(0, '127.0.0.1', () => {
			const port = (s.address() as { port: number }).port;
			s.close(() => resolve(port));
		});
	});
}

beforeAll(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'wh-services-'));
	// Serves /health, and /quit stops it; prints a line so the log has something.
	writeFileSync(
		path.join(dir, 'server.mjs'),
		`import http from 'node:http';
const port = Number(process.argv[2]);
console.log('serving on ' + port + ' with ' + (process.env.MARK ?? 'no mark'));
http.createServer((req, res) => {
  if (req.url === '/quit') { res.end('bye'); process.exit(0); }
  res.statusCode = req.url === '/health' ? 200 : 404;
  res.end('ok');
}).listen(port, '127.0.0.1');
`
	);
	writeFileSync(
		path.join(dir, 'fail.mjs'),
		`console.error('cannot start: no config'); process.exit(3);`
	);
});
afterAll(async () => {
	for (const url of started) await fetch(`${url}/quit`).catch(() => {});
	rmSync(dir, { recursive: true, force: true });
});

const spec = (port: number, o: Partial<ServiceSpec> = {}): ServiceSpec => ({
	url: `http://127.0.0.1:${port}`,
	health: `http://127.0.0.1:${port}/health`,
	argv: [process.execPath, path.join(dir, 'server.mjs'), String(port)],
	cwd: dir,
	binds: 'loopback',
	readyTimeoutMs: 10_000,
	...o
});

describe('serviceEnv', () => {
	it('passes the login account through but leaves unrelated variables and secrets out', () => {
		const env = serviceEnv(
			{
				PATH: '/bin',
				HOME: '/home/c',
				USER: 'c',
				LOGNAME: 'c',
				CLAUDE_CONFIG_DIR: '/home/c/.claude',
				SHELL: '/bin/zsh',
				TMPDIR: '/tmp/c',
				XDG_CONFIG_HOME: '/home/c/.config',
				ANTHROPIC_API_KEY: 'secret',
				UNRELATED: 'x'
			},
			{ env: { MARK: 'marked' } }
		);
		expect(env).toEqual({
			PATH: '/bin',
			HOME: '/home/c',
			LANG: 'C.UTF-8',
			USER: 'c',
			LOGNAME: 'c',
			CLAUDE_CONFIG_DIR: '/home/c/.claude',
			MARK: 'marked'
		});
	});
});

describe('ServiceManager', () => {
	it('refuses anything not on loopback, not a command, or with no directory', () => {
		expect(refuseSpec(spec(1))).toBeNull();
		expect(refuseSpec(spec(1, { url: 'http://example.com:1' }))).toContain('not on this computer');
		expect(refuseSpec(spec(1, { health: 'http://10.0.0.2:1/health' }))).toContain('health check');
		expect(refuseSpec(spec(1, { url: 'file:///etc/passwd' }))).toContain('not http');
		expect(refuseSpec(spec(1, { argv: [] }))).toContain('command');
		expect(refuseSpec(spec(1, { cwd: 'relative' }))).toContain('directory');
	});

	it('starts a service detached, after its setup, and answers once it is up', async () => {
		const port = await freePort();
		const s = spec(port, {
			env: { MARK: 'marked' },
			setup: [
				{
					label: 'Preparing',
					argv: [process.execPath, '-e', "require('fs').writeFileSync('prepared', 'yes')"],
					timeoutMs: 10_000
				}
			]
		});
		const m = new ServiceManager({ logDir: path.join(dir, 'logs') });
		expect(await m.status('t-up', s)).toMatchObject({ state: 'stopped', reason: null });
		const [a, b] = await Promise.all([m.launch('t-up', s), m.launch('t-up', s)]);
		started.push(s.url);
		expect(a).toEqual({ state: 'running', url: s.url, reason: null });
		expect(b).toEqual(a);
		expect(existsSync(path.join(dir, 'prepared'))).toBe(true);
		expect(readFileSync(path.join(dir, 'logs', 't-up.log'), 'utf8')).toContain(
			`serving on ${port} with marked`
		);
		expect(await m.status('t-up', s)).toMatchObject({ state: 'running' });
		// Launching again does nothing but say so.
		expect(await m.launch('t-up', s)).toMatchObject({ state: 'running' });
	});

	it('counts only a 2xx answer as running, not a server that answers 404', async () => {
		const port = await freePort();
		const s = spec(port);
		const m = new ServiceManager({ logDir: path.join(dir, 'logs') });
		expect(await m.launch('t-404', s)).toMatchObject({ state: 'running' });
		started.push(s.url);
		expect(await m.status('t-404', { ...s, health: `${s.url}/elsewhere` })).toMatchObject({
			state: 'stopped'
		});
	});

	it('offers no Launch where another server answers, nor starts one there', async () => {
		const port = await freePort();
		const s = spec(port);
		const m = new ServiceManager({ logDir: path.join(dir, 'logs') });
		expect(await m.launch('t-other-host', s)).toMatchObject({ state: 'running' });
		started.push(s.url);
		// A service that must carry a field its address does not answer with.
		const other = { ...s, identity: { url: s.health, path: ['service'] } };
		const status = await m.status('t-other', other);
		expect(status).toMatchObject({
			state: 'occupied',
			url: s.url,
			reason: expect.stringContaining(`Something else answers at ${s.url}`)
		});
		expect(launchable(other, status)).toBe(false);
		expect(await m.launch('t-other', other)).toMatchObject({ state: 'occupied' });
		expect(existsSync(path.join(dir, 'logs', 't-other.log'))).toBe(false);
		// Nothing answering, or a failed start, is what Launch is for.
		const down = spec(await freePort());
		expect(launchable(down, await m.status('t-down', down))).toBe(true);
		expect(launchable({ ...down, binds: 'all' }, await m.status('t-down', down))).toBe(false);
	});

	it('starts each launch with a fresh log', async () => {
		const port = await freePort();
		const m = new ServiceManager({ logDir: path.join(dir, 'logs') });
		const s = spec(port, { argv: [process.execPath, path.join(dir, 'fail.mjs')] });
		mkdirSync(path.join(dir, 'logs'), { recursive: true });
		writeFileSync(path.join(dir, 'logs', 't-fresh.log'), 'x'.repeat(10_000));
		const r = await m.launch('t-fresh', s);
		expect(r.log).toBe('cannot start: no config\n');
	});

	it('says why a start failed, with the end of what it printed', async () => {
		const port = await freePort();
		const m = new ServiceManager({ logDir: path.join(dir, 'logs') });
		const r = await m.launch(
			't-fail',
			spec(port, { argv: [process.execPath, path.join(dir, 'fail.mjs')] })
		);
		expect(r.state).toBe('failed');
		expect(r.reason).toContain('it stopped (exit 3)');
		expect(r.log).toContain('cannot start: no config');

		const setup = await m.launch(
			't-setup',
			spec(port, {
				setup: [
					{
						label: 'Installing',
						argv: [process.execPath, '-e', 'process.exit(1)'],
						timeoutMs: 5000
					}
				]
			})
		);
		expect(setup).toMatchObject({ state: 'failed' });
		expect(setup.reason).toContain('Installing did not finish (exit 1)');
	});

	it('never starts a service that listens on every interface', async () => {
		const port = await freePort();
		const m = new ServiceManager({ logDir: path.join(dir, 'logs') });
		const s = spec(port, { binds: 'all' });
		expect((await m.status('t-all', s)).reason).toContain('every network interface');
		expect(await m.launch('t-all', s)).toMatchObject({ state: 'unavailable' });
		expect(existsSync(path.join(dir, 'logs', 't-all.log'))).toBe(false);
	});

	it('stops a service it started, its whole process group, and forgets it', async () => {
		const port = await freePort();
		const s = spec(port);
		const logDir = path.join(dir, 'logs-stop');
		const m = new ServiceManager({ logDir });
		expect(await m.launch('t-stop', s)).toMatchObject({ state: 'running' });
		started.push(s.url);
		expect(m.started()).toEqual(['t-stop']);
		// Another Wheelhouse reading the same state directory (say, after a restart) can stop it too.
		const again = new ServiceManager({ logDir });
		expect(await again.stop('t-stop')).toBe(true);
		expect(await m.status('t-stop', s)).toMatchObject({ state: 'stopped' });
		expect(again.started()).toEqual([]);
		expect(await again.stop('t-stop')).toBe(false);

		// Asked to stop while it is still starting: it stops once the start ends.
		const starting = m.launch('t-stop', s);
		expect(await m.stop('t-stop')).toBe(true);
		expect(await starting).toMatchObject({ state: 'running' });
		expect(await m.status('t-stop', s)).toMatchObject({ state: 'stopped' });
	});

	it('never stops one it did not start, or a later process given the same pid', async () => {
		const logDir = path.join(dir, 'logs-pid');
		mkdirSync(logDir, { recursive: true });
		const killed: [number, string][] = [];
		const processes = (startedAt: number | null): Processes => ({
			startedAt: async () => startedAt,
			kill: (pid, signal) => void killed.push([pid, signal])
		});
		writeFileSync(
			path.join(logDir, 'started.json'),
			JSON.stringify({ old: { pid: 4242, at: 1_000_000 }, bad: { pid: 'x', at: 1 } })
		);
		const later = new ServiceManager({ logDir, processes: processes(1_000_000 + 60_000) });
		expect(later.started()).toEqual(['old']);
		expect(await later.stop('old')).toBe(false);
		expect(await later.stop('never-started')).toBe(false);
		expect(killed).toEqual([]);
		expect(later.started()).toEqual([]);

		writeFileSync(
			path.join(logDir, 'started.json'),
			JSON.stringify({ old: { pid: 4242, at: 1_000_000 } })
		);
		let alive = true;
		const same = new ServiceManager({
			logDir,
			processes: {
				startedAt: async () => (alive ? 1_000_000 + 1_000 : null),
				kill: (pid, signal) => {
					killed.push([pid, signal]);
					alive = false;
				}
			}
		});
		expect(await same.stop('old')).toBe(true);
		expect(killed).toEqual([[-4242, 'SIGTERM']]);
	});

	it('reads the elapsed time ps reports', () => {
		expect(parseElapsed('  01:05\n')).toBe(65_000);
		expect(parseElapsed('2:00:00')).toBe(7_200_000);
		expect(parseElapsed('1-00:00:01')).toBe(86_401_000);
		expect(parseElapsed('')).toBeNull();
	});
});
