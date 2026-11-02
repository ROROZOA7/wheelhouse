import { describe, expect, it } from 'vitest';
import type { ServiceSpec, ServiceStatus } from '../../plugins/types';
import {
	AUTO_WINDOW_MS,
	MAX_AUTO_STARTS,
	RETRY_MS,
	serviceKey,
	ServiceSupervisor,
	type ServiceRef
} from './autostart';
import type { ServiceManager } from './services';
import type { ServiceResolution } from './types';

/**
 * The supervisor's policy against a fake manager: it starts what should run,
 * stops only what it started once its plugin is off, never stops anything on
 * an uncertain answer, and gives up on a service that will not stay up.
 */

const spec = (port: number, o: Partial<ServiceSpec> = {}): ServiceSpec => ({
	url: `http://127.0.0.1:${port}`,
	health: `http://127.0.0.1:${port}/health`,
	argv: ['serve'],
	cwd: '/tmp',
	binds: 'loopback',
	...o
});

/** A manager whose services run when started, unless `fails` names them. */
class FakeManager {
	running = new Set<string>();
	ours = new Set<string>();
	fails = new Set<string>();
	launches: string[] = [];
	stops: string[] = [];
	pending = new Map<string, Promise<ServiceStatus>>();

	async status(key: string, s: ServiceSpec): Promise<ServiceStatus> {
		if (this.pending.has(key)) return { state: 'starting', url: s.url, reason: null };
		return this.running.has(key)
			? { state: 'running', url: s.url, reason: null }
			: { state: 'stopped', url: s.url, reason: null };
	}

	launch(key: string, s: ServiceSpec): Promise<ServiceStatus> {
		const p = this.pending.get(key);
		if (p) return p;
		this.launches.push(key);
		const done = Promise.resolve().then((): ServiceStatus => {
			this.pending.delete(key);
			if (this.fails.has(key)) {
				return { state: 'failed', url: s.url, reason: 'It did not start: boom.', log: 'boom\n' };
			}
			this.running.add(key);
			this.ours.add(key);
			return { state: 'running', url: s.url, reason: null };
		});
		this.pending.set(key, done);
		return done;
	}

	started() {
		return [...this.ours];
	}

	async stop(key: string) {
		if (!this.ours.has(key)) return false;
		this.stops.push(key);
		this.ours.delete(key);
		this.running.delete(key);
		return true;
	}

	starting() {
		return [...this.pending.keys()];
	}

	log() {
		return 'the log\n';
	}
}

function setup(
	refs: ServiceRef[],
	o: { complete?: boolean; specs?: Record<string, ServiceResolution> } = {}
) {
	const manager = new FakeManager();
	const state = { refs, complete: o.complete ?? true, now: 1_000_000 };
	const sup = new ServiceSupervisor({
		manager: manager as unknown as ServiceManager,
		wanted: async () => ({ refs: state.refs, complete: state.complete }),
		resolve: async (ref) =>
			o.specs?.[serviceKey(ref)] ?? { available: true, spec: spec(4000 + state.refs.indexOf(ref)) },
		now: () => state.now,
		log: () => {}
	});
	const settle = () => Promise.all([...manager.pending.values()]);
	return { manager, state, sup, settle };
}

const docket = (project: string): ServiceRef => ({ plugin: 'docket', service: 'viewer', project });
const review: ServiceRef = { plugin: 'review', service: 'engine', project: null };

