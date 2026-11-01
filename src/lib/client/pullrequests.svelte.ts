import {
	pullRequestReview,
	type PullRequestLink,
	type PullRequestTabs
} from '$lib/plugins/pullrequests';

/**
 * Where pull requests open for review in the browser: each project's plugin
 * review tab (the root layout's data, refreshed whenever a page reloads it),
 * else the pull request on GitHub (see lib/plugins/pullrequests.ts).
 */
class PullRequests {
	tabs = $state<PullRequestTabs>({});

	/** The Review link for `pr`, one of `projectId`'s pull requests. */
	review(projectId: string | null, pr: { url: string }): PullRequestLink {
		return pullRequestReview(this.tabs, projectId, pr);
	}
}

export const pullRequests = new PullRequests();
