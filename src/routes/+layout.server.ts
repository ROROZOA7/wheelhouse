import {
	currentFleet,
	currentHealth,
	currentHeadroom,
	currentInbox,
	currentAddressRewrites,
	currentPullRequestTabs
} from '$lib/server/runtime';
import { sessionToken } from '$lib/server/session';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async () => ({
	fleet: await currentFleet(),
	health: await currentHealth(),
	// The header warns, from any page, only when an allowance will run out before it resets.
	atRisk: (await currentHeadroom()).atRisk,
	// The decision inbox: the header's count and the home rail's stack, then live in the browser.
	inbox: await currentInbox(),
	// Where addresses on this computer open instead, while a plugin's address rewrite is on.
	addressRewrites: await currentAddressRewrites(),
	// Where each project's pull requests open for review: a plugin's tab while one is on, else GitHub.
	pullRequestTabs: await currentPullRequestTabs(),
	// Issued only to pages Wheelhouse serves; mutating requests must echo it.
	sessionToken: sessionToken()
});
