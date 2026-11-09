import { describe, expect, it } from 'vitest';
import { hasDetail, openByDefault, pickTab, prState, stepGist, taskTabs } from './taskpage';
import type { PassageStep, TaskEvidence, TaskSummary } from './types';

const step = (o: Partial<PassageStep> = {}): PassageStep => ({
	key: 'build',
	label: 'Building',
	short: 'Build',
	state: 'done',
	note: null,
	column: 'build',
	evidence: [],
	failed: false,
	...o
});

const task = (o: Partial<TaskSummary> = {}) => ({ pr: null, ...o }) as TaskSummary;

const NONE = { available: false as const, reason: 'none' };
const ev = (o: Partial<TaskEvidence> = {}): TaskEvidence => ({
	files: NONE,
	pr: NONE,
	report: NONE,
	screenshots: NONE,
	preview: NONE,
	decisions: [],
	validation: NONE,
	...o
});
const seen = <T>(value: T) => ({ available: true as const, value, source: 's', observedAt: null });

describe('task page tabs', () => {
	it('lists Stages first, Live preview only while one is reported, and Log last', () => {
		const base = { preview: false, shots: 0, plugins: [] };
		expect(taskTabs(base).map((t) => t.id)).toEqual(['stages', 'screenshots', 'log']);
		const all = taskTabs({
			preview: true,
			shots: 3,
			plugins: [{ key: 'project-links/links', title: 'Links' }]
		});
		expect(all.map((t) => t.id)).toEqual([
			'stages',
			'preview',
			'screenshots',
			'plugin:project-links/links',
			'log'
		]);
		expect(all.find((t) => t.id === 'screenshots')?.count).toBe(3);
		const built = taskTabs({ ...base, build: { talk: 4, docs: 0 } });
		expect(built.map((t) => t.id)).toEqual([
			'stages',
			'talk',
			'checks',
			'docs',
			'screenshots',
			'log'
		]);
		expect(built.find((t) => t.id === 'talk')?.count).toBe(4);
		expect(built.find((t) => t.id === 'docs')?.count).toBeUndefined();
		expect(all.find((t) => t.id === 'plugin:project-links/links')?.label).toBe('Links');
	});

	it('opens the asked-for tab when the page has it, else Stages', () => {
		const tabs = taskTabs({ preview: false, shots: 0, plugins: [] });
		expect(pickTab(null, tabs)).toBe('stages');
		expect(pickTab('log', tabs)).toBe('log');
		// A preview tab link for a task whose preview has gone falls back to Stages.
		expect(pickTab('preview', tabs)).toBe('stages');
	});
});

describe('how it worked tab', () => {
	it('sits after the build tabs, before Screenshots, when asked for', () => {
		const ids = taskTabs({
			preview: false,
			shots: 0,
			plugins: [],
			build: { talk: 0, docs: 0 },
			how: true
		}).map((t) => t.id);
		expect(ids).toEqual(['stages', 'talk', 'checks', 'docs', 'how', 'screenshots', 'log']);
	});
});

