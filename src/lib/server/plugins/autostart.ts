import type { ServiceSpec, ServiceStatus } from '../../plugins/types';
import { launchable, type ServiceManager } from './services';
import type { ServiceResolution } from './types';

/**
 * Keeps plugin companion services running wherever their plugin is on: it
 * starts each one Wheelhouse can start (on loopback alone, nothing else at its
 * address) for the fleet or for every project the plugin is on for, when
 * Wheelhouse starts, whenever the plugins file changes and once a minute; and
 * stops each one it started once its plugin is off there or gone. A page, a
 * chat app or an element that finds one stopped starts it then, too.
 *
 * Starting on its own is bounded: a service that fails to start, or stops
 * again, is started at most MAX_AUTO_STARTS times in AUTO_WINDOW_MS, at least
 * RETRY_MS apart; after that it shows the failure, and only Launch (or turning
 * the plugin off and on) starts it again.
 */

export interface ServiceRef {
	plugin: string;
	service: string;
	project: string | null;
}

/** The key a service's log and record go under. */
export const serviceKey = (r: ServiceRef): string =>
	`${r.plugin}-${r.service}${r.project ? `-${r.project}` : ''}`;

export const MAX_AUTO_STARTS = 3;
export const AUTO_WINDOW_MS = 10 * 60_000;
export const RETRY_MS = 20_000;
const FIRST_LOOK_MS = 1_000;

export interface SupervisorDeps {
	manager: ServiceManager;
	/**
	 * Every service whose plugin is on where it runs; `complete` false when
	 * that cannot be told for certain (the fleet not read yet, or the plugins
	 * file broken), so nothing is stopped for being missing.
	 */
	wanted(): Promise<{ refs: ServiceRef[]; complete: boolean }>;
	/** The service as its plugin resolves it there, or null when there is no such service. */
	resolve(ref: ServiceRef): Promise<ServiceResolution | null>;
	now?: () => number;
	log?: (line: string) => void;
}

/** How a caller wants a stopped service handled. */
export type Ensure =
	/** Start it if it may be, and answer now (`starting`) rather than wait. */
	| 'background'
	/** Start it if it may be, and answer once it is up or has failed. */
	| 'wait'
	/** The captain's Launch: start it whatever happened before, and wait. */
	| 'launch';

interface Tries {
	/** When Wheelhouse started it on its own, within the window. */
	at: number[];
	/** How the last start it made on its own ended, when it failed. */
	failure: ServiceStatus | null;
	/** Wheelhouse has stopped starting it on its own. */
	gaveUp: boolean;
}

export class ServiceSupervisor {
	private readonly tries = new Map<string, Tries>();
	private readonly now: () => number;
	private readonly log: (line: string) => void;
	private pass: Promise<void> | null = null;
	private again = false;
	private timer: ReturnType<typeof setInterval> | null = null;
	private first: ReturnType<typeof setInterval> | null = null;

	constructor(private readonly deps: SupervisorDeps) {
		this.now = deps.now ?? Date.now;
		this.log = deps.log ?? ((line) => console.log(line));
	}

	/** The manager that starts and stops the processes. */
	get manager(): ServiceManager {
		return this.deps.manager;
	}

	/**
	 * Reconcile as soon as `ready` says the fleet has been read (looking every
	 * second until then), and every `everyMs` after that.
	 */
	watch(everyMs: number, ready: () => boolean): void {
		this.close();
		const tick = () => {
			if (ready()) void this.reconcile();
		};
		this.first = setInterval(() => {
			if (!ready()) return;
			if (this.first) clearInterval(this.first);
			this.first = null;
			tick();
			this.timer = setInterval(tick, everyMs);
			this.timer.unref?.();
		}, FIRST_LOOK_MS);
		this.first.unref?.();
	}

	close(): void {
		if (this.first) clearInterval(this.first);
		if (this.timer) clearInterval(this.timer);
		this.first = null;
		this.timer = null;
	}

	/**
	 * Start what should run and stop what Wheelhouse started that should not.
	 * Passes never overlap: one asked for during a pass runs once it ends.
	 */
	reconcile(): Promise<void> {
		if (this.pass) {
			this.again = true;
			return this.pass;
		}
		this.pass = this.once()
			.catch((e) =>
				this.log(`Services:   could not check plugin services: ${(e as Error).message}`)
			)
			.finally(() => {
				this.pass = null;
				if (this.again) {
					this.again = false;
					void this.reconcile();
				}
			});
		return this.pass;
	}

	private async once(): Promise<void> {
		const { refs, complete } = await this.deps.wanted();
		const want = new Set(refs.map(serviceKey));
		await Promise.all(
			refs.map(async (ref) => {
				const res = await this.deps.resolve(ref);
				if (res?.available) await this.ensure(serviceKey(ref), res.spec, 'background');
			})
		);
		if (!complete) return;
		for (const key of this.tries.keys()) if (!want.has(key)) this.tries.delete(key);
		for (const key of this.deps.manager.started()) {
			if (want.has(key)) continue;
			if (await this.deps.manager.stop(key)) {
				this.log(`Services:   stopped ${key}; its plugin is off there now.`);
			}
		}
	}

	/**
	 * The service's status, after starting it when it is stopped and may be
	 * started: with `launch` always, else unless Wheelhouse has stopped
	 * starting it on its own.
	 */
	async ensure(key: string, spec: ServiceSpec, how: Ensure): Promise<ServiceStatus> {
		const { manager } = this.deps;
		if (how === 'launch') {
			this.tries.delete(key);
			return manager.launch(key, spec);
		}
		const status = await manager.status(key, spec);
		// A start already under way: wait for it (launch shares it, never starting a second).
		if (status.state === 'starting' && how === 'wait') return manager.launch(key, spec);
		if (status.state !== 'stopped' || !launchable(spec, status)) return status;
		const now = this.now();
		const t = this.tries.get(key) ?? { at: [], failure: null, gaveUp: false };
		this.tries.set(key, t);
		t.at = t.at.filter((at) => now - at < AUTO_WINDOW_MS);
		if (t.gaveUp) return this.givenUp(key, spec, t);
		const last = t.at.at(-1);
		if (last !== undefined && now - last < RETRY_MS) return t.failure ?? status;
		if (t.at.length >= MAX_AUTO_STARTS) {
			t.gaveUp = true;
			this.log(`Services:   ${key} did not stay up, so Wheelhouse no longer starts it on its own.`);
			return this.givenUp(key, spec, t);
		}
		t.at.push(now);
		this.log(`Services:   starting ${key}${t.at.length > 1 ? ' again; it was not running' : ''}.`);
		const done = manager
			.launch(key, spec)
			.catch(
				(e): ServiceStatus => ({
					state: 'failed',
					url: spec.url,
					reason: `It did not start: ${(e as Error).message}.`,
					log: manager.log(key)
				})
			)
			.then((s) => {
				t.failure = s.state === 'failed' ? s : null;
				return s;
			});
		return how === 'wait' ? done : { state: 'starting', url: spec.url, reason: null };
	}

	private givenUp(key: string, spec: ServiceSpec, t: Tries): ServiceStatus {
		const why = t.failure?.reason ? ` ${t.failure.reason}` : '';
		return {
			state: 'failed',
			url: spec.url,
			reason: `Wheelhouse started it ${MAX_AUTO_STARTS} times and it did not stay up, so it no longer starts it on its own; Launch starts it again.${why}`,
			log: t.failure?.log ?? this.deps.manager.log(key)
		};
	}
}
