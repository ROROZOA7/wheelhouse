import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
	conformance,
	MAX_EVENTS,
	parseTranscript,
	summarize,
	type HowItWorked,
	type WorkEvent
} from '../../howitworked';
import { transcriptDirName } from '../buildlog/reader';
import type { TaskSession, TranscriptAdapter } from './adapter';

/**
 * Claude Code workers. Phase A matching: transcripts in the projects folder for the
 * task's worktree, whose records name that worktree as `cwd` AND the task's branch as
 * `gitBranch`, inside the task's dispatched → done window. Worktree slots are pooled,
 * so the path alone would also find the slot's earlier tasks. Read-only and bounded.
 */

const MAX_FILES = 30;
const MAX_BYTES = 16 * 1024 * 1024;
const CACHE_MS = 15_000;

export class ClaudeTranscripts implements TranscriptAdapter {
	readonly harness = 'claude';
	private cache = new Map<string, { at: number; value: HowItWorked }>();

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
		const key = `${t.id} ${t.until ?? ''}`;
		const hit = this.cache.get(key);
		if (hit && this.now() - hit.at < CACHE_MS) return hit.value;
		const value = await this.load(t, t.worktree).catch((): HowItWorked => ({
			available: false,
			reason: 'The session’s transcripts could not be read.'
		}));
		this.cache.set(key, { at: this.now(), value });
		return value;
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
		const packName = t.pack?.recorded.binding?.pack ?? null;
		let events: WorkEvent[] = [];
		const tokens = { input: 0, output: 0, cacheRead: 0 };
		const changed = new Set<string>();
		let sessions = 0;
		for (const { n, st } of files) {
			const text = await readTail(path.join(dir, n), st.size, MAX_BYTES);
			const r = parseTranscript(text.split('\n'), {
				worktree,
				branch: t.branch,
				since: t.since,
				until: t.until,
				packDirs: packDirs(t),
				packName
			});
			if (!r.matched) continue;
			sessions++;
			events.push(...r.events);
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

/** The last `max` bytes of a file (a cut first line is dropped). */
async function readTail(file: string, size: number, max: number): Promise<string> {
	const start = Math.max(0, size - max);
	const fh = await open(file, 'r');
	try {
		const buf = Buffer.alloc(size - start);
		const { bytesRead } = await fh.read(buf, 0, size - start, start);
		const text = buf.subarray(0, bytesRead).toString('utf8');
		return start ? text.slice(text.indexOf('\n') + 1) : text;
	} finally {
		await fh.close();
	}
}
