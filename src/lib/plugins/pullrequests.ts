/**
 * Where a pull request opens for review. A plugin's project tab can say it
 * opens one pull request (its contribution's `opensPullRequest`, a query such
 * as `?pr={url}`); while that plugin is on for a project, every Review link on
 * one of the project's pull requests opens that tab with the PR's address in
 * place of `{url}`. With none, the link is the pull request on GitHub. Shared
 * by the server, which works out each project's tab, and the pages.
 */

/** Per project id, its review tab's address with `{url}` still in it. */
export type PullRequestTabs = Record<string, string>;

export const PR_URL = '{url}';

/** A query string (`?…`) naming `{url}` once, with no fragment, spaces or other characters. */
export function validPullRequestQuery(v: unknown): v is string {
	return (
		typeof v === 'string' &&
		v.length <= 200 &&
		/^\?[\x21-\x7e]*$/.test(v) &&
		!v.includes('#') &&
		v.split(PR_URL).length === 2
	);
}

export interface PullRequestLink {
	href: string;
	/** The pull request itself (on GitHub): open it in a new tab. */
	external: boolean;
}

/** Where the Review link for `pr` (a pull request of `projectId`) goes. */
export function pullRequestReview(
	tabs: PullRequestTabs,
	projectId: string | null,
	pr: { url: string }
): PullRequestLink {
	const tab = projectId && Object.hasOwn(tabs, projectId) ? tabs[projectId] : null;
	if (typeof tab !== 'string') return { href: pr.url, external: true };
	return { href: tab.replace(PR_URL, encodeURIComponent(pr.url)), external: false };
}
