import { currentFleet, currentPlaybooks, loadSlots } from '$lib/server/runtime';
import { repoUrl } from '$lib/server/repo';
import { slotKey } from '$lib/plugins/keys';
import type { PageServerLoad } from './$types';

// The project's playbook as Firstmate resolves it, and what its banner needs.
export const load: PageServerLoad = async ({ params }) => {
	const [playbooks, fleet, slots] = await Promise.all([
		currentPlaybooks(params.id),
		currentFleet(),
		loadSlots([slotKey.project(params.id)])
	]);
	const project = fleet.projects.find((p) => p.id === params.id);
	return {
		playbooks,
		repo: project ? await repoUrl(project.path).catch(() => null) : null,
		slots,
		slotsAt: Date.now()
	};
};
