import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { runBounded } from '../firstmate/exec';
import { TASK_ID } from '../firstmate/adapter';
import type {
	PackList,
	PackListEntry,
	PackResolve,
	PlaybooksSource,
	Read,
	ResolvedItem,
	ResolvedSkill
} from '../../playbooks';

/**
 * Reads Firstmate's playbooks through `bin/fm-pack.sh` (fm-pack.v1), read-only:
 * `version`, `list` and `resolve` only. Wheelhouse never runs install or apply;
 * those reach Firstmate as a note and its supervisor runs them.
 *
 * Feature detection: `fm-pack.sh version --json` must exist, exit 0 and name
 * the fm-pack.v1 contract, checked on start and every ten minutes. Until the
 * script lands, WHEELHOUSE_PLAYBOOK_FIXTURE can name a directory holding
 * list.json and resolve-<project>.json in the same shapes, for development;
 * a fixture is always labelled as one. With neither, the Playbook views hide.
 */

const RECHECK_MS = 10 * 60_000;
/** A failed check (the script there but failing) is tried again sooner. */
const RETRY_MS = 60_000;
const TIMEOUT_MS = 8_000;
const MAX_OUTPUT = 2 * 1024 * 1024;
/** Lists and resolves are cached briefly; packs change only when the captain applies one. */
const CACHE_MS = 30_000;
// Starts with a letter or digit, so fm-pack.sh can never read the id as an option
// (its parser has no `--` end-of-options marker).
const PROJECT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export interface PlaybookReaderOptions {
	firstmateDir: string;
	homeDir: string;
	env: NodeJS.ProcessEnv;
	/** A fixture directory (list.json, resolve-<project>.json); null for none. */
	fixtureDir?: string | null;
	now?: () => number;
	/** Called when a detection finishes with a different answer (so health can be re-sent). */
	onchange?: (source: PlaybooksSource) => void;
}

export type { Read };

export class PlaybookReader {
	private detected: { at: number; source: PlaybooksSource; retry: boolean } | null = null;
	private detecting: Promise<PlaybooksSource> | null = null;
	private cache = new Map<string, { at: number; value: Read<unknown> }>();
	private loading = new Map<string, Promise<Read<unknown>>>();
	private now: () => number;

	constructor(private opts: PlaybookReaderOptions) {
		this.now = opts.now ?? Date.now;
	}

	private get script() {
		return path.join(this.opts.firstmateDir, 'bin', 'fm-pack.sh');
	}

	/** Whether playbooks can be shown, and from where. Never throws. */
	async source(): Promise<PlaybooksSource> {
		const d = this.detected;
		if (d && this.now() - d.at < (d.retry ? RETRY_MS : RECHECK_MS)) return d.source;
		// Callers at the same time share one run of the script.
		this.detecting ??= this.detect()
			.catch((): Detection => ({
				source: { available: false, reason: 'Checking for playbooks failed.' },
				retry: true
			}))
			.then(({ source, retry }) => {
				const before = this.detected?.source;
				this.detected = { at: this.now(), source, retry };
				if (JSON.stringify(before) !== JSON.stringify(source)) {
					// A listener's failure must never break detection.
					try {
						this.opts.onchange?.(source);
					} catch {
						/* ignored */
					}
				}
				return source;
			})
			.finally(() => (this.detecting = null));
		return this.detecting;
	}

	/** The last detection without waiting (null before the first). */
	known(): PlaybooksSource | null {
		return this.detected?.source ?? null;
	}

	/** Never throws; `retry` marks an answer worth checking again soon. */
	private async detect(): Promise<Detection> {
		// Present but not executable is a broken install, shown as one; only absent uses the fixture.
		const exists = await access(this.script).then(
			() => true,
			() => false
		);
		if (exists) {
			const runnable = await access(this.script, constants.X_OK).then(
				() => true,
				() => false
			);
			if (!runnable)
				return {
					source: { available: false, reason: 'bin/fm-pack.sh is there but cannot be run.' },
					retry: true
				};
			// A real fm-pack.sh that fails is shown as failing, never covered by the fixture.
			const r = await this.run(['version', '--json']);
			if (!r.ok) return { source: { available: false, reason: r.reason }, retry: true };
			const v = isRecord(r.value) ? r.value : {};
			const contracts = Array.isArray(v.contracts) ? v.contracts : [];
			if (v.schema === 'fm-pack.v1' || contracts.includes('fm-pack.v1')) {
				return {
					source: {
						available: true,
						source: 'fm-pack',
						phase: v.phase === 'A' || v.phase === 'B' ? v.phase : null
					},
					retry: false
				};
			}
			return {
				source: { available: false, reason: 'fm-pack.sh does not report the fm-pack.v1 contract.' },
				retry: false
			};
		}
		if (this.opts.fixtureDir) {
			const ok = await access(path.join(this.opts.fixtureDir, 'list.json')).then(
				() => true,
				() => false
			);
			if (ok) return { source: { available: true, source: 'fixture', phase: 'A' }, retry: false };
		}
		return {
			source: {
				available: false,
				reason: 'This Firstmate has no playbooks (bin/fm-pack.sh is absent).'
			},
			retry: false
		};
	}

