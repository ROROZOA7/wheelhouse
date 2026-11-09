/**
 * How a worker worked: what its own session did, from its transcript. Only names,
 * counts and first lines are kept, never full tool output. The view (HowItWorked.svelte)
 * draws it; the server (server/howitworked/) reads it.
 */

export type WorkEventKind = 'skill' | 'mcp' | 'bash' | 'edit' | 'agent';

export interface WorkEvent {
	at: string | null;
	kind: WorkEventKind;
	/** The tool or skill: `Bash`, `core:tdd`, `docket/search`, `Explore`. */
	name: string;
	/** One short line: the command's first line, the file, the subagent's description. */
	line: string | null;
	ok: boolean | null;
	durationMs: number | null;
	/** Bash only: the exit code when the result says it. */
	exit: number | null;
}

export interface WorkSummary {
	skills: Record<string, number>;
	/** MCP calls by `server/tool`, with failures. */
	mcp: Record<string, { calls: number; failed: number }>;
	bash: { runs: number; failed: number };
	edits: number;
	/** Files the session changed (Edit, Write, NotebookEdit), relative to the worktree when inside it. */
	files: number;
	agents: number;
	tokens: { input: number; output: number; cacheRead: number };
	sessions: number;
	from: string | null;
	to: string | null;
}

export interface Conformance {
	/** The pack the task was given (data/<task>/pack.json), or null when none was recorded. */
	pack: string | null;
	used: string[];
	/** Skills the pack required that the session never used. */
	unused: string[];
	/** Skills used that the pack does not list. */
	outside: string[];
	/** MCP servers called that the pack does not list; null when the pack makes no MCP claim. */
	mcpOutside: string[] | null;
	/** How use is counted: a Read of the skill's SKILL.md (Phase A), or a Skill call (Phase B). */
	basis: string;
}

export type HowItWorked =
	| {
			available: true;
			harness: string;
			/** How the transcripts were matched to the task. */
			matchedBy: string;
			events: WorkEvent[];
			/** Events left out of the timeline (it keeps the latest MAX_EVENTS). */
			dropped: number;
			summary: WorkSummary;
			conformance: Conformance | null;
	  }
	| { available: false; reason: string };

export const MAX_EVENTS = 400;
const LINE = 140;

/** The first line of a text, cut to a short length. */
export function firstLine(s: unknown, max = LINE): string | null {
	if (typeof s !== 'string') return null;
	const l = s.split('\n').find((x) => x.trim()) ?? '';
	const t = l.trim();
	if (!t) return null;
	return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** `mcp__docket__search` → `docket/search`; null for a tool that is not an MCP one. */
export function mcpName(tool: string): { server: string; tool: string } | null {
	const m = /^mcp__(.+?)__(.+)$/.exec(tool);
	return m ? { server: m[1], tool: m[2] } : null;
}

/** The skill a Read of `<pack dir>/skills/<name>/SKILL.md` stands for, under one of the pack dirs. */
export function skillFromRead(file: string, packDirs: string[]): string | null {
	for (const dir of packDirs) {
		const root = dir.endsWith('/') ? dir : `${dir}/`;
		if (!file.startsWith(root)) continue;
		const m = /^skills\/([^/]+)\/SKILL\.md$/.exec(file.slice(root.length));
		if (m) return m[1];
	}
	return null;
}

const EDITS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);

export interface ParseOptions {
	worktree: string;
	branch: string;
	/** Records outside [since, until] (epoch ms) are not this task's. */
	since: number | null;
	until: number | null;
	/** Pack directories whose skills/<name>/SKILL.md Reads count as using `<name>`. */
	packDirs?: string[];
	/** The pack name, to name skills found by Read as `<pack>:<name>`. */
	packName?: string | null;
}

type Pending = { event: WorkEvent; startedAt: number | null };

/** What parsing one transcript has found so far; pass it back to continue with appended lines. */
export interface ParseState {
	matched: boolean;
	events: WorkEvent[];
	tokens: { input: number; output: number; cacheRead: number };
	files: Set<string>;
	pending: Map<string, Pending>;
	/** Assistant messages already counted: Claude Code writes one record per content block, all with the message's usage. */
	counted: Set<string>;
}

