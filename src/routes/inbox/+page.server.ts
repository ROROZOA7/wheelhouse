import { currentDecisions } from '$lib/server/runtime';
import type { PageServerLoad } from './$types';

// The calls Firstmate made itself, for Handled by Firstmate (the open questions come with the layout).
export const load: PageServerLoad = async () => ({ handled: await currentDecisions() });
