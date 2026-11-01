import { redirect } from '@sveltejs/kit';
import { pullRequestReview } from '$lib/plugins/pullrequests';
import { currentFleet, currentPullRequestTabs } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

// Wheelhouse's own PR review page is gone: its address opens the task's pull request in the
// project's plugin review tab, else on GitHub, and a task with no pull request on its own page.
export const GET: RequestHandler = async ({ params }) => {
	const task = (await currentFleet()).tasks.find((t) => t.id === params.id);
	if (!task?.pr) redirect(307, `/tasks/${encodeURIComponent(params.id)}`);
	redirect(307, pullRequestReview(await currentPullRequestTabs(), task.projectId, task.pr).href);
};