describe('stages', () => {
	it('expands only the current stage', () => {
		expect(openByDefault(step({ state: 'current' }))).toBe(true);
		for (const state of ['done', 'upcoming', 'skipped'] as const) {
			expect(openByDefault(step({ state }))).toBe(false);
		}
	});

	it('has detail to expand for reached stages and noted ones', () => {
		expect(hasDetail(step({ state: 'done' }))).toBe(true);
		expect(hasDetail(step({ state: 'upcoming' }))).toBe(false);
		expect(hasDetail(step({ state: 'skipped', note: 'No PR for a prototype' }))).toBe(true);
	});

	it('folds a finished stage to what its evidence came to', () => {
		const e = ev({
			files: seen({
				base: 'main',
				mergeBase: 'x',
				branch: 'b',
				files: [],
				total: 4,
				truncated: false
			}),
			pr: seen({
				url: 'https://github.com/o/r/pull/7',
				number: 7,
				state: 'merged',
				draft: false,
				reviewDecision: null,
				checks: []
			}),
			screenshots: seen([{ name: 'a.png', url: '/a.png', modifiedAt: '' }])
		});
		expect(stepGist(step({ evidence: ['files'] }), task(), e)).toBe('4 files changed');
		expect(stepGist(step({ evidence: ['pr', 'screenshots'] }), task(), e)).toBe(
			'Pull request #7 merged · 1 screenshot'
		);
		expect(stepGist(step({ evidence: ['validation'] }), task(), e)).toBe(
			'Checks done, outcome unknown'
		);
		expect(
			stepGist(
				step({ evidence: ['validation'] }),
				task({
					current: { detail: 'Ready in branch; verify cmds exit 127' } as TaskSummary['current']
				}),
				e
			)
		).toBe('Checks failed');
		expect(stepGist(step({ evidence: ['validation'], state: 'current' }), task(), e)).toBeNull();
	});

	it('requires valid successful commands and lets failures override success', () => {
		const worker: NonNullable<TaskEvidence['worker']> = {
			source: 'local shape check',
			ok: true,
			problems: [],
			warnings: [],
			head: 'a',
			decisions: [],
			commands: [{ id: 'check', cmd: 'npm test', exit: 0, skipped_reason: null }]
		};
		const validation = step({ evidence: ['validation'] });
		expect(stepGist(validation, task(), ev({ worker }))).toBe('Checks passed');
		expect(stepGist(validation, task(), ev({ worker: { ...worker, ok: false } }))).toBe(
			'Checks done, outcome unknown'
		);
		expect(
			stepGist(
				validation,
				task(),
				ev({
					worker: {
						...worker,
						commands: [{ ...worker.commands[0], exit: null, skipped_reason: 'not run' }]
					}
				})
			)
		).toBe('Checks done, outcome unknown');
		expect(
			stepGist(
				validation,
				task({ current: { detail: 'exit 127' } as TaskSummary['current'] }),
				ev({ worker })
			)
		).toBe('Checks passed');
		const stale = { ...worker, ok: false, commands: [{ ...worker.commands[0], exit: 127 }] };
		const passing = task({ pipeline: { outcome: 'passed' } as TaskSummary['pipeline'] });
		expect(
			stepGist(validation, passing, ev({ worker: stale, validation: seen({ detail: 'passed' }) }))
		).toBe('Checks passed');
		for (const detail of ['No checks failed', 'Fixed failed tests; all checks pass']) {
			expect(
				stepGist(validation, task({ current: { detail } as TaskSummary['current'] }), ev())
			).toBe('Checks done, outcome unknown');
			expect(
				stepGist(
					validation,
					task({ current: { detail } as TaskSummary['current'] }),
					ev({ worker })
				)
			).toBe('Checks passed');
		}
	});
	it('falls back to the note, and says nothing for stages not reached', () => {
		expect(stepGist(step({ note: 'Queued behind wh-2' }), task(), ev())).toBe('Queued behind wh-2');
		expect(stepGist(step({ state: 'upcoming', note: 'x' }), task(), ev())).toBeNull();
		expect(stepGist(step({ state: 'skipped', note: 'Not needed' }), task(), ev())).toBe(
			'Not needed'
		);
		// The PR known only from the summary still gets a line.
		const t = task({
			pr: { url: 'https://github.com/o/r/pull/9', number: 9 } as TaskSummary['pr']
		});
		expect(stepGist(step({ evidence: ['pr'] }), t, ev())).toBe('Pull request #9');
	});
});

describe('pull request state', () => {
	it('names a draft before its state', () => {
		expect(prState('open', true)).toBe('draft');
	});
	it('keeps known states and an unknown one as reported', () => {
		expect(prState('merged', false)).toBe('merged');
		expect(prState('closed', null)).toBe('closed');
		expect(prState('open', false)).toBe('open');
		expect(prState('QUEUED', false)).toBe('QUEUED');
		expect(prState(null, null)).toBe('state unknown');
	});
});
