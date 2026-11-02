import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Project, TaskSummary } from '../../types';
import { loadBundledPlugins, type LoadedPlugins } from './loader';
import { PluginRegistry } from './registry';

/**
 * The example preview action (tests/fixtures/preview-actions-demo), loaded
 * through the loader as an installed plugin is: its preview.actions entry
 * carries the task's preview address, and is hidden for a task without one.
 */

const FIXTURE = path.resolve('tests/fixtures/preview-actions-demo');

describe('the example preview action plugin', () => {
	let dir: string;
	let loaded: LoadedPlugins;
	let reg: PluginRegistry;
	const project: Project = {
		id: 'lumen',
		name: 'Lumen',
		description: null,
		posture: null,
		registered: true,
		path: null,
		passage: null
	};
	const task = (id: string, preview: TaskSummary['preview']) =>
		({ id, projectId: 'lumen', title: id, status: 'working', pr: null, preview }) as TaskSummary;

	beforeAll(async () => {
		dir = mkdtempSync(path.join(tmpdir(), 'wh-preview-actions-'));
		cpSync(FIXTURE, path.join(dir, 'preview-actions-demo'), { recursive: true });
		loaded = await loadBundledPlugins(dir);
		const fleet = {
			projects: [project],
			tasks: [
				task('l-1', { url: 'http://127.0.0.1:5240/', reportedAt: '2026-11-02T09:00:00Z' }),
				task('l-2', null)
			]
		};
		reg = new PluginRegistry(
			[],
			{
				fleet: () => fleet,
				worktree: () => null,
				config: async () => ({
					config: { plugins: { 'preview-actions-demo': { enabled: true } } },
					error: null
				})
			},
			{ plugins: loaded.installed, problems: loaded.problems }
		);
	});
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	it('loads, adding actions beside a task’s live preview', () => {
		expect(loaded).toMatchObject({ problems: [], error: null });
		expect(reg.status()).toEqual([
			expect.objectContaining({
				id: 'preview-actions-demo',
				state: 'loaded',
				slots: ['preview.actions']
			})
		]);
	});

	it('gives the element the task and its preview, and hides it without a preview', async () => {
		const view = await reg.slots({ scope: 'task', taskId: 'l-1', slot: 'preview.actions' });
		expect(view.entries).toEqual([
			expect.objectContaining({
				key: 'preview-actions-demo/copy',
				slot: 'preview.actions',
				taskId: 'l-1',
				title: 'Copy link',
				order: 100,
				render: { element: 'preview-actions-demo-copy' },
				ui: expect.stringMatching(/^\/api\/plugins\/preview-actions-demo\/ui\/index\.js/),
				content: expect.objectContaining({
					available: true,
					value: { taskId: 'l-1', url: 'http://127.0.0.1:5240/' }
				})
			})
		]);
		const none = await reg.slots({ scope: 'task', taskId: 'l-2', slot: 'preview.actions' });
		expect(none.entries).toEqual([]);
	});
});