export const parseState = (): ParseState => ({
	matched: false,
	events: [],
	tokens: { input: 0, output: 0, cacheRead: 0 },
	files: new Set(),
	pending: new Map(),
	counted: new Set()
});

/**
 * Parse one transcript's lines into events, keeping only records made in the task's
 * worktree, on its branch, inside its window. Pure: no I/O. Pass `state` to carry on
 * from an earlier call on the same transcript (only its appended lines).
 */
export function parseTranscript(
	lines: Iterable<string>,
	o: ParseOptions,
	state: ParseState = parseState()
): ParseState {
	const { events, tokens, pending, files, counted } = state;
	const root = o.worktree.endsWith('/') ? o.worktree : `${o.worktree}/`;
	for (const line of lines) {
		if (!line.includes(o.branch)) continue;
		let rec: Record<string, unknown>;
		try {
			rec = JSON.parse(line);
		} catch {
			continue;
		}
		if (rec.gitBranch !== o.branch) continue;
		const cwd = typeof rec.cwd === 'string' ? rec.cwd : null;
		if (cwd !== o.worktree && !(cwd ?? '').startsWith(root)) continue;
		const ts = typeof rec.timestamp === 'string' ? Date.parse(rec.timestamp) : NaN;
		if (!Number.isNaN(ts)) {
			if (o.since !== null && ts < o.since) continue;
			if (o.until !== null && ts > o.until) continue;
		}
		state.matched = true;
		const at = Number.isNaN(ts) ? null : new Date(ts).toISOString();
		const msg = (rec.message ?? {}) as { content?: unknown; usage?: Record<string, unknown> };
		const msgId = str((msg as { id?: unknown }).id) ?? str(rec.requestId);
		if (rec.type === 'assistant' && msg.usage && !(msgId && counted.has(msgId))) {
			if (msgId) counted.add(msgId);
			tokens.input += num(msg.usage.input_tokens);
			tokens.output += num(msg.usage.output_tokens);
			tokens.cacheRead += num(msg.usage.cache_read_input_tokens);
		}
		if (!Array.isArray(msg.content)) continue;
		for (const c of msg.content as Record<string, unknown>[]) {
			if (c?.type === 'tool_use' && typeof c.name === 'string') {
				const ev = toolEvent(c.name, (c.input ?? {}) as Record<string, unknown>, at, o, root);
				if (!ev) continue;
				if (ev.kind === 'edit' && ev.line) files.add(ev.line);
				events.push(ev);
				if (typeof c.id === 'string')
					pending.set(c.id, { event: ev, startedAt: Number.isNaN(ts) ? null : ts });
			} else if (c?.type === 'tool_result' && typeof c.tool_use_id === 'string') {
				const p = pending.get(c.tool_use_id);
				if (!p) continue;
				pending.delete(c.tool_use_id);
				p.event.ok = c.is_error !== true;
				if (p.startedAt !== null && !Number.isNaN(ts))
					p.event.durationMs = Math.max(0, ts - p.startedAt);
				if (p.event.kind === 'bash') p.event.exit = exitCode(c, rec);
			}
		}
	}
	return state;
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

function toolEvent(
	name: string,
	input: Record<string, unknown>,
	at: string | null,
	o: ParseOptions,
	root: string
): WorkEvent | null {
	const ev = (kind: WorkEventKind, n: string, line: string | null): WorkEvent => ({
		at,
		kind,
		name: n,
		line,
		ok: null,
		durationMs: null,
		exit: null
	});
	const rel = (f: unknown) =>
		typeof f === 'string' ? (f.startsWith(root) ? f.slice(root.length) : f) : null;
	const m = mcpName(name);
	if (m) return ev('mcp', `${m.server}/${m.tool}`, null);
	if (name === 'Skill') {
		const s = typeof input.skill === 'string' ? input.skill : '?';
		return ev('skill', s, null);
	}
	if (name === 'Bash') return ev('bash', 'Bash', firstLine(input.command));
	if (EDITS.has(name)) return ev('edit', name, rel(input.file_path ?? input.notebook_path));
	if (name === 'Agent' || name === 'Task') {
		const type = typeof input.subagent_type === 'string' ? input.subagent_type : 'agent';
		return ev('agent', type, firstLine(input.description));
	}
	if (name === 'Read' && typeof input.file_path === 'string') {
		const skill = skillFromRead(input.file_path, o.packDirs ?? []);
		if (skill) return ev('skill', o.packName ? `${o.packName}:${skill}` : skill, 'read SKILL.md');
		return null;
	}
	return null;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function exitCode(c: Record<string, unknown>, rec: Record<string, unknown>): number | null {
	const r = rec.toolUseResult as Record<string, unknown> | undefined;
	if (r && typeof r.exitCode === 'number') return r.exitCode;
	const text = typeof c.content === 'string' ? c.content : '';
	const m = /^Exit code (\d+)/.exec(text);
	if (m) return Number(m[1]);
	return c.is_error === true ? null : 0;
}

/** Totals over a task's events. */
export function summarize(
	events: WorkEvent[],
	tokens: WorkSummary['tokens'],
	files: number,
	sessions: number
): WorkSummary {
	const s: WorkSummary = {
		skills: {},
		mcp: {},
		bash: { runs: 0, failed: 0 },
		edits: 0,
		files,
		agents: 0,
		tokens,
		sessions,
		from: null,
		to: null
	};
	for (const e of events) {
		if (e.at) {
			if (!s.from || e.at < s.from) s.from = e.at;
			if (!s.to || e.at > s.to) s.to = e.at;
		}
		if (e.kind === 'skill') s.skills[e.name] = (s.skills[e.name] ?? 0) + 1;
		else if (e.kind === 'mcp') {
			const m = (s.mcp[e.name] ??= { calls: 0, failed: 0 });
			m.calls++;
			if (e.ok === false) m.failed++;
		} else if (e.kind === 'bash') {
			s.bash.runs++;
			if (e.ok === false || (e.exit !== null && e.exit !== 0)) s.bash.failed++;
		} else if (e.kind === 'edit') s.edits++;
		else if (e.kind === 'agent') s.agents++;
	}
	return s;
}

/**
 * A pack's install folder name for a digest: fm-pack installs under the bare hex
 * (data/.packs/<name>/<version>/<hex>/), while JSON digests keep the `sha256:` prefix.
 */
export const digestDir = (digest: string) => digest.replace(/^sha256:/i, '');

/** The pack a task was spawned with, as data/<task>/pack.json records it (resolve output, frozen). */
export interface RecordedPack {
	binding: { pack: string; version?: string; digest: string } | null;
	skills: { id: string; name: string; phase?: string; state?: string; path?: string }[];
	mcp?: { id: string }[];
}

/** Compare what the session used with what the recorded pack gave it. */
export function conformance(
	summary: WorkSummary,
	pack: RecordedPack | null,
	phase: 'A' | 'B' = 'A'
): Conformance | null {
	if (!pack?.binding) return null;
	const given = new Set(pack.skills.filter((s) => s.state !== 'disabled').map((s) => s.name));
	// Only exact pack names count (a Read of the pack's SKILL.md is named `<pack>:<skill>`):
	// a global skill that shares a pack skill's bare name is not the pack's.
	const used = Object.keys(summary.skills);
	const usedPack = new Set(used.filter((n) => given.has(n)));
	const servers = new Set(Object.keys(summary.mcp).map((k) => k.split('/')[0]));
	// No `mcp` list means the pack says nothing about MCP, not that it allows none.
	const allowed = Array.isArray(pack.mcp) ? new Set(pack.mcp.map((m) => m.id)) : null;
	return {
		pack: `${pack.binding.pack}${pack.binding.version ? `@${pack.binding.version}` : ''}`,
		used: [...usedPack].sort(),
		unused: [...given].filter((n) => !usedPack.has(n)).sort(),
		outside: used.filter((n) => !given.has(n)).sort(),
		mcpOutside: allowed ? [...servers].filter((s) => !allowed.has(s)).sort() : null,
		basis:
			phase === 'A'
				? 'A skill counts as used when the session read its SKILL.md from the pack.'
				: 'A skill counts as used when the session invoked it.'
	};
}
