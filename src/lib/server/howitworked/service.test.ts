import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { transcriptDirName } from '../buildlog/reader';
import { ClaudeTranscripts } from './claude';
import { HowItWorkedService } from './service';

const WT = '/work/slot-3';

async function setup() {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wh-how-'));
	const projects = path.join(root, 'projects');
	const home = path.join(root, 'home');
	const packDir = path.join(home, 'data', '.packs', 'core', '0.1.0', 'sha256:abc');
	await mkdir(path.join(projects, transcriptDirName(WT)), { recursive: true });
	await mkdir(path.join(packDir, 'skills', 'tdd'), { recursive: true });
	await mkdir(path.join(home, 'data', 'wh-7'), { recursive: true });
	const line = (branch: string, ts: string, content: unknown[]) =>
		JSON.stringify({
			type: 'assistant',
			timestamp: ts,
			cwd: WT,
			gitBranch: branch,
			message: { content }
		});
	await writeFile(
		path.join(projects, transcriptDirName(WT), 's1.jsonl'),
		[
			line('fm/wh-7', '2026-11-08T10:00:01Z', [
				{
					type: 'tool_use',
					id: 'a',
					name: 'Read',
					input: { file_path: `${packDir}/skills/tdd/SKILL.md` }
				}
			]),
			line('fm/wh-7', '2026-11-08T10:00:02Z', [
				{ type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'npm test' } }
			])
		].join('\n') + '\n'
	);
	// The same pooled slot's earlier task.
	await writeFile(
		path.join(projects, transcriptDirName(WT), 's0.jsonl'),
		line('fm/wh-6', '2026-11-08T10:00:03Z', [
			{ type: 'tool_use', id: 'c', name: 'Bash', input: { command: 'old task' } }
		]) + '\n'
	);
	await writeFile(
		path.join(home, 'data', 'wh-7', 'pack.json'),
		JSON.stringify({
			binding: { pack: 'core', version: '0.1.0', digest: 'sha256:abc' },
			skills: [
				{ id: 'tdd', name: 'core:tdd' },
				{ id: 'implement', name: 'core:implement' }
			]
		})
	);
	return { projects, home };
}

const task = {
	id: 'wh-7',
	worktree: WT,
	branch: 'fm/wh-7',
	since: Date.parse('2026-11-08T09:00:00Z'),
	until: null
};

describe('HowItWorkedService', () => {
	it('reads a Claude worker’s session for this task only, and checks it against its pack', async () => {
		const { projects, home } = await setup();
		const svc = new HowItWorkedService([new ClaudeTranscripts(projects)], home);
		const r = await svc.read({ ...task, harness: 'claude' });
		expect(r.available).toBe(true);
		if (!r.available) return;
		expect(r.events.map((e) => e.line ?? e.name)).toEqual(['read SKILL.md', 'npm test']);
		expect(r.summary.sessions).toBe(1);
		expect(r.conformance).toMatchObject({ used: ['core:tdd'], unused: ['core:implement'] });
	});

	it('says plainly that other harnesses are not readable yet', async () => {
		const { projects, home } = await setup();
		const svc = new HowItWorkedService([new ClaudeTranscripts(projects)], home);
		const r = await svc.read({ ...task, harness: 'codex' });
		expect(r).toEqual({
			available: false,
			reason: expect.stringMatching(/Not available for codex/)
		});
	});

	it('says when no session matches', async () => {
		const { projects, home } = await setup();
		const svc = new HowItWorkedService([new ClaudeTranscripts(projects)], home);
		const r = await svc.read({ ...task, id: 'wh-9', branch: 'fm/wh-9', harness: 'claude' });
		expect(r.available).toBe(false);
	});

	it('is off when transcripts are not to be read', async () => {
		const { home } = await setup();
		const r = await new HowItWorkedService([new ClaudeTranscripts(null)], home).read({
			...task,
			harness: 'claude'
		});
		expect(r).toMatchObject({ available: false, reason: expect.stringMatching(/turned off/) });
	});
});