	async list(): Promise<Read<PackList>> {
		return this.cached('list', async () => {
			const src = await this.source();
			if (!src.available) return { ok: false, reason: src.reason };
			const r =
				src.source === 'fixture'
					? await this.fixture('list.json')
					: await this.run(['list', '--json']);
			return r.ok && isSchema(r.value) && Array.isArray(r.value.packs)
				? { ok: true, value: listWithDefaults(r.value as unknown as PackList) }
				: { ok: false, reason: r.ok ? 'fm-pack.sh list gave an unexpected answer.' : r.reason };
		});
	}

	async resolve(project: string, task?: string): Promise<Read<PackResolve>> {
		if (!PROJECT.test(project)) return { ok: false, reason: 'Not a project id.' };
		if (task !== undefined && !TASK_ID.test(task)) return { ok: false, reason: 'Not a task id.' };
		return this.cached(`resolve ${project} ${task ?? ''}`, async () => {
			const src = await this.source();
			if (!src.available) return { ok: false, reason: src.reason };
			const r =
				src.source === 'fixture'
					? await this.fixture(`resolve-${project}.json`, unbound(project))
					: await this.run(['resolve', project, ...(task ? ['--task', task] : []), '--json']);
			return r.ok && isSchema(r.value) && Array.isArray(r.value.skills)
				? { ok: true, value: withDefaults(r.value as unknown as PackResolve) }
				: { ok: false, reason: r.ok ? 'fm-pack.sh resolve gave an unexpected answer.' : r.reason };
		});
	}

	/** Cached briefly (a failure is not kept), and callers at the same time share one load. */
	private async cached<T>(key: string, load: () => Promise<Read<T>>): Promise<Read<T>> {
		const hit = this.cache.get(key);
		if (hit && this.now() - hit.at < CACHE_MS) return hit.value as Read<T>;
		let pending = this.loading.get(key);
		if (!pending) {
			pending = load()
				.catch((): Read<T> => ({ ok: false, reason: 'Reading the playbooks failed.' }))
				.then((value) => {
					if (value.ok) this.cache.set(key, { at: this.now(), value });
					else this.cache.delete(key);
					return value;
				})
				.finally(() => this.loading.delete(key));
			this.loading.set(key, pending);
		}
		return pending as Promise<Read<T>>;
	}

	private async run(args: string[]): Promise<Read<unknown>> {
		const r = await runBounded(this.script, args, {
			cwd: this.opts.firstmateDir,
			env: { ...this.opts.env, FM_HOME: this.opts.homeDir },
			timeoutMs: TIMEOUT_MS,
			maxOutputBytes: MAX_OUTPUT
		});
		if (!r.ok) return { ok: false, reason: `fm-pack.sh ${args[0]} failed: ${r.message}` };
		try {
			return { ok: true, value: JSON.parse(r.stdout) };
		} catch {
			return { ok: false, reason: `fm-pack.sh ${args[0]} did not print JSON.` };
		}
	}

	private async fixture(name: string, fallback?: unknown): Promise<Read<unknown>> {
		try {
			return {
				ok: true,
				value: JSON.parse(await readFile(path.join(this.opts.fixtureDir!, name), 'utf8'))
			};
		} catch (e) {
			if (fallback !== undefined && (e as NodeJS.ErrnoException).code === 'ENOENT')
				return { ok: true, value: fallback };
			return { ok: false, reason: `Playbook fixture ${name} could not be read.` };
		}
	}
}

type Detection = { source: PlaybooksSource; retry: boolean };

const isRecord = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);
const isSchema = (v: unknown): v is Record<string, unknown> =>
	isRecord(v) && v.schema === 'fm-pack.v1';
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const obj = (v: unknown) => (isRecord(v) ? v : {});

/** An unbound project, as resolve reports one: nothing changes for its workers. */
export const unbound = (project: string): PackResolve => ({
	schema: 'fm-pack.v1',
	project,
	binding: null,
	skills: [],
	banned: [],
	hooks: [],
	mcp: [],
	settings_keys: [],
	verify_commands: [],
	preamble: null,
	model_hint: null,
	evidence: null,
	project_settings: null,
	ignored: [],
	readiness: { ok: true, note: 'no pack bound', missing: [], warnings: [], refusals: [] }
});

/** A readiness warning or refusal: text, or {code, detail?}; anything else becomes text. */
function notice(v: unknown): string | { code: string; detail?: string } {
	if (typeof v === 'string') return v;
	if (isRecord(v) && typeof v.code === 'string') {
		const detail = v.detail === undefined || v.detail === null ? null : plain(v.detail);
		return detail ? { code: v.code, detail } : { code: v.code };
	}
	return v === undefined || v === null ? 'unknown' : plain(v);
}

