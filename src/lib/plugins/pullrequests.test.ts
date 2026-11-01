import { describe, expect, it } from 'vitest';
import { pullRequestReview, validPullRequestQuery } from './pullrequests';

const PR = { url: 'https://github.com/o/r/pull/7' };

describe('pullRequestReview', () => {
	it('opens the project’s review tab with the PR’s address in place of {url}', () => {
		const tabs = { alpha: '/projects/alpha/pr-review/review?pr={url}' };
		expect(pullRequestReview(tabs, 'alpha', PR)).toEqual({
			href: '/projects/alpha/pr-review/review?pr=https%3A%2F%2Fgithub.com%2Fo%2Fr%2Fpull%2F7',
			external: false
		});
	});

	it('falls back to the PR on GitHub without a tab for the project', () => {
		const tabs = { alpha: '/projects/alpha/pr-review/review?pr={url}' };
		for (const project of ['beta', null, 'constructor', '__proto__']) {
			expect(pullRequestReview(tabs, project, PR)).toEqual({ href: PR.url, external: true });
		}
	});
});

describe('validPullRequestQuery', () => {
	it('takes a query naming {url} once, with no fragment or spaces', () => {
		expect(validPullRequestQuery('?pr={url}')).toBe(true);
		expect(validPullRequestQuery('?stage=walkthrough&pr={url}')).toBe(true);
		for (const q of [
			undefined,
			3,
			'',
			'pr={url}',
			'?pr=',
			'?a={url}{url}',
			'?pr={url}#x',
			'? {url}'
		]) {
			expect(validPullRequestQuery(q)).toBe(false);
		}
		expect(validPullRequestQuery(`?pr={url}${'x'.repeat(200)}`)).toBe(false);
	});
});