describe('ServiceSupervisor', () => {
	it('starts every service whose plugin is on, for the fleet and for each project', async () => {
		const { manager, sup, settle } = setup([docket('alpha'), docket('beta'), review]);
		await sup.reconcile();
		await settle();
		expect(manager.launches.sort()).toEqual([
			'docket-viewer-alpha',
			'docket-viewer-beta',
			'review-engine'
		]);
		// Running ones are left alone.
		await sup.reconcile();
		expect(manager.launches).toHaveLength(3);
	});

	it('leaves one it cannot start: unavailable, or listening on every interface', async () => {
		const { manager, sup, settle } = setup([docket('alpha'), review], {
			specs: {
				'docket-viewer-alpha': { available: false, reason: 'no .docket here' },
				'review-engine': { available: true, spec: spec(4100, { binds: 'all' }) }
			}
		});
		await sup.reconcile();
		await settle();
		expect(manager.launches).toEqual([]);
	});

	it('stops only what it started once the plugin is off, and nothing on an uncertain answer', async () => {
		const { manager, state, sup, settle } = setup([docket('alpha'), docket('beta')]);
		await sup.reconcile();
		await settle();
		// Something Wheelhouse did not start, still running.
		manager.running.add('other-ui');
		state.refs = [docket('alpha')];
		state.complete = false;
		await sup.reconcile();
		expect(manager.stops).toEqual([]);
		state.complete = true;
		await sup.reconcile();
		expect(manager.stops).toEqual(['docket-viewer-beta']);
		expect(manager.running.has('other-ui')).toBe(true);
		// Back on: it starts again.
		state.refs = [docket('alpha'), docket('beta')];
		await sup.reconcile();
		await settle();
		expect(manager.running.has('docket-viewer-beta')).toBe(true);
	});

	it('starts one a page finds stopped, answering at once or once it is up', async () => {
		const { manager, sup, settle } = setup([]);
		expect(await sup.ensure('docket-viewer-alpha', spec(4200), 'background')).toEqual({
			state: 'starting',
			url: 'http://127.0.0.1:4200',
			reason: null
		});
		// A chat app waits for the start already under way, rather than starting a second.
		expect(await sup.ensure('docket-viewer-alpha', spec(4200), 'wait')).toMatchObject({
			state: 'running'
		});
		await settle();
		expect(manager.launches).toEqual(['docket-viewer-alpha']);
		expect(await sup.ensure('review-engine', spec(4201), 'wait')).toMatchObject({
			state: 'running'
		});
	});

	it('restarts one that stops, a bounded number of times, then shows why and waits for Launch', async () => {
		const { manager, state, sup, settle } = setup([review]);
		manager.fails.add('review-engine');
		for (let i = 0; i < MAX_AUTO_STARTS; i++) {
			await sup.reconcile();
			await settle();
			// Too soon after a failure: the failure shows, and nothing starts.
			expect(await sup.ensure('review-engine', spec(4000), 'background')).toMatchObject({
				state: 'failed',
				reason: 'It did not start: boom.'
			});
			state.now += RETRY_MS;
		}
		expect(manager.launches).toHaveLength(MAX_AUTO_STARTS);
		await sup.reconcile();
		const given = await sup.ensure('review-engine', spec(4000), 'background');
		expect(given).toMatchObject({ state: 'failed', log: 'boom\n' });
		expect(given.reason).toContain('no longer starts it on its own; Launch starts it again.');
		expect(given.reason).toContain('It did not start: boom.');
		// Not even once the window has passed.
		state.now += AUTO_WINDOW_MS;
		await sup.reconcile();
		expect(manager.launches).toHaveLength(MAX_AUTO_STARTS);

		// Launch starts it whatever happened before.
		manager.fails.clear();
		expect(await sup.ensure('review-engine', spec(4000), 'launch')).toMatchObject({
			state: 'running'
		});
		// And, once it stops again later, it is started on its own again.
		manager.running.delete('review-engine');
		await sup.reconcile();
		await settle();
		expect(manager.running.has('review-engine')).toBe(true);
	});

	it('counts a service that came up and then crashed against the bound', async () => {
		const { manager, state, sup, settle } = setup([review]);
		for (let i = 0; i < MAX_AUTO_STARTS; i++) {
			await sup.reconcile();
			await settle();
			manager.running.delete('review-engine');
			state.now += RETRY_MS;
		}
		await sup.reconcile();
		await settle();
		expect(manager.launches).toHaveLength(MAX_AUTO_STARTS);
		const given = await sup.ensure('review-engine', spec(4000), 'background');
		expect(given).toMatchObject({ state: 'failed', log: 'the log\n' });
	});

	it('waits between starts of a service that came up and then crashed', async () => {
		const { manager, state, sup, settle } = setup([review]);
		await sup.reconcile();
		await settle();
		manager.running.delete('review-engine');
		// Pages asking again and again, straight after the crash: nothing starts.
		for (let i = 0; i < MAX_AUTO_STARTS + 1; i++) {
			expect(await sup.ensure('review-engine', spec(4000), 'background')).toMatchObject({
				state: 'stopped'
			});
		}
		expect(manager.launches).toHaveLength(1);
		state.now += RETRY_MS;
		await sup.reconcile();
		await settle();
		expect(manager.launches).toHaveLength(2);
		expect(manager.running.has('review-engine')).toBe(true);
	});

	it('shows a start that threw as failed, rather than an unhandled rejection', async () => {
		const { manager, sup } = setup([]);
		manager.launch = () => Promise.reject(new Error('EACCES: permission denied'));
		await sup.ensure('review-engine', spec(4000), 'background');
		await Promise.resolve();
		expect(await sup.ensure('review-engine', spec(4000), 'wait')).toMatchObject({
			state: 'failed',
			reason: 'It did not start: EACCES: permission denied.',
			log: 'the log\n'
		});
	});

	it('turning the plugin off and on again starts afresh', async () => {
		const { manager, state, sup, settle } = setup([review]);
		manager.fails.add('review-engine');
		for (let i = 0; i <= MAX_AUTO_STARTS; i++) {
			await sup.reconcile();
			await settle();
			state.now += RETRY_MS;
		}
		expect(manager.launches).toHaveLength(MAX_AUTO_STARTS);
		state.refs = [];
		await sup.reconcile();
		state.refs = [review];
		manager.fails.clear();
		await sup.reconcile();
		await settle();
		expect(manager.running.has('review-engine')).toBe(true);
	});

	it('runs one pass at a time, and one more when asked during a pass', async () => {
		let calls = 0;
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const sup = new ServiceSupervisor({
			manager: new FakeManager() as unknown as ServiceManager,
			wanted: async () => {
				calls++;
				if (calls === 1) await gate;
				return { refs: [], complete: true };
			},
			resolve: async () => null,
			log: () => {}
		});
		const first = sup.reconcile();
		void sup.reconcile();
		void sup.reconcile();
		release();
		await first;
		await new Promise((r) => setTimeout(r, 10));
		expect(calls).toBe(2);
	});
});
