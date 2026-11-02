import { execFile, spawn, type ChildProcess } from 'node:child_process';
import {
	closeSync,
	fstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	readSync,
	renameSync,
	writeFileSync
} from 'node:fs';
import path from 'node:path';
import type { ServiceSpec, ServiceStatus } from '../../plugins/types';

/**
 * Plugin companion services: a local web UI a first-party plugin declares
 * (improve's review UI, docket's viewer), which Wheelhouse checks, starts and
 * stops. When it starts or stops one is the supervisor's call (autostart.ts);
 * this is how. The command comes from the plugin's own code, never from a
 * repository's files; it must serve on loopback, and it runs detached, so it
 * keeps running when Wheelhouse stops. Its output goes to a log in Wheelhouse's
 * state directory, beside a record of the processes Wheelhouse started, so it
 * stops only those, even after a restart.
 */

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const DEFAULT_READY_MS = 30_000;
const MAX_READY_MS = 120_000;
const MAX_SETUP_MS = 10 * 60_000;
const POLL_MS = 400;
const LOG_TAIL = 2048;
const IDENTITY_MS = 5_000;
/** How far a process's start may be from when Wheelhouse started one, for it to be that one. */
const SAME_PROCESS_MS = 5_000;
const STOP_MS = 5_000;
const STARTED_FILE = 'started.json';

/** Why a spec cannot be checked or started here, or null when it can. */
export function refuseSpec(spec: ServiceSpec): string | null {
	for (const [what, u] of [
		['address', spec.url],
		['health check', spec.health],
		...(spec.identity ? [['identity check', spec.identity.url] as const] : [])
	] as const) {
		let url: URL;
		try {
			url = new URL(u);
		} catch {
			return `its ${what} is not a URL.`;
		}
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			return `its ${what} is not http(s).`;
		}
		if (!LOOPBACK.has(url.hostname)) return `its ${what} is not on this computer (loopback).`;
	}
	if (
		!Array.isArray(spec.argv) ||
		!spec.argv.length ||
		spec.argv.some((a) => typeof a !== 'string')
	) {
		return 'its command is not a list of arguments.';
	}
	if (!path.isAbsolute(spec.cwd)) return 'it names no directory to run in.';
	return null;
}

/**
 * Whether Launch can start it: only one on loopback alone that nothing answers
 * for, or whose last start failed; never where something else answers.
 */
export function launchable(spec: ServiceSpec, status: ServiceStatus): boolean {
	return spec.binds === 'loopback' && (status.state === 'stopped' || status.state === 'failed');
}

/** What Wheelhouse sees of a process: when it started, and a signal to it. */
export interface Processes {
	/** When the process with this pid started (ms since the epoch), or null when none runs. */
	startedAt(pid: number): Promise<number | null>;
	/** A signal to the process, or with a negative pid to its process group. */
	kill(pid: number, signal: NodeJS.Signals): void;
}

export interface ServiceHost {
	/** Where launch logs go (Wheelhouse's state directory, never the Firstmate home). */
	logDir: string;
	env?: NodeJS.ProcessEnv;
	fetch?: typeof fetch;
	spawn?: typeof spawn;
	now?: () => number;
	processes?: Processes;
}

interface Launch {
	done: Promise<ServiceStatus>;
	child: ChildProcess | null;
}

/** A service process Wheelhouse started: its pid, and when (to tell it from a later one with that pid). */
interface Started {
	pid: number;
	at: number;
}

export class ServiceManager {
	private readonly launches = new Map<string, Launch>();
	private readonly fetch: typeof fetch;
	private readonly spawn: typeof spawn;
	private readonly now: () => number;
	private readonly processes: Processes;

	constructor(private readonly host: ServiceHost) {
		this.fetch = host.fetch ?? fetch;
		this.spawn = host.spawn ?? spawn;
		this.now = host.now ?? Date.now;
		this.processes = host.processes ?? systemProcesses;
	}

	/** The key of each service still being started. */
	starting(): string[] {
		return [...this.launches.keys()];
	}

