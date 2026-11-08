import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { HowItWorked, RecordedPack } from '../../howitworked';
import type { TaskSession, TranscriptAdapter } from './adapter';

/**
 * Picks the task's harness adapter and gives it the task: worktree, branch, window,
 * and the pack Firstmate recorded at spawn (data/<task>/pack.json), if any.
 */
export class HowItWorkedService {
	private adapters = new Map<string, TranscriptAdapter>();

	constructor(
		adapters: TranscriptAdapter[],
		private homeDir: string
	) {
		for (const a of adapters) this.adapters.set(a.harness, a);
	}

	async read(t: Omit<TaskSession, 'pack'> & { harness: string | null }): Promise<HowItWorked> {
		const harness = (t.harness ?? '').toLowerCase();
		const adapter = this.adapters.get(harness);
		if (!adapter)
			return {
				available: false,
				reason: t.harness
					? `Not available for ${t.harness} workers yet: only Claude Code sessions can be read.`
					: 'The worker’s harness is not recorded.'
			};
		return adapter.read({ ...t, pack: await this.pack(t.id) });
	}

	/** data/<task>/pack.json, the resolve output Firstmate froze at spawn, and its pack directory. */
	private async pack(id: string): Promise<TaskSession['pack']> {
		const data = path.join(this.homeDir, 'data');
		const file = path.join(data, id, 'pack.json');
		const recorded = await readFile(file, 'utf8')
			.then((t) => JSON.parse(t) as RecordedPack)
			.catch(() => null);
		if (!recorded?.binding || !Array.isArray(recorded.skills)) return null;
		const b = recorded.binding;
		const packs = path.join(data, '.packs');
		const dir = b.version ? path.join(packs, b.pack, b.version, b.digest) : null;
		// Only a directory that really is under data/.packs counts.
		const real = dir ? await realpath(dir).catch(() => null) : null;
		const root = await realpath(packs).catch(() => null);
		return {
			recorded,
			dir: real && root && real.startsWith(root + path.sep) ? dir : null
		};
	}
}
