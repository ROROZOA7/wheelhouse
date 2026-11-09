import { describe, it, expect } from 'vitest';
import { checkWorkerEvidence } from './worker-evidence';
// Independently authored synthetic cases, not operational task records.
import blocked from './fixtures/worker-evidence/synthetic-blocked.json';
import legacyFailure from './fixtures/worker-evidence/synthetic-legacy-failure.json';
const valid = () => ({
	schema: 'fm-evidence.v1',
	task: 'pilot',
	pack: 'core@0.1.0',
	head_sha: 'a'.repeat(40),
	verify_commands: [{ id: 'check', cmd: 'npm run check', exit: 0 }],
	decisions: []
});
describe('worker evidence shape', () => {
	it('accepts documented minimal records and warns about optional provenance', () => {
		const r = checkWorkerEvidence(valid(), 'pilot');
		expect(r.ok).toBe(true);
		expect(r.warnings.length).toBeGreaterThan(0);
	});
	it('rejects both pilot field shapes rather than silently displaying an empty success', () => {
		for (const bad of [
			{ head: 'a', commands: [] },
			{ final_head: 'a', verify: [{ exit_code: 127 }] }
		]) {
			const r = checkWorkerEvidence(
				{ schema: 'fm-evidence.v1', task: 'pilot', ...bad, decisions: [] },
				'pilot'
			);
			expect(r.ok).toBe(false);
			expect(r.problems.some((p) => p.detail.includes('verify_commands'))).toBe(true);
		}
	});
	it('rejects synthetic legacy records and preserves an unresolved human gate', () => {
		for (const record of [blocked, legacyFailure]) {
			const result = checkWorkerEvidence(record, record.task);
			expect(result.ok).toBe(false);
			expect(result.problems).toContainEqual(
				expect.objectContaining({ code: 'verify-missing', path: 'verify_commands' })
			);
		}
		expect(checkWorkerEvidence(blocked, blocked.task).decisions[0].open).toBe(true);
	});
	it('requires skipped reasons only with null exits', () => {
		const r = valid();
		Object.assign(r.verify_commands[0], { exit: 127, skipped_reason: 'missing dependency' });
		expect(checkWorkerEvidence(r, 'pilot').ok).toBe(false);
		Object.assign(r.verify_commands[0], { exit: null });
		expect(checkWorkerEvidence(r, 'pilot').ok).toBe(true);
	});
	it('preserves unresolved human gates separately from settled decisions', () => {
		const r = checkWorkerEvidence(
			{
				...valid(),
				decisions: [{ rung: 'human-gate', choice: 'human-gate-x', why: 'UNRESOLVED: choose' }]
			},
			'pilot'
		);
		expect(r.decisions[0].open).toBe(true);
	});
	it('never throws for malformed arrays or null', () => {
		for (const v of [null, [], { ...valid(), verify_commands: [null], decisions: [null] }])
			expect(checkWorkerEvidence(v, 'pilot').ok).toBe(false);
	});
});
