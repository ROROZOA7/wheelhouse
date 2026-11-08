import { describe, expect, it } from 'vitest';
import {
	conformance,
	firstLine,
	mcpName,
	parseTranscript,
	skillFromRead,
	summarize,
	type RecordedPack
} from './howitworked';

const WT = '/work/slot-3';
const BR = 'fm/wh-7';
const PACK = '/home/c/crew/data/.packs/core/0.1.0/sha256:abc';
const at = (s: number) => new Date(Date.UTC(2026, 10, 8, 10, 0, s)).toISOString();

/** One transcript record, as Claude Code writes it. */
const rec = (o: {
	s: number;
	type?: 'assistant' | 'user';
	content: unknown[];
	cwd?: string;
	branch?: string;
	usage?: object;
	toolUseResult?: object;
}) =>
	JSON.stringify({
		type: o.type ?? 'assistant',
		timestamp: at(o.s),
		cwd: o.cwd ?? WT,
		gitBranch: o.branch ?? BR,
		message: { content: o.content, ...(o.usage ? { usage: o.usage } : {}) },
		...(o.toolUseResult ? { toolUseResult: o.toolUseResult } : {})
	});
const use = (id: string, name: string, input: object) => ({ type: 'tool_use', id, name, input });
const result = (id: string, content: string, is_error = false) => ({
	type: 'tool_result',
	tool_use_id: id,
	content,
	is_error
});

const opts = {
	worktree: WT,
	branch: BR,
	since: Date.parse(at(0)),
	until: Date.parse(at(59)),
	packDirs: [PACK],
	packName: 'core'
};

describe('parseTranscript', () => {
	const lines = [
		rec({
			s: 1,
			content: [use('a', 'Read', { file_path: `${PACK}/skills/tdd/SKILL.md` })],
			usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5 }
		}),
		rec({ s: 2, content: [use('b', 'Bash', { command: 'npm test\n# second line' })] }),
		rec({ s: 5, type: 'user', content: [result('b', 'Exit code 1\nFAIL', true)] }),
		rec({ s: 6, content: [use('c', 'mcp__docket__search', { q: 'secret query text' })] }),
		rec({ s: 7, type: 'user', content: [result('c', 'a very long tool output '.repeat(50))] }),
		rec({ s: 8, content: [use('d', 'Edit', { file_path: `${WT}/src/a.ts`, old_string: 'x' })] }),
		rec({
			s: 9,
			content: [use('e', 'Agent', { subagent_type: 'Explore', description: 'Find callers' })]
		}),
		rec({ s: 10, content: [use('f', 'Skill', { skill: 'core:code-review' })] }),
		// Another task in the same pooled worktree slot, on another branch: not this task's.
		rec({ s: 11, branch: 'fm/wh-6', content: [use('g', 'Bash', { command: 'rm -rf old' })] }),
		// This branch but outside the window.
		JSON.stringify({
			type: 'assistant',
			timestamp: '2026-11-07T10:00:00Z',
			cwd: WT,
			gitBranch: BR,
			message: { content: [use('h', 'Bash', { command: 'yesterday' })] }
		}),
		'not json'
	];
	const r = parseTranscript(lines, opts);

	it('keeps only this task’s records: its worktree, branch and window', () => {
		expect(r.matched).toBe(true);
		const lines = r.events.map((e) => e.line);
		expect(lines).not.toContain('rm -rf old');
		expect(lines).not.toContain('yesterday');
	});

	it('names each step, with first lines only and never a tool’s output', () => {
		expect(r.events.map((e) => [e.kind, e.name])).toEqual([
			['skill', 'core:tdd'],
			['bash', 'Bash'],
			['mcp', 'docket/search'],
			['edit', 'Edit'],
			['agent', 'Explore'],
			['skill', 'core:code-review']
		]);
		expect(r.events[1].line).toBe('npm test');
		expect(r.events[3].line).toBe('src/a.ts');
		expect(r.events[4].line).toBe('Find callers');
		expect(JSON.stringify(r.events)).not.toContain('very long tool output');
		expect(JSON.stringify(r.events)).not.toContain('secret query text');
	});

	it('pairs a result with its call: failure, exit code and duration', () => {
		const bash = r.events[1];
		expect(bash).toMatchObject({ ok: false, exit: 1, durationMs: 3000 });
		expect(r.events[2]).toMatchObject({ ok: true, durationMs: 1000 });
	});

	it('adds up token use', () => {
		expect(r.tokens).toEqual({ input: 100, output: 20, cacheRead: 5 });
	});

	it('finds nothing in a transcript from another worktree', () => {
		expect(parseTranscript([rec({ s: 1, cwd: '/elsewhere', content: [] })], opts).matched).toBe(
			false
		);
	});
});

describe('summary and conformance', () => {
	const r = parseTranscript(
		[
			rec({ s: 1, content: [use('a', 'Read', { file_path: `${PACK}/skills/tdd/SKILL.md` })] }),
			rec({ s: 2, content: [use('b', 'Skill', { skill: 'browser-use' })] }),
			rec({ s: 3, content: [use('c', 'mcp__github__get_pr', {})] })
		],
		opts
	);
	const s = summarize(r.events, r.tokens, r.files.size, 1);
	const pack: RecordedPack = {
		binding: { pack: 'core', version: '0.1.0', digest: 'sha256:abc' },
		skills: [
			{ id: 'tdd', name: 'core:tdd', phase: 'task' },
			{ id: 'implement', name: 'core:implement', phase: 'task' },
			{ id: 'visual', name: 'core:visual', phase: 'verify', state: 'disabled' }
		],
		mcp: []
	};

	it('counts skills, MCP calls and their servers', () => {
		expect(s.skills).toEqual({ 'core:tdd': 1, 'browser-use': 1 });
		expect(s.mcp).toEqual({ 'github/get_pr': { calls: 1, failed: 0 } });
	});

	it('names skills given but unused, skills used outside the pack, and MCP outside it', () => {
		const c = conformance(s, pack)!;
		expect(c.used).toEqual(['core:tdd']);
		// A skill the binding turned off is not expected.
		expect(c.unused).toEqual(['core:implement']);
		expect(c.outside).toEqual(['browser-use']);
		expect(c.mcpOutside).toEqual(['github']);
		expect(c.basis).toMatch(/read its SKILL\.md/);
	});

	it('has nothing to compare without a recorded pack', () => {
		expect(conformance(s, null)).toBeNull();
	});
});

describe('helpers', () => {
	it('cuts to a first line', () => {
		expect(firstLine('\n  ls -la\nmore')).toBe('ls -la');
		expect(firstLine('x'.repeat(300))!.length).toBe(140);
		expect(firstLine(undefined)).toBeNull();
	});
	it('splits MCP tool names', () => {
		expect(mcpName('mcp__docket__search')).toEqual({ server: 'docket', tool: 'search' });
		expect(mcpName('Bash')).toBeNull();
	});
	it('maps a pack SKILL.md read to its skill, only under the pack', () => {
		expect(skillFromRead(`${PACK}/skills/tdd/SKILL.md`, [PACK])).toBe('tdd');
		expect(skillFromRead(`${PACK}/skills/tdd/references/x.md`, [PACK])).toBeNull();
		expect(skillFromRead('/elsewhere/skills/tdd/SKILL.md', [PACK])).toBeNull();
	});
});