	/** The key of each service whose process Wheelhouse started and has not stopped. */
	started(): string[] {
		return Object.keys(this.records());
	}

	/** The end of the service's last launch log. */
	log(key: string): string {
		return tail(this.logFile(key));
	}

	/**
	 * Stop the service, if Wheelhouse started it and that process still runs:
	 * its whole process group, with SIGTERM and, after a few seconds, SIGKILL.
	 * Never one Wheelhouse did not start, or a later process given the same pid.
	 * One still starting is stopped once its start has ended. Says whether it
	 * stopped one.
	 */
	async stop(key: string): Promise<boolean> {
		await this.launches.get(key)?.done;
		const record = this.records()[key];
		if (!record) return false;
		const ours = async () => {
			const at = await this.processes.startedAt(record.pid);
			return at !== null && Math.abs(at - record.at) <= SAME_PROCESS_MS;
		};
		if (!(await ours())) {
			this.forget(key);
			return false;
		}
		this.signal(record.pid, 'SIGTERM');
		const until = this.now() + STOP_MS;
		while (this.now() < until && (await ours())) {
			await new Promise((r) => setTimeout(r, POLL_MS));
		}
		try {
			this.processes.kill(-record.pid, 'SIGKILL');
		} catch {
			// the whole group is gone
		}
		this.forget(key);
		return true;
	}

	private signal(pid: number, signal: NodeJS.Signals) {
		try {
			this.processes.kill(-pid, signal);
		} catch {
			try {
				this.processes.kill(pid, signal);
			} catch {
				// already gone
			}
		}
	}

	private recordsFile() {
		return path.join(this.host.logDir, STARTED_FILE);
	}

	private records(): Record<string, Started> {
		try {
			const v = JSON.parse(readFileSync(this.recordsFile(), 'utf8')) as unknown;
			if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
			return Object.fromEntries(
				Object.entries(v as Record<string, unknown>).filter(
					(e): e is [string, Started] =>
						typeof e[1] === 'object' &&
						e[1] !== null &&
						Number.isInteger((e[1] as Started).pid) &&
						(e[1] as Started).pid > 0 &&
						typeof (e[1] as Started).at === 'number'
				)
			);
		} catch {
			return {};
		}
	}

	private writeRecords(records: Record<string, Started>) {
		try {
			mkdirSync(this.host.logDir, { recursive: true });
			const tmp = `${this.recordsFile()}.${process.pid}.tmp`;
			writeFileSync(tmp, JSON.stringify(records, null, 2), { mode: 0o600 });
			renameSync(tmp, this.recordsFile());
		} catch {
			// unrecorded: Wheelhouse will not stop it, which is the safe side
		}
	}

	private remember(key: string, pid: number) {
		this.writeRecords({ ...this.records(), [key]: { pid, at: this.now() } });
	}

	private forget(key: string) {
		const records = this.records();
		if (!(key in records)) return;
		delete records[key];
		this.writeRecords(records);
	}

	/** Whether the service answers its health check now. */
	async status(key: string, spec: ServiceSpec): Promise<ServiceStatus> {
		const refused = refuseSpec(spec);
		if (refused)
			return { state: 'unavailable', url: null, reason: `It cannot run here: ${refused}` };
		if (this.launches.has(key)) return { state: 'starting', url: spec.url, reason: null };
		const answer = await this.answers(spec);
		if (answer === 'other') return this.other(spec);
		return answer === 'up'
			? { state: 'running', url: spec.url, reason: null }
			: {
					state: 'stopped',
					url: spec.url,
					reason: spec.binds === 'loopback' ? null : this.bindReason()
				};
	}

