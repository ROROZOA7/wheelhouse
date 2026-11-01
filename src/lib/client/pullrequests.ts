import { page } from '$app/state';
import {
	pullRequestReview,
	type PullRequestLink,
	type PullRequestTabs
} from '$lib/plugins/pullrequests';

/**
 * Where pull requests open for review on a page: each project's plugin review
 * tab (the root layout's `pullRequestTabs`, so it is right as the server
 * renders the page and whenever a page reloads it), else the pull request on
 * GitHub (see lib/plugins/pullrequests.ts).
 */
export const pullRequests = {
	/** The Review link for `pr`, one of `projectId`'s pull requests. */
	review(projectId: string | null, pr: { url: string }): PullRequestLink {
		const tabs = (page.data?.pullRequestTabs as PullRequestTabs | undefined) ?? {};
		return pullRequestReview(tabs, projectId, pr);
	}
};
