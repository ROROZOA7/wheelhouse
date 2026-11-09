export interface EvidenceProblem {
	code: string;
	path?: string;
	detail: string;
}
export interface EvidenceCommand {
	id: string;
	cmd: string;
	exit: number | null;
	skipped_reason: string | null;
	head_sha?: string;
	base_sha?: string;
	log_path?: string;
}
export interface EvidenceDecision {
	rung: string;
	choice: string;
	why: string;
	open: boolean;
}
export interface WorkerEvidence {
	source: 'local shape check' | 'fm-pack evidence-check';
	ok: boolean;
	problems: EvidenceProblem[];
	warnings: EvidenceProblem[];
	head: string | null;
	commands: EvidenceCommand[];
	decisions: EvidenceDecision[];
}

/** Shape checks only: never interpret skills_used claims as observed usage. */
export function checkWorkerEvidence(value: unknown, task: string): WorkerEvidence {
	const problems: EvidenceProblem[] = [];
	const warnings: EvidenceProblem[] = [];
	const problem = (code: string, path: string, detail: string) =>
		problems.push({ code, path, detail });
	const record = (v: unknown): v is Record<string, unknown> =>
		v !== null && typeof v === 'object' && !Array.isArray(v);
	const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
	const required = (r: Record<string, unknown>, key: string, prefix = '') => {
		if (text(r[key])) return true;
		const at = prefix + key;
		problem(
			r[key] === undefined ? 'field-missing' : 'field-type',
			at,
			`${at} must be a nonempty string.`
		);
		return false;
	};
	const warnMissing = (r: Record<string, unknown>, key: string, prefix = '') => {
		if (r[key] === undefined)
			warnings.push({
				code: 'field-missing',
				path: prefix + key,
				detail: `${prefix + key} is missing.`
			});
	};
	const r = record(value) ? value : {};
	if (!record(value)) problem('field-type', '', 'Evidence must be a JSON object.');
	if (r.schema !== 'fm-evidence.v1')
		problem('schema-mismatch', 'schema', 'schema must be fm-evidence.v1.');
	for (const k of ['task', 'pack', 'head_sha']) required(r, k);
	if (text(r.task) && r.task !== task)
		problem('field-type', 'task', 'task does not match this task.');
	for (const k of ['base_sha', 'skills_used']) warnMissing(r, k);
	if (r.skills_used !== undefined && (!Array.isArray(r.skills_used) || !r.skills_used.every(text)))
		problem('field-type', 'skills_used', 'skills_used must be an array of names.');
	const commands: EvidenceCommand[] = [];
	if (!Array.isArray(r.verify_commands))
		problem('verify-missing', 'verify_commands', 'verify_commands must be an array.');
	else
		r.verify_commands.forEach((v, i) => {
			const at = `verify_commands[${i}]`;
			if (!record(v)) {
				problem('field-type', at, `${at} must be an object.`);
				return;
			}
			const before = problems.length;
			for (const k of ['id', 'cmd']) required(v, k, at + '.');
			if (v.exit !== null && !Number.isInteger(v.exit))
				problem('field-type', at + '.exit', `${at}.exit must be an integer or null.`);
			if (v.exit === null && !text(v.skipped_reason))
				problem(
					'skipped-without-reason',
					at + '.skipped_reason',
					`${at}.skipped_reason is required when exit is null.`
				);
			if (v.exit !== null && v.skipped_reason !== null && v.skipped_reason !== undefined)
				problem(
					'reason-with-exit',
					at + '.skipped_reason',
					`${at}.skipped_reason requires exit:null.`
				);
			for (const k of ['head_sha', 'base_sha', 'log_path']) {
				warnMissing(v, k, at + '.');
				if (v[k] !== undefined && !text(v[k]))
					problem('field-type', at + '.' + k, `${at}.${k} must be a nonempty string.`);
			}
			if (text(v.head_sha) && text(r.head_sha) && v.head_sha !== r.head_sha)
				problem(
					'head-mismatch',
					at + '.head_sha',
					`${at}.head_sha differs from evidence head_sha.`
				);
			if (before === problems.length)
				commands.push({
					id: v.id as string,
					cmd: v.cmd as string,
					exit: v.exit as number | null,
					skipped_reason: text(v.skipped_reason) ? v.skipped_reason : null,
					head_sha: text(v.head_sha) ? v.head_sha : undefined,
					base_sha: text(v.base_sha) ? v.base_sha : undefined,
					log_path: text(v.log_path) ? v.log_path : undefined
				});
		});
	const decisions: EvidenceDecision[] = [];
	if (!Array.isArray(r.decisions))
		problem('field-type', 'decisions', 'decisions must be an array.');
	else
		r.decisions.forEach((v, i) => {
			const at = `decisions[${i}]`;
			if (!record(v)) {
				problem('field-type', at, `${at} must be an object.`);
				return;
			}
			const before = problems.length;
			if (
				!['intent', 'repo-precedent', 'smallest-blast-radius', 'human-gate'].includes(
					String(v.rung)
				)
			)
				problem('rung-unknown', at + '.rung', `${at}.rung is unknown.`);
			required(v, 'choice', at + '.');
			required(v, 'why', at + '.');
			if (before !== problems.length) return;
			decisions.push({
				rung: String(v.rung),
				choice: v.choice as string,
				why: v.why as string,
				open: (v.why as string).startsWith('UNRESOLVED:')
			});
		});
	return {
		source: 'local shape check',
		ok: problems.length === 0,
		problems,
		warnings,
		head: text(r.head_sha) ? r.head_sha : null,
		commands,
		decisions
	};
}