	/**
	 * Start the service, unless it already answers, and wait until it does. Runs
	 * the spec's setup steps first (say, installing its dependencies). Concurrent
	 * launches of one service share one start.
	 */
	launch(key: string, spec: ServiceSpec): Promise<ServiceStatus> {
		const pending = this.launches.get(key);
		if (pending) return pending.done;
		const refused = refuseSpec(spec);
		if (refused) {
			return Promise.resolve({
				state: 'unavailable',
				url: null,
				reason: `It cannot run here: ${refused}`
			});
		}
		if (spec.binds !== 'loopback') {
			return Promise.resolve({ state: 'unavailable', url: spec.url, reason: this.bindReason() });
		}
		const launch: Launch = { done: Promise.resolve(null as never), child: null };
		launch.done = this.start(key, spec, launch).finally(() => this.launches.delete(key));
		this.launches.set(key, launch);
		return launch.done;
	}

	private bindReason() {
		return 'It listens on every network interface, and Wheelhouse only starts services that listen on this computer alone.';
	}

	private other(spec: ServiceSpec): ServiceStatus {
		return {
			state: 'occupied',
			url: spec.url,
			reason: `Something else answers at ${spec.url}, so Wheelhouse does not start this one there.`
		};
	}

	private logFile(key: string) {
		return path.join(this.host.logDir, `${key.replace(/[^A-Za-z0-9._-]+/g, '_')}.log`);
	}

	private async start(key: string, spec: ServiceSpec, launch: Launch): Promise<ServiceStatus> {
		const first = await this.answers(spec);
		if (first === 'other') return this.other(spec);
		if (first === 'up') return { state: 'running', url: spec.url, reason: null };
		mkdirSync(this.host.logDir, { recursive: true });
		const log = this.logFile(key);
		writeFileSync(log, '');
		const env = this.env(spec);

		for (const step of spec.setup ?? []) {
			const code = await this.runToLog(
				step.argv,
				step.cwd ?? spec.cwd,
				env,
				log,
				Math.min(step.timeoutMs, MAX_SETUP_MS),
				launch
			);
			if (code !== 0) {
				return this.failed(
					spec,
					`${step.label} did not finish (${code === null ? 'it ran out of time' : `exit ${code}`}).`,
					log
				);
			}
		}

		let exited: number | null | undefined;
		const fd = openSync(log, 'a');
		try {
			const child = this.spawn(spec.argv[0], spec.argv.slice(1), {
				cwd: spec.cwd,
				env,
				detached: true,
				stdio: ['ignore', fd, fd]
			});
			launch.child = child;
			child.on('exit', (code) => (exited = code));
			child.on('error', () => (exited = exited ?? -1));
			child.unref();
			if (child.pid) this.remember(key, child.pid);
		} catch (e) {
			return this.failed(spec, `it could not be started: ${(e as Error).message}.`, log);
		} finally {
			closeSync(fd);
		}

		const until = Date.now() + Math.min(spec.readyTimeoutMs ?? DEFAULT_READY_MS, MAX_READY_MS);
		while (Date.now() < until) {
			const answer = await this.answers(spec);
			if (answer === 'other') return this.other(spec);
			if (answer === 'up') return { state: 'running', url: spec.url, reason: null };
			if (exited !== undefined) {
				this.forget(key);
				return this.failed(spec, `it stopped (exit ${exited ?? 'signal'}).`, log);
			}
			await new Promise((r) => setTimeout(r, POLL_MS));
		}
		return this.failed(spec, 'it did not answer in time; it may still be starting.', log);
	}

	private env(spec: ServiceSpec): NodeJS.ProcessEnv {
		return serviceEnv(this.host.env ?? process.env, spec);
	}

	private runToLog(
		argv: string[],
		cwd: string,
		env: NodeJS.ProcessEnv,
		log: string,
		timeoutMs: number,
		launch: Launch
	): Promise<number | null> {
		return new Promise((resolve) => {
			const fd = openSync(log, 'a');
			let child: ChildProcess;
			try {
				child = this.spawn(argv[0], argv.slice(1), { cwd, env, stdio: ['ignore', fd, fd] });
			} catch {
				closeSync(fd);
				resolve(-1);
				return;
			}
			closeSync(fd);
			launch.child = child;
			const timer = setTimeout(() => {
				child.kill('SIGTERM');
				resolve(null);
			}, timeoutMs);
			child.on('exit', (code) => {
				clearTimeout(timer);
				resolve(code ?? -1);
			});
			child.on('error', () => {
				clearTimeout(timer);
				resolve(-1);
			});
		});
	}

