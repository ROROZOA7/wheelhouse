import type { FeedbackList, FeedbackResult } from '$lib/plugins/elements';
import { SESSION_HEADER } from './messages';

/**
 * A plugin's feedback list to Wheelhouse, which writes the message and sends
 * it to Firstmate's inbox (`POST /api/plugins/<id>/feedback`, see
 * server/plugins/feedback.ts); the host API's `sendFeedback` calls it.
 */
export async function postFeedback(
	plugin: string,
	body: { taskId: string; subject: string | null; items: FeedbackList['items'] },
	token: string,
	requestId: string = `wh-${crypto.randomUUID()}`
): Promise<FeedbackResult> {
	try {
		const res = await fetch(`/api/plugins/${encodeURIComponent(plugin)}/feedback`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'idempotency-key': requestId,
				[SESSION_HEADER]: token
			},
			body: JSON.stringify(body)
		});
		if (res.ok) return { ok: true, pending: res.status === 202 };
		const data = (await res.json().catch(() => null)) as { message?: string } | null;
		return { ok: false, error: data?.message ?? `Wheelhouse answered ${res.status}.` };
	} catch {
		return { ok: false, error: 'Could not reach the Wheelhouse server.' };
	}
}
