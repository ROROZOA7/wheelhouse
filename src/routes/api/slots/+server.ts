import { error, json } from '@sveltejs/kit';
import { slotParam } from '$lib/plugins/keys';
import { currentSlots } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

/**
 * Plugin entries: `?task=<id>`, `?project=<id>`, or neither for the fleet
 * (Bridge cards). A task's can be narrowed to one slot with `&slot=<slot>`.
 */
export const GET: RequestHandler = async ({ url }) => {
	const task = url.searchParams.get('task');
	const project = url.searchParams.get('project');
	const slotName = url.searchParams.get('slot');
	if (task !== null && project !== null) error(400, 'Ask for a task or a project, not both.');
	const slot = slotParam(slotName);
	if (slotName !== null && (task === null || !slot)) {
		error(
			400,
			task === null ? 'Only a task’s entries can be narrowed to one slot.' : 'No such slot.'
		);
	}
	const view = await currentSlots(
		task !== null
			? { scope: 'task', taskId: task, ...(slot ? { slot } : {}) }
			: project !== null
				? { scope: 'project', projectId: project }
				: { scope: 'fleet' }
	);
	return json(view, { headers: { 'cache-control': 'no-store' } });
};
