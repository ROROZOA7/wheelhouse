import { describe, expect, it } from 'vitest';
import { parseSlotKey, projectTabHref, slotKey } from './keys';

describe('slot keys', () => {
	it('round-trip a project and a task', () => {
		expect(parseSlotKey(slotKey.project('a b'))).toEqual({ scope: 'project', projectId: 'a b' });
		expect(parseSlotKey(slotKey.task('t/1'))).toEqual({ scope: 'task', taskId: 't/1' });
		expect(parseSlotKey(slotKey.fleet)).toEqual({ scope: 'fleet' });
	});

	it('narrow a task’s entries to one slot, ignoring a slot Wheelhouse does not have', () => {
		const key = slotKey.task('t/1&x', 'preview.actions');
		expect(key).toBe('task=t%2F1%26x&slot=preview.actions');
		expect(parseSlotKey(key)).toEqual({ scope: 'task', taskId: 't/1&x', slot: 'preview.actions' });
		expect(parseSlotKey('task=t-1&slot=nope')).toEqual({ scope: 'task', taskId: 't-1' });
	});

	it('give each project tab its own page', () => {
		expect(projectTabHref('acme', { pluginId: 'docket', contributionId: 'chart' })).toBe(
			'/projects/acme/docket/chart'
		);
		expect(projectTabHref('a/b', { pluginId: 'p', contributionId: 'c d' })).toBe(
			'/projects/a%2Fb/p/c%20d'
		);
	});
});
