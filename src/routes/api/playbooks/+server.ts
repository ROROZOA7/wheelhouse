import { json } from '@sveltejs/kit';
import { currentPlaybooks } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

// Firstmate's playbook catalog (fm-pack.sh list), read-only. ?project= adds that project's
// resolved playbook (fm-pack.sh resolve).
export const GET: RequestHandler = async ({ url }) =>
	json(await currentPlaybooks(url.searchParams.get('project')), {
		headers: { 'cache-control': 'no-store' }
	});
