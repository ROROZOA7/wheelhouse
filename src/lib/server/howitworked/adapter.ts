import type { HowItWorked } from '../../howitworked';
import type { RecordedPack } from '../../howitworked';

/** What a harness adapter needs to find and read one task's session. */
export interface TaskSession {
	id: string;
	worktree: string | null;
	branch: string;
	/** The task's window: dispatched → done (epoch ms); null ends are open. */
	since: number | null;
	until: number | null;
	/** The pack the task was given, when Firstmate recorded one. */
	pack: { recorded: RecordedPack; dir: string | null } | null;
}

/**
 * Reads how a worker worked from its harness's own session records. One adapter per
 * harness; a harness without one shows "not available".
 */
export interface TranscriptAdapter {
	harness: string;
	read(task: TaskSession): Promise<HowItWorked>;
}
