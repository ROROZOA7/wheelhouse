import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
	conformance,
	MAX_EVENTS,
	parseState,
	parseTranscript,
	summarize,
	type ParseState,
	type HowItWorked,
	type WorkEvent
} from '../../howitworked';
import { readRange, transcriptDirName } from '../buildlog/reader';
import type { TaskSession, TranscriptAdapter } from './adapter';

/**
 * Claude Code workers. Phase A matching: transcripts in the projects folder for the
 * task's worktree, whose records name that worktree as `cwd` AND the task's branch as
 * `gitBranch`, inside the task's dispatched → done window. Worktree slots are pooled,
 * so the path alone would also find the slot's earlier tasks. Read-only and bounded.
 */

const MAX_FILES = 30;
/** The most read from one transcript the first time it is seen (its tail); later reads take only what was appended. */
const MAX_BYTES = 16 * 1024 * 1024;
const CACHE_MS = 15_000;
/** Bounds on what is kept between reads: results by task, and parse progress by transcript. */
const MAX_RESULTS = 100;
const MAX_PARSED = 300;

type Parsed = { key: string; size: number; state: ParseState };

/** A Map used as a small LRU: set() moves a key to the end, and the oldest go past `max`. */
function remember<K, V>(map: Map<K, V>, key: K, value: V, max: number) {
	map.delete(key);
	map.set(key, value);
	while (map.size > max) map.delete(map.keys().next().value!);
}

export class ClaudeTranscripts implements TranscriptAdapter {
	readonly harness = 'claude';
	private cache = new Map<string, { at: number; value: HowItWorked }>();
	private parsed = new Map<string, Parsed>();

	constructor(
		private projectsDir: string | null,
		private now: () => number = Date.now
	) {}

	async read(t: TaskSession): Promise<HowItWorked> {
		if (!this.projectsDir)
			return { available: false, reason: 'Reading Claude Code transcripts is turned off.' };
		if (!t.worktree)
			return {
				available: false,
				reason: 'The task’s worktree is not recorded, so its session cannot be matched.'
			};
		const key = `${t.id} ${t.worktree} ${t.until ?? ''}`;
		const hit = this.cache.get(key);
		if (hit && this.now() - hit.at < CACHE_MS) return hit.value;
		const value = await this.load(t, t.worktree).catch((): HowItWorked => ({
			available: false,
			reason: 'The session’s transcripts could not be read.'
		}));
		remember(this.cache, key, { at: this.now(), value }, MAX_RESULTS);
		return value;
	}

	/**
	 * One transcript parsed for this task. Transcripts only grow, so a file read before
	 * for the same task is carried on from where that read ended (a cut last line is read again).
	 */
	private async parse(file: string, size: number, t: TaskSession, worktree: string) {
		const dirs = packDirs(t);
		const key = JSON.stringify([t.id, worktree, t.branch, t.since, t.until, dirs]);
		let p = this.parsed.get(file);
		if (!p || p.key !== key || p.size > size) p = { key, size: 0, state: parseState() };
		if (p.size < size) {
			const read = await readRange(file, p.size, size, MAX_BYTES);
			if (!read) return p.state;
			let text = read.text;
			// A read that had to skip ahead starts mid-line: drop the cut line.
			if (size - p.size > MAX_BYTES) text = text.slice(text.indexOf('\n') + 1);
			const lines = text.split('\n');
			const partial = text.endsWith('\n') ? '' : (lines.pop() ?? '');
			parseTranscript(
				lines,
				{
					worktree,
					branch: t.branch,
					since: t.since,
					until: t.until,
					packDirs: dirs,
					packName: t.pack?.recorded.binding?.pack ?? null
				},
				p.state
			);
			p = { key, size: read.end - Buffer.byteLength(partial), state: p.state };
		}
		remember(this.parsed, file, p, MAX_PARSED);
		return p.state;
	}

	private async load(t: TaskSession, worktree: string): Promise<HowItWorked> {
		const dir = path.join(this.projectsDir!, transcriptDirName(worktree));
		const names = (await readdir(dir).catch(() => [] as string[])).filter((n) =>
			n.endsWith('.jsonl')
		);
		const files = (
			await Promise.all(
				names.map(async (n) => {
					const st = await stat(path.join(dir, n)).catch(() => null);
					// A transcript last written before the task began cannot be its own.
					return st?.isFile() && (t.since === null || st.mtimeMs >= t.since) ? { n, st } : null;
				})
			)
		)
			.filter((x): x is NonNullable<typeof x> => !!x)
			.sort((a, b) => a.st.mtimeMs - b.st.mtimeMs)
			.slice(-MAX_FILES);
		let events: WorkEvent[] = [];
		const tokens = { input: 0, output: 0, cacheRead: 0 };
		const changed = new Set<string>();
		let sessions = 0;
		for (const { n, st } of files) {
			const r = await this.parse(path.join(dir, n), st.size, t, worktree);
			if (!r.matched) continue;
			sessions++;
			// Copies: the parse state is kept and carried on by later reads.
			events.push(...r.events.map((e) => ({ ...e })));
			tokens.input += r.tokens.input;
			tokens.output += r.tokens.output;
			tokens.cacheRead += r.tokens.cacheRead;
			for (const f of r.files) changed.add(f);
		}
		if (!sessions)
			return {
				available: false,
				reason: `No Claude Code session was found for this task (worktree ${worktree}, branch ${t.branch}).`
			};
		events.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
		const summary = summarize(events, tokens, changed.size, sessions);
		const dropped = Math.max(0, events.length - MAX_EVENTS);
		if (dropped) events = events.slice(-MAX_EVENTS);
		return {
			available: true,
			harness: 'claude',
			matchedBy: 'worktree, branch and the task’s time window',
			events,
			dropped,
			summary,
			conformance: conformance(summary, t.pack?.recorded ?? null, 'A')
		};
	}
}

/** Where the task's pack skills live: its pack directory, and the roots its recorded skill paths name. */
function packDirs(t: TaskSession): string[] {
	const dirs = new Set<string>();
	if (t.pack?.dir) dirs.add(t.pack.dir);
	for (const s of t.pack?.recorded.skills ?? []) {
		const i = s.path?.lastIndexOf('/skills/') ?? -1;
		if (s.path && i > 0) dirs.add(s.path.slice(0, i));
	}
	return [...dirs];
}
