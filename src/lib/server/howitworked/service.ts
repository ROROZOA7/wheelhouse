import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { TASK_ID } from '../firstmate/adapter';
import path from 'node:path';
import { digestDir, type HowItWorked, type RecordedPack } from '../../howitworked';
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

	async base(id: string): Promise<string | undefined> {
		const r = await this.record(id);
		const sha = r?.origin?.commit;
		return typeof sha === 'string' && /^[a-f0-9]{40,64}$/i.test(sha) ? sha : undefined;
	}

	private async record(
		id: string
	): Promise<(RecordedPack & { origin?: { commit?: string } }) | null> {
		if (!TASK_ID.test(id)) return null;
		try {
			const data = await realpath(path.join(this.homeDir, 'data'));
			const dir = await realpath(path.join(data, id));
			if (!dir.startsWith(data + path.sep)) return null;
			const file = await realpath(path.join(dir, 'pack.json'));
			if (!file.startsWith(dir + path.sep)) return null;
			const handle = await open(
				file,
				constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW
			);
			try {
				const st = await handle.stat();
				if (!st.isFile() || st.size > 256 * 1024) return null;
				const bytes = Buffer.alloc(256 * 1024 + 1);
				const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
				if (bytesRead > 256 * 1024) return null;
				return JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
			} finally {
				await handle.close();
			}
		} catch {
			return null;
		}
	}

	/** data/<task>/pack.json, the resolve output Firstmate froze at spawn, and its pack directory. */
	private async pack(id: string): Promise<TaskSession['pack']> {
		const data = path.join(this.homeDir, 'data');
		const recorded = await this.record(id);
		if (!recorded?.binding || !Array.isArray(recorded.skills)) return null;
		const b = recorded.binding;
		if (
			typeof b.pack !== 'string' ||
			typeof b.digest !== 'string' ||
			(b.version !== undefined && typeof b.version !== 'string')
		)
			return null;
		const packs = path.join(data, '.packs');
		const dir = b.version ? path.join(packs, b.pack, b.version, digestDir(b.digest)) : null;
		// Only a directory that really is under data/.packs counts.
		const real = dir ? await realpath(dir).catch(() => null) : null;
		const root = await realpath(packs).catch(() => null);
		return {
			recorded,
			dir: real && root && real.startsWith(root + path.sep) ? dir : null
		};
	}
}
