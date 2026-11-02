/**
 * An example plugin with one preview action. Its task-scoped provider hands
 * the element the task's reported preview address, and the entry is hidden
 * quietly for a task with no preview (`when: 'provider-available'`).
 *
 * @typedef {import('../../../../../packages/plugin-sdk/index.js').WheelhousePlugin} WheelhousePlugin
 */

/** @type {WheelhousePlugin} */
export default {
	providers: [
		{
			id: 'link',
			scope: 'task',
			ttlMs: 10_000,
			async fetch(ctx) {
				const task = ctx.task;
				const url = task?.preview?.url ?? null;
				if (!task || !url) return { available: false, reason: 'This task has no preview.' };
				return {
					available: true,
					value: { taskId: task.id, url },
					source: 'the task’s preview',
					observedAt: null
				};
			}
		}
	],
	contributions: [
		{
			slot: 'preview.actions',
			id: 'copy',
			title: 'Copy link',
			provider: 'link',
			when: 'provider-available',
			placement: { order: 100 },
			render: { element: 'preview-actions-demo-copy' }
		}
	]
};
