import { currentPlaybooks } from '$lib/server/runtime';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ playbooks: await currentPlaybooks(null) });
