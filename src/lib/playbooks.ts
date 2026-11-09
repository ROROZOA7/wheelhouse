/**
 * Firstmate's per-project playbooks (skill packs), as `fm-pack.sh` reports them
 * (contract fm-pack.v1, docs/playbooks-contracts.md §3). Wheelhouse only reads
 * them: list, show and resolve. Packs, bindings and their consent belong to
 * Firstmate. Readers ignore fields they do not know.
 */

export const HARNESSES = ['claude', 'codex', 'opencode', 'pi'] as const;
export type Harness = (typeof HARNESSES)[number];
export type Delivery = 'enforced' | 'advisory' | 'unsupported';
/** Per harness when resolve ran without --harness, else one value. */
export type DeliveryMap = Partial<Record<Harness, Delivery>> | Delivery;
export type Origin = 'pack' | 'binding' | 'repo' | 'global';

export interface PackListEntry {
	name: string;
	version: string;
	digest: string;
	source: { repo: string; commit: string; path?: string } | null;
	installed_at: string | null;
	contents: { skills: number; hooks: number; mcp: number };
	risk: string[];
	update: { latest_commit: string; checked_at: string } | null;
	bound_projects: { project: string; digest: string }[];
}

export interface PackList {
	schema: 'fm-pack.v1';
	packs: PackListEntry[];
}

export interface ResolvedSkill {
	id: string;
	name: string;
	phase: 'build' | 'verify' | 'review' | 'task';
	kinds?: string[];
	source: string;
	path?: string;
	origin: Origin;
	state: 'active' | 'disabled';
	conditional: { when: string; holds: boolean } | null;
	delivery: DeliveryMap;
}

export interface ResolvedItem {
	id: string;
	kind?: string;
	origin: Origin;
	delivery: DeliveryMap;
	[k: string]: unknown;
}

export interface ProjectSettings {
	mode: string | null;
	yolo: boolean | string | null;
	branch_prefix: string | null;
	forge: string | null;
	pr_text_mode?: string | null;
	merge_policy: Record<string, unknown> | null;
	sandbox_floor?: string | null;
	owner: 'captain';
}

export interface Readiness {
	ok: boolean;
	note?: string;
	missing: string[];
	warnings: (string | { code: string; detail?: string })[];
	refusals: (string | { code: string; detail?: string })[];
}

export interface PackResolve {
	schema: 'fm-pack.v1';
	project: string;
	binding: { pack: string; version: string; digest: string; binding_digest: string } | null;
	skills: ResolvedSkill[];
	banned: ResolvedItem[];
	hooks: ResolvedItem[];
	mcp: ResolvedItem[];
	settings_keys: string[];
	verify_commands: { id: string; cmd: string; origin: Origin }[];
	preamble: { path: string } | null;
	model_hint: { value: string | null; owner: 'dispatch' } | null;
	evidence: { required: string[] } | null;
	project_settings: ProjectSettings | null;
	ignored: { item: string; reason: string }[];
	readiness: Readiness;
}

/** What Wheelhouse can tell about Firstmate's playbooks right now. */
export type PlaybooksSource =
	| { available: true; source: 'fm-pack' | 'fixture'; phase: 'A' | 'B' | null }
	| { available: false; reason: string };

export const ORIGIN_LABEL: Record<Origin, string> = {
	pack: 'Pack',
	binding: 'Project binding',
	repo: 'Repository (narrows only)',
	global: 'Global'
};

export const DELIVERY_LABEL: Record<Delivery, string> = {
	enforced: 'Enforced',
	advisory: 'Advisory',
	unsupported: 'Unsupported'
};

/** One harness's delivery for an item, whichever form resolve used. */
export function deliveryFor(d: DeliveryMap, h: Harness): Delivery | null {
	return typeof d === 'string' ? d : (d[h] ?? null);
}

/** A readiness code, whether resolve wrote it as text or as {code}. */
export const codeOf = (r: string | { code: string; detail?: string }) =>
	typeof r === 'string' ? r : r.detail ? `${r.code}: ${r.detail}` : r.code;

/** The rows of the delivery matrix: every item with its kind, in display order. */
export function matrixRows(
	r: PackResolve
): { kind: string; label: string; delivery: DeliveryMap; state?: string }[] {
	// resolve gives one row per (phase, skill); delivery is the skill's, so list each skill once.
	const skills = new Map<string, ResolvedSkill>();
	for (const s of r.skills) {
		const seen = skills.get(s.name);
		if (!seen || (seen.state === 'disabled' && s.state === 'active')) skills.set(s.name, s);
	}
	return [
		...[...skills.values()].map((s) => ({
			kind: 'Skill',
			label: s.name,
			delivery: s.delivery,
			state: s.state
		})),
		...r.banned.map((b) => ({
			kind: b.kind === 'skill' ? 'Banned skill' : 'Banned tool',
			label: b.id,
			delivery: b.delivery
		})),
		...r.hooks.map((h) => ({ kind: 'Hook', label: h.id, delivery: h.delivery })),
		...r.mcp.map((m) => ({ kind: 'MCP server', label: m.id, delivery: m.delivery }))
	];
}

/** A digest shortened for display: `sha256:abcdef123456`. */
export const shortDigest = (d: string) => d.replace(/^(sha256:)?([0-9a-f]{12})[0-9a-f]+$/i, '$1$2');

/** A read that worked, or why it did not. */
export type Read<T> = { ok: true; value: T } | { ok: false; reason: string };

/** GET /api/playbooks: the catalog, and one project's resolved playbook when asked. */
export interface PlaybooksView {
	schema: 'wheelhouse-playbooks.v1';
	source: PlaybooksSource;
	list: Read<PackList> | null;
	resolve: Read<PackResolve> | null;
}

export const PHASES = ['task', 'build', 'verify', 'review'] as const;
export const PHASE_LABEL: Record<ResolvedSkill['phase'], string> = {
	task: 'For the task',
	build: 'Build',
	verify: 'Verify',
	review: 'Review'
};

/** resolve's (phase, skill) rows grouped by phase, in the order a task runs them; empty phases left out. */
export function skillsByPhase(
	r: PackResolve
): { phase: ResolvedSkill['phase']; skills: ResolvedSkill[] }[] {
	return PHASES.map((phase) => ({
		phase,
		skills: r.skills.filter((s) => s.phase === phase)
	})).filter((g) => g.skills.length);
}