/** Any JSON value as short readable text (objects as JSON, never "[object Object]"). */
function plain(v: unknown): string {
	if (typeof v === 'string') return v;
	let t: string;
	try {
		t = typeof v === 'object' ? (JSON.stringify(v) ?? String(v)) : String(v);
	} catch {
		t = String(v);
	}
	return t.length > 200 ? `${t.slice(0, 199)}…` : t;
}

/** One listed pack with every field the views read filled in. */
function packWithDefaults(raw: unknown): PackListEntry {
	const p = obj(raw);
	const c = obj(p.contents);
	const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
	const s = isRecord(p.source) ? p.source : null;
	return {
		...(p as unknown as PackListEntry),
		name: String(p.name ?? '?'),
		version: String(p.version ?? '?'),
		digest: String(p.digest ?? ''),
		source: s
			? {
					repo: String(s.repo ?? ''),
					commit: String(s.commit ?? ''),
					...(s.path ? { path: String(s.path) } : {})
				}
			: null,
		installed_at: typeof p.installed_at === 'string' ? p.installed_at : null,
		contents: { skills: n(c.skills), hooks: n(c.hooks), mcp: n(c.mcp) },
		risk: arr<unknown>(p.risk).map(String),
		update: isRecord(p.update) ? (p.update as PackListEntry['update']) : null,
		bound_projects: arr<unknown>(p.bound_projects)
			.filter(isRecord)
			.map((b) => ({ project: String(b.project ?? ''), digest: String(b.digest ?? '') }))
	};
}

function listWithDefaults(l: PackList): PackList {
	return { ...l, packs: arr<unknown>(l.packs).filter(isRecord).map(packWithDefaults) };
}

/** An item's delivery as a map or one value; anything else counts as unknown (an empty map). */
const delivery = (v: unknown) =>
	typeof v === 'string' || isRecord(v) ? (v as ResolvedItem['delivery']) : {};

const itemWithDefaults = (raw: unknown): ResolvedItem => {
	const i = obj(raw);
	return {
		...i,
		id: String(i.id ?? '?'),
		origin: (i.origin ?? 'pack') as ResolvedItem['origin'],
		delivery: delivery(i.delivery)
	};
};

const skillWithDefaults = (raw: unknown): ResolvedSkill => {
	const s = obj(raw);
	return {
		...(s as unknown as ResolvedSkill),
		id: String(s.id ?? s.name ?? '?'),
		name: String(s.name ?? s.id ?? '?'),
		kinds: arr<unknown>(s.kinds).map(String),
		phase: (['build', 'verify', 'review', 'task'].includes(s.phase as string)
			? s.phase
			: 'task') as ResolvedSkill['phase'],
		source: String(s.source ?? ''),
		origin: (s.origin ?? 'pack') as ResolvedSkill['origin'],
		state: s.state === 'disabled' ? 'disabled' : 'active',
		conditional: isRecord(s.conditional) ? (s.conditional as ResolvedSkill['conditional']) : null,
		delivery: delivery(s.delivery)
	};
};

/** Fill every field a view reads, per item too, so an older or partial answer still renders. */
function withDefaults(r: PackResolve): PackResolve {
	const rd = obj(r.readiness);
	const b = isRecord(r.binding) ? r.binding : null;
	return {
		...r,
		binding: b
			? {
					pack: String(b.pack ?? '?'),
					version: String(b.version ?? '?'),
					digest: String(b.digest ?? ''),
					binding_digest: String(b.binding_digest ?? '')
				}
			: null,
		skills: arr<unknown>(r.skills).filter(isRecord).map(skillWithDefaults),
		banned: arr<unknown>(r.banned).filter(isRecord).map(itemWithDefaults),
		hooks: arr<unknown>(r.hooks).filter(isRecord).map(itemWithDefaults),
		mcp: arr<unknown>(r.mcp).filter(isRecord).map(itemWithDefaults),
		settings_keys: arr<unknown>(r.settings_keys).map(String),
		verify_commands: arr<unknown>(r.verify_commands)
			.filter(isRecord)
			.map((v) => ({
				id: String(v.id ?? '?'),
				cmd: String(v.cmd ?? ''),
				origin: (v.origin ?? 'pack') as PackResolve['verify_commands'][number]['origin']
			})),
		preamble: isRecord(r.preamble) ? (r.preamble as PackResolve['preamble']) : null,
		model_hint: isRecord(r.model_hint) ? (r.model_hint as PackResolve['model_hint']) : null,
		evidence: isRecord(r.evidence)
			? { required: arr<unknown>(r.evidence.required).map(String) }
			: null,
		project_settings: isRecord(r.project_settings)
			? (r.project_settings as PackResolve['project_settings'])
			: null,
		ignored: arr<unknown>(r.ignored)
			.filter(isRecord)
			.map((x) => ({ item: String(x.item ?? '?'), reason: String(x.reason ?? '') })),
		readiness: {
			...(rd as Partial<PackResolve['readiness']>),
			ok: rd.ok !== false,
			missing: arr<unknown>(rd.missing).map(String),
			warnings: arr<unknown>(rd.warnings).map(notice),
			refusals: arr<unknown>(rd.refusals).map(notice)
		}
	};
}
