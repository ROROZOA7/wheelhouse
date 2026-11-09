import { error, json } from '@sveltejs/kit';
import { taskHowItWorked } from '$lib/server/detail';
import type { RequestHandler } from './$types';

/**
 * How a task's worker worked, read from its session's transcripts only when the How it
 * worked tab asks: names, counts and first lines, never full tool output.
 */
export const GET: RequestHandler = async ({ params }) => {
	const r = await taskHowItWorked(params.id);
	if (!r.ok) error(r.status, r.message);
	return json(r.value, { headers: { 'cache-control': 'no-store' } });
};
