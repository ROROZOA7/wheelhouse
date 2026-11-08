import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { codeOf, deliveryFor, matrixRows, shortDigest, type PackResolve } from './playbooks';

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
		expect(rows.filter((r) => r.kind === 'Skill')).toHaveLength(resolve.skills.length);
		expect(rows.find((r) => r.label === 'AskUserQuestion')?.kind).toBe('Banned tool');
		expect(rows.find((r) => r.label === 'grilling')?.kind).toBe('Banned skill');
		// A skill the binding turned off stays listed, marked.
		expect(rows.find((r) => r.label === 'core:visual')?.state).toBe('disabled');
	});

	it('shortens a digest and reads readiness codes in either form', () => {
		expect(shortDigest('sha256:' + 'a'.repeat(64))).toBe('sha256:aaaaaaaaaaaa');
		expect(codeOf('missing-skill')).toBe('missing-skill');
		expect(codeOf({ code: 'missing-skill', detail: 'tdd' })).toBe('missing-skill: tdd');
	});
});
