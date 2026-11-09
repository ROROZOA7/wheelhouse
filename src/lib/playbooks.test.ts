import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	codeOf,
	deliveryFor,
	matrixRows,
	shortDigest,
	skillsByPhase,
	type PackResolve
} from './playbooks';

const resolve = JSON.parse(
	readFileSync(
		path.join(import.meta.dirname, 'server/playbooks/testdata/resolve-wheelhouse.json'),
		'utf8'
	)
) as PackResolve;

describe('playbooks', () => {
	it('reads delivery per harness, or one value for every harness', () => {
		expect(deliveryFor({ claude: 'enforced', codex: 'advisory' }, 'claude')).toBe('enforced');
		expect(deliveryFor({ claude: 'enforced' }, 'pi')).toBeNull();
		expect(deliveryFor('advisory', 'opencode')).toBe('advisory');
	});

	it('lists every skill, banned item, hook and MCP server in the matrix', () => {
		const rows = matrixRows(resolve);
		// One row per skill, though resolve lists code-review once per phase it runs in.
		const names = rows.filter((r) => r.kind === 'Skill').map((r) => r.label);
		expect(names.filter((n) => n === 'core:code-review')).toHaveLength(1);
		expect(new Set(names).size).toBe(names.length);
		expect(rows.find((r) => r.label === 'AskUserQuestion')?.kind).toBe('Banned tool');
		expect(rows.find((r) => r.label === 'grilling')?.kind).toBe('Banned skill');
		// A skill the binding turned off stays listed, marked.
		expect(rows.find((r) => r.label === 'core:visual')?.state).toBe('disabled');
	});

	it('groups (phase, skill) rows by phase in the order a task runs them', () => {
		const groups = skillsByPhase(resolve);
		expect(groups.map((g) => g.phase)).toEqual(['task', 'build', 'verify', 'review']);
		const inPhase = (p: string) => groups.find((g) => g.phase === p)!.skills.map((s) => s.name);
		expect(inPhase('verify')).toContain('core:code-review');
		expect(inPhase('review')).toContain('core:code-review');
	});

	it('shortens a digest and reads readiness codes in either form', () => {
		expect(shortDigest('sha256:' + 'a'.repeat(64))).toBe('sha256:aaaaaaaaaaaa');
		expect(codeOf('missing-skill')).toBe('missing-skill');
		expect(codeOf({ code: 'missing-skill', detail: 'tdd' })).toBe('missing-skill: tdd');
	});
});
