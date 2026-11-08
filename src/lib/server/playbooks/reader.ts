import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { runBounded } from '../firstmate/exec';
import type { PackList, PackResolve, PlaybooksSource } from '../../playbooks';

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
const TIMEOUT_MS = 8_000;
const MAX_OUTPUT = 2 * 1024 * 1024;
/** Lists and resolves are cached briefly; packs change only when the captain applies one. */
const CACHE_MS = 30_000;
const PROJECT = /^[A-Za-z0-9._-]{1,100}$/;

export interface PlaybookReaderOptions {
	firstmateDir: string;
	homeDir: string;
	env: NodeJS.ProcessEnv;
	/** A fixture directory (list.json, resolve-<project>.json); null for none. */
	fixtureDir?: string | null;
	now?: () => number;
}

export type Read<T> = { ok: true; value: T } | { ok: false; reason: string };

export class PlaybookReader {
	private detected: { at: number; source: PlaybooksSource } | null = null;
	private cache = new Map<string, { at: number; value: Read<unknown> }>();
	private now: () => number;

	constructor(private opts: PlaybookReaderOptions) {
		this.now = opts.now ?? Date.now;
	}

	private get script() {
		return path.join(this.opts.firstmateDir, 'bin', 'fm-pack.sh');
	}

	/** Whether playbooks can be shown, and from where. Never throws. */
	async source(): Promise<PlaybooksSource> {
		if (this.detected && this.now() - this.detected.at < RECHECK_MS) return this.detected.source;
		const source = await this.detect();
		this.detected = { at: this.now(), source };
		return source;
	}

	/** The last detection without waiting (null before the first). */
	known(): PlaybooksSource | null {
		return this.detected?.source ?? null;
	}

	private async detect(): Promise<PlaybooksSource> {
		const exists = await access(this.script, constants.X_OK).then(
			() => true,
			() => false
		);
		if (exists) {
			const r = await this.run(['version', '--json']);
			if (r.ok) {
				const v = r.value as { schema?: unknown; contracts?: unknown; phase?: unknown };
				const contracts = Array.isArray(v.contracts) ? v.contracts : [];
				if (v.schema === 'fm-pack.v1' || contracts.includes('fm-pack.v1')) {
					return {
						available: true,
						source: 'fm-pack',
						phase: v.phase === 'A' || v.phase === 'B' ? v.phase : null
					};
				}
				return { available: false, reason: 'fm-pack.sh does not report the fm-pack.v1 contract.' };
			}
			if (!this.opts.fixtureDir) return { available: false, reason: r.reason };
		}
		if (this.opts.fixtureDir) {
			const ok = await access(path.join(this.opts.fixtureDir, 'list.json')).then(
				() => true,
				() => false
			);
			if (ok) return { available: true, source: 'fixture', phase: 'A' };
		}
		return {
			available: false,
			reason: 'This Firstmate has no playbooks (bin/fm-pack.sh is absent).'
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
			return r.ok && isSchema(r.value) && Array.isArray((r.value as PackList).packs)
				? { ok: true, value: r.value as PackList }
				: { ok: false, reason: r.ok ? 'fm-pack.sh list gave an unexpected answer.' : r.reason };
		});
	}

	async resolve(project: string): Promise<Read<PackResolve>> {
		if (!PROJECT.test(project)) return { ok: false, reason: 'Not a project id.' };
		return this.cached(`resolve ${project}`, async () => {
			const src = await this.source();
			if (!src.available) return { ok: false, reason: src.reason };
			const r =
				src.source === 'fixture'
					? await this.fixture(`resolve-${project}.json`, unbound(project))
					: await this.run(['resolve', project, '--json']);
			return r.ok && isSchema(r.value) && Array.isArray((r.value as PackResolve).skills)
				? { ok: true, value: withDefaults(r.value as PackResolve) }
				: { ok: false, reason: r.ok ? 'fm-pack.sh resolve gave an unexpected answer.' : r.reason };
		});
	}

	private async cached<T>(key: string, load: () => Promise<Read<T>>): Promise<Read<T>> {
		const hit = this.cache.get(key);
		if (hit && this.now() - hit.at < CACHE_MS) return hit.value as Read<T>;
		const value = await load();
		this.cache.set(key, { at: this.now(), value });
		return value;
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

const isSchema = (v: unknown) =>
	!!v && typeof v === 'object' && (v as { schema?: unknown }).schema === 'fm-pack.v1';

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

/** Fill the lists a reader relies on, so an older or partial answer still renders. */
function withDefaults(r: PackResolve): PackResolve {
	const rd = r.readiness ?? { ok: true, missing: [], warnings: [], refusals: [] };
	return {
		...r,
		binding: r.binding ?? null,
		banned: r.banned ?? [],
		hooks: r.hooks ?? [],
		mcp: r.mcp ?? [],
		settings_keys: r.settings_keys ?? [],
		verify_commands: r.verify_commands ?? [],
		preamble: r.preamble ?? null,
		model_hint: r.model_hint ?? null,
		evidence: r.evidence ?? null,
		project_settings: r.project_settings ?? null,
		ignored: r.ignored ?? [],
		readiness: {
			...rd,
			missing: rd.missing ?? [],
			warnings: rd.warnings ?? [],
			refusals: rd.refusals ?? []
		}
	};
}
