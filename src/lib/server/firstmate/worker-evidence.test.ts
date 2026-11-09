import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm, chmod } from 'node:fs/promises';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { readWorkerEvidence } from './worker-evidence';
const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function setup() {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wh-evidence-'));
	roots.push(root);
	const data = path.join(root, 'data');
	const dir = path.join(data, 'pilot');
	await mkdir(dir, { recursive: true });
	return { root, data, dir };
}
const record = () => ({
	schema: 'fm-evidence.v1',
	task: 'pilot',
	pack: 'core@0.1.0',
	head_sha: 'a'.repeat(40),
	verify_commands: [],
	decisions: []
});
describe('confined worker evidence reader', () => {
	it('rejects a FIFO promptly without waiting for a writer', async () => {
		const { data, dir } = await setup();
		const fifo = path.join(dir, 'evidence.json');
		execFileSync('mkfifo', [fifo]);
		// Rescue a broken blocking reader after the assertion deadline so the suite cannot hang.
		const rescue = setTimeout(async () => {
			const h = await open(fifo, constants.O_RDWR | constants.O_NONBLOCK);
			await h.close();
		}, 500);
		const started = Date.now();
		try {
			expect((await readWorkerEvidence(data, 'pilot'))?.ok).toBe(false);
			expect(Date.now() - started).toBeLessThan(400);
		} finally {
			clearTimeout(rescue);
		}
	});
	it('ignores missing evidence, reports invalid JSON and size limits', async () => {
		const { data, dir } = await setup();
		expect(await readWorkerEvidence(data, 'pilot')).toBeNull();
		await writeFile(path.join(dir, 'evidence.json'), '{');
		expect((await readWorkerEvidence(data, 'pilot'))?.ok).toBe(false);
		await writeFile(path.join(dir, 'evidence.json'), ' '.repeat(256 * 1024 + 1));
		expect((await readWorkerEvidence(data, 'pilot'))?.problems[0].detail).toContain('256 KiB');
	});
	it('rejects evidence symlinks outside the task', async () => {
		const { root, data, dir } = await setup();
		const out = path.join(root, 'outside.json');
		await writeFile(out, JSON.stringify(record()));
		await symlink(out, path.join(dir, 'evidence.json'));
		expect((await readWorkerEvidence(data, 'pilot'))?.problems[0].detail).toContain('escapes');
	});
	it('rejects log path traversal and escaped symlinks', async () => {
		const { root, data, dir } = await setup();
		const out = path.join(root, 'log');
		await writeFile(out, 'private');
		await symlink(out, path.join(dir, 'log'));
		for (const log_path of [out, path.join(dir, 'log')]) {
			await writeFile(
				path.join(dir, 'evidence.json'),
				JSON.stringify({
					...record(),
					verify_commands: [{ id: 'check', cmd: 'check', exit: 0, log_path }]
				})
			);
			expect(
				(await readWorkerEvidence(data, 'pilot'))?.problems.some(
					(p) => p.code === 'log-path-unsafe'
				)
			).toBe(true);
		}
	});
	it('prefers checker notices and falls back for an old unsupported command', async () => {
		const { root, data, dir } = await setup();
		await writeFile(path.join(dir, 'evidence.json'), JSON.stringify(record()));
		const script = path.join(root, 'checker');
		await writeFile(
			script,
			'#!/bin/sh\nprintf \'%s\' \'{"schema":"fm-pack.v1","task":"pilot","ok":false,"problems":[{"code":"head-mismatch","path":"head_sha","detail":"stale head"}],"warnings":[]}\'\n'
		);
		await chmod(script, 0o755);
		expect((await readWorkerEvidence(data, 'pilot', script))?.source).toBe(
			'fm-pack evidence-check'
		);
		await writeFile(
			script,
			'#!/bin/sh\nprintf \'%s\' \'{"schema":"fm-pack.v1","task":"pilot","ok":false,"problems":[{"code":"head-mismatch","path":"head_sha","detail":"stale"}],"warnings":[]}\'\nexit 1\n'
		);
		expect((await readWorkerEvidence(data, 'pilot', script))?.source).toBe(
			'fm-pack evidence-check'
		);
		await writeFile(script, '#!/bin/sh\nprintf "unknown command\\n" >&2\nexit 2\n');
		expect((await readWorkerEvidence(data, 'pilot', script))?.ok).toBe(true);
		await writeFile(script, '#!/bin/sh\nprintf "broken install\\n" >&2\nexit 1\n');
		expect((await readWorkerEvidence(data, 'pilot', script))?.ok).toBe(false);
	});
});
