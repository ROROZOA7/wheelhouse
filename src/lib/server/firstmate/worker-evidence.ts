import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import {
	checkWorkerEvidence,
	type WorkerEvidence,
	type EvidenceProblem
} from '../../worker-evidence';
import { TASK_ID } from './adapter';
import { runBounded } from './exec';

const MAX = 256 * 1024;
const inside = (root: string, file: string) => file.startsWith(root + path.sep);

/** Every file read is confined to this task, including symlink resolution. */
export async function readWorkerEvidence(
	dataDir: string,
	task: string,
	script?: string,
	env?: NodeJS.ProcessEnv
): Promise<WorkerEvidence | null> {
	if (!TASK_ID.test(task)) return null;
	const fail = (detail: string): WorkerEvidence => ({
		source: 'local shape check',
		ok: false,
		problems: [{ code: 'evidence-unreadable', detail }],
		warnings: [],
		head: null,
		commands: [],
		decisions: []
	});
	let root: string;
	let result: WorkerEvidence;
	try {
		const data = await realpath(dataDir);
		root = await realpath(path.join(data, task));
		if (!inside(data, root))
			return fail('Task data directory escapes the Firstmate data directory.');
		const file = await realpath(path.join(root, 'evidence.json'));
		if (!inside(root, file)) return fail('evidence.json escapes this task’s data directory.');
		const handle = await open(
			file,
			constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW
		);
		try {
			const st = await handle.stat();
			if (!st.isFile() || st.size > MAX)
				return fail('evidence.json must be a regular file no larger than 256 KiB.');
			const bytes = Buffer.alloc(MAX + 1);
			let bytesRead = 0;
			while (bytesRead < bytes.length) {
				const chunk = await handle.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead);
				if (!chunk.bytesRead) break;
				bytesRead += chunk.bytesRead;
			}
			if (bytesRead > MAX) return fail('evidence.json exceeds 256 KiB.');
			result = checkWorkerEvidence(JSON.parse(bytes.subarray(0, bytesRead).toString('utf8')), task);
		} finally {
			await handle.close();
		}
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
		return fail('evidence.json could not be read or is not valid JSON.');
	}
	for (const cmd of result.commands) {
		if (!cmd.log_path) continue;
		let safe = path.isAbsolute(cmd.log_path) && inside(root, path.resolve(cmd.log_path));
		if (safe) {
			try {
				safe = inside(root, await realpath(cmd.log_path));
			} catch {
				safe = false;
			}
		}
		if (!safe)
			result.problems.push({
				code: 'log-path-unsafe',
				detail: `Log for ${cmd.id} must be inside this task’s data directory.`
			});
	}
	result.ok = result.problems.length === 0;
	if (script) {
		const r = await runBounded(script, ['evidence-check', task, '--json'], {
			env,
			timeoutMs: 8000,
			maxOutputBytes: MAX
		});
		if (r.ok || (r.kind === 'exit' && r.stdout.trim().startsWith('{'))) {
			try {
				const v = JSON.parse(r.stdout);
				const notices = (xs: unknown): xs is EvidenceProblem[] =>
					Array.isArray(xs) &&
					xs.every((x) => x && typeof x.code === 'string' && typeof x.detail === 'string');
				if (
					v.schema === 'fm-pack.v1' &&
					v.task === task &&
					typeof v.ok === 'boolean' &&
					notices(v.problems) &&
					notices(v.warnings)
				) {
					result.source = 'fm-pack evidence-check';
					// A checker cannot make locally unreadable or malformed evidence trustworthy.
					result.problems = [...v.problems, ...result.problems];
					result.warnings = v.warnings;
					result.ok = v.ok && result.problems.length === 0;
				} else
					result.problems.push({
						code: 'evidence-unreadable',
						detail: 'Evidence checker returned an invalid response.'
					});
			} catch {
				result.problems.push({
					code: 'evidence-unreadable',
					detail: 'Evidence checker returned invalid JSON.'
				});
			}
		} else if (
			!/unknown (?:command|subcommand)|unsupported.*command/i.test(r.stderr) &&
			!(r.kind === 'spawn-error' && /\bENOENT\b/.test(r.message))
		) {
			result.problems.push({
				code: 'evidence-unreadable',
				detail: 'Firstmate evidence checker failed.'
			});
		}
		result.ok = result.ok && result.problems.length === 0;
	}
	if (result.source === 'local shape check') {
		try {
			const file = await realpath(path.join(root, 'pack.json'));
			if (!inside(root, file)) throw new Error('unsafe pack');
			const handle = await open(
				file,
				constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW
			);
			let pack: unknown;
			try {
				const st = await handle.stat();
				if (!st.isFile() || st.size > MAX) throw new Error('invalid pack');
				const bytes = Buffer.alloc(MAX + 1);
				let n = 0;
				while (n < bytes.length) {
					const chunk = await handle.read(bytes, n, bytes.length - n, n);
					if (!chunk.bytesRead) break;
					n += chunk.bytesRead;
				}
				if (n > MAX) throw new Error('oversize pack');
				pack = JSON.parse(bytes.subarray(0, n).toString('utf8'));
			} finally {
				await handle.close();
			}
			const required = (pack as { verify_commands?: unknown } | null)?.verify_commands;
			if (
				!Array.isArray(required) ||
				!required.every((c) => c && typeof c.id === 'string' && typeof c.cmd === 'string')
			)
				throw new Error('invalid requirements');
			for (const command of required) {
				if (!result.commands.some((c) => c.id === command.id && c.cmd === command.cmd)) {
					result.problems.push({
						code: 'verify-missing',
						path: 'verify_commands',
						detail: `Missing frozen verify command: ${command.id}.`
					});
				}
			}
		} catch {
			result.problems.push({
				code: 'verify-missing',
				path: 'pack.json.verify_commands',
				detail: 'Frozen verification requirements could not be read; command coverage is unknown.'
			});
		}
		result.ok = result.ok && result.problems.length === 0;
	}
	return result;
}
