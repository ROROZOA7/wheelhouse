import { json } from '@sveltejs/kit';
import { NO_STORE, readJson } from '$lib/server/http';
import { sendPluginFeedback } from '$lib/server/plugins/feedback';
import { getRuntime } from '$lib/server/runtime';
import { refuse } from '$lib/server/upgrade/requests';
import type { RequestHandler } from './$types';

/**
 * A plugin's feedback list to Firstmate (the `feedback` capability, see
 * lib/server/plugins/feedback.ts): `{ taskId, subject?, items: [{ text, points? }] }`
 * with an Idempotency-Key header, sent by the plugin's element on the
 * captain's click. Wheelhouse writes the message, in the preview feedback
 * list's shape, attributed to the plugin, and it goes to Firstmate's inbox as
 * one note about the task, as every Wheelhouse message does; it answers as
 * `POST /api/firstmate/messages` does. Origin and session token are checked
 * in hooks.server.ts.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const runtime = await getRuntime();
	if (!runtime.configured) return refuse(runtime.error, 503);
	if (!runtime.messenger) {
		return refuse(runtime.collector.health().messaging.reason ?? 'Messaging is not set up.', 503);
	}
	const body = await readJson(request, 64 * 1024);
	if (!body.ok) return body.response;
	const messenger = runtime.messenger;
	const r = await sendPluginFeedback(
		{
			sender: (plugin, task) => runtime.plugins.feedbackSender(plugin, task),
			send: (input) => messenger.send(input)
		},
		params.plugin,
		request.headers.get('idempotency-key'),
		body.body
	);
	if (!r.ok) return refuse(r.error, r.status);
	const status =
		r.message.delivery === 'uncertain' || r.message.delivery === 'sending'
			? 202
			: r.created
				? 201
				: 200;
	return json({ replay: !r.created, message: r.message }, { status, headers: NO_STORE });
};
