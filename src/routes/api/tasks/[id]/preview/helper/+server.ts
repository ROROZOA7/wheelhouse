import { json } from '@sveltejs/kit';
import { NO_STORE } from '$lib/server/http';
import { answerAboutPreview } from '$lib/server/previewhelper';
import { readRequest } from '$lib/previewhelper';
import type { RequestHandler } from './$types';

const MAX_REQUEST_BYTES = 256 * 1024;

/**
 * The preview helper's answer to the captain's latest message about the
 * task's preview: `{ turns, list }` in, `{ reply, suggest }` out (see
 * lib/server/previewhelper.ts). It sends nothing anywhere. Origin and session
 * token are checked in hooks.server.ts.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
		return json({ message: 'Send the conversation as JSON.' }, { status: 415, headers: NO_STORE });
	}
	const raw = await request.text();
	if (Buffer.byteLength(raw) > MAX_REQUEST_BYTES) {
		return json({ message: 'The conversation is too large.' }, { status: 413, headers: NO_STORE });
	}
	let body: unknown;
	try {
		body = JSON.parse(raw);
	} catch {
		return json({ message: 'The request is not valid JSON.' }, { status: 400, headers: NO_STORE });
	}
	const req = readRequest(body);
	if (!req.ok) return json({ message: req.error }, { status: 400, headers: NO_STORE });
	const r = await answerAboutPreview(params.id, req.value);
	if (!r.ok) return json({ message: r.error }, { status: r.status, headers: NO_STORE });
	return json(r.value, { headers: NO_STORE });
};