	private failed(spec: ServiceSpec, why: string, log: string): ServiceStatus {
		return { state: 'failed', url: spec.url, reason: `It did not start: ${why}`, log: tail(log) };
	}

	/** Whether the service answers its health check, and, when it says how, whether it is the one asked for. */
	private async answers(spec: ServiceSpec): Promise<'up' | 'down' | 'other'> {
		try {
			const r = await this.fetch(spec.health, {
				signal: AbortSignal.timeout(800),
				redirect: 'manual'
			});
			if (!r.ok) return 'down';
		} catch {
			return 'down';
		}
		const id = spec.identity;
		if (!id) return 'up';
		const present = id.value === undefined;
		let r: Response;
		try {
			r = await this.fetch(id.url, {
				signal: AbortSignal.timeout(IDENTITY_MS),
				redirect: 'manual'
			});
		} catch {
			return 'up';
		}
		let v: unknown;
		try {
			v = r.ok ? await r.json() : undefined;
		} catch {
			v = undefined;
		}
		for (const k of id.path) {
			v = typeof v === 'object' && v !== null ? (v as Record<string, unknown>)[k] : undefined;
		}
		if (v === undefined) return present ? 'other' : 'up';
		return present || v === id.value ? 'up' : 'other';
	}
}

/** Processes as `ps` reports them, and signals through `process.kill`. */
const systemProcesses: Processes = {
	startedAt: (pid) =>
		new Promise((resolve) => {
			execFile('ps', ['-o', 'etime=', '-p', String(pid)], { timeout: 5_000 }, (err, out) => {
				const elapsed = err ? null : parseElapsed(out);
				resolve(elapsed === null ? null : Date.now() - elapsed);
			});
		}),
	kill: (pid, signal) => process.kill(pid, signal)
};

/** `ps`'s elapsed time, `[[dd-]hh:]mm:ss`, in ms; null when it is not one. */
export function parseElapsed(text: string): number | null {
	const m = /^\s*(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)\s*$/.exec(text);
	if (!m) return null;
	const [d, h, min, sec] = [m[1], m[2], m[3], m[4]].map((v) => Number(v ?? 0));
	return (((d * 24 + h) * 60 + min) * 60 + sec) * 1000;
}

/** The end of a launch log, for the page to show when a start fails. */
function tail(file: string): string {
	let fd: number;
	try {
		fd = openSync(file, 'r');
	} catch {
		return '';
	}
	try {
		const size = fstatSync(fd).size;
		const buf = Buffer.alloc(Math.min(size, LOG_TAIL));
		const n = readSync(fd, buf, 0, buf.length, size - buf.length);
		const text = buf.subarray(0, n).toString('utf8');
		return size > LOG_TAIL ? `…${text}` : text;
	} catch {
		return '';
	} finally {
		closeSync(fd);
	}
}

/**
 * Host variables a service inherits when they are set, so a service that runs
 * the `claude` CLI can find the login: on macOS it looks in the Keychain by
 * user, so without USER it reports "Not logged in", and CLAUDE_CONFIG_DIR says
 * where its config lives. Everything else, secrets included, stays out unless
 * the service spec asks for it.
 */
const PASSED_THROUGH = ['USER', 'LOGNAME', 'CLAUDE_CONFIG_DIR'];

/** The environment a service runs with: a small allowlist of the host's, then its own. */
export function serviceEnv(
	host: NodeJS.ProcessEnv,
	spec: Pick<ServiceSpec, 'env'>
): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {
		PATH: host.PATH ?? '/usr/bin:/bin',
		HOME: host.HOME ?? '',
		LANG: host.LANG ?? 'C.UTF-8'
	};
	for (const key of PASSED_THROUGH) {
		const value = host[key];
		if (value !== undefined) env[key] = value;
	}
	return { ...env, ...(spec.env ?? {}) };
}
