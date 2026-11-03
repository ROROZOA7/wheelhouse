/**
 * Discussing a decision in the chat: the captain asks Firstmate about an open
 * question (or one already answered) from under its card. Firstmate only
 * receives text, so the question reaches it as an ordinary chat message that
 * starts with a Markdown quote naming the task, the decision key and the
 * question, with a second line telling Firstmate how to change the form the
 * captain answers with, then a blank line, then the captain's words:
 *
 *     > About the decision on lumen-pricing (key layout), not an answer yet: “Which pricing layout should ship?”
 *     > Wheelhouse: if your reply changes what the captain should choose from, end it with a decision-form block …
 *
 *     What's the risk?
 *
 * A `decision-form` block in Firstmate's reply replaces the decision's form
 * (lib/decisionform.ts). Messages from before the second line was added read
 * back the same way.
 * The chat reads that form back from the transcript and shows the message, and
 * the turn Firstmate answers it with, in the thread under the decision's card
 * instead of in the conversation. Pure, so it is unit-tested.
 */
import { formIn, type DecisionForm } from '../decisionform';
import type { Item } from './fold';
import type { Pending } from './outbox';
import { snippetOf } from './reply';

/** What a discussion names: the decision's card id is `<task id>:<key>`. */
export interface DiscussRef {
	taskId: string;
	key: string;
	question: string;
}

/** One message in a decision's thread. */
export interface ThreadMsg {
	id: string;
	who: 'captain' | 'firstmate';
	/** The captain's words without the quote, or Firstmate's reply as Markdown. */
	text: string;
	at: string | null;
	/** The question quoted in the discussion message it is, or answers. */
	question: string;
}

/** A decision's thread: its messages, and whether Firstmate is still answering. */
export interface Thread {
	messages: ThreadMsg[];
	answering: boolean;
}

const SLUG = /^[^\s()]+$/;
const QUOTED =
	/^> About the decision on ([^\s()]+) \(key ([^\s()]+)\), not an answer yet: “(.*)”\n(?:> [^\n]*\n)*\n([\s\S]+)$/;

/** How Firstmate changes the form the captain answers with, carried in every discussion message. */
export const FORM_HINT =
	'> Wheelhouse: if your reply changes what the captain should choose from, end it with a ```decision-form block: the question on its first line, then one "- option" line each ("- label: what it means", "(recommended)" on the one you recommend), or "- (written)" for a written answer. Wheelhouse shows it as the form the captain answers with.';

export const cardIdOf = (ref: Pick<DiscussRef, 'taskId' | 'key'>) => `${ref.taskId}:${ref.key}`;

/** Whether a discussion can name the decision: its task id and key have no spaces or brackets. */
export const canDiscuss = (ref: Pick<DiscussRef, 'taskId' | 'key'>) =>
	SLUG.test(ref.taskId) && SLUG.test(ref.key);

/** The text Firstmate receives for a question about a decision; empty when there are no words. */
export function discussText(ref: DiscussRef, body: string): string {
	const words = body.trim();
	if (!words || !canDiscuss(ref)) return '';
	return `> About the decision on ${ref.taskId} (key ${ref.key}), not an answer yet: “${snippetOf(ref.question)}”\n${FORM_HINT}\n\n${words}`;
}

/** A sent message back as the decision it is about and the captain's words; null when it is not one. */
export function parseDiscuss(
	text: string
): { cardId: string; question: string; body: string } | null {
	const m = text.replace(/\r\n?/g, '\n').match(QUOTED);
	if (!m || !m[4].trim()) return null;
	return { cardId: cardIdOf({ taskId: m[1], key: m[2] }), question: m[3], body: m[4].trim() };
}

/**
 * Firstmate's latest form in a thread, from its replies about `question`
 * only: a card id comes back for a new question, and a form for an earlier
 * one must not answer it.
 */
export function refinedForm(
	thread: Thread | null,
	question: string
): { id: string; form: DecisionForm } | null {
	const quoted = snippetOf(question);
	const msgs = thread?.messages ?? [];
	for (let i = msgs.length - 1; i >= 0; i--) {
		const m = msgs[i];
		const f = m.who === 'firstmate' && m.question === quoted ? formIn(m.text) : null;
		if (f) return { id: m.id, form: f };
	}
	return null;
}

/**
 * The threads of the decisions the chat shows (`cards`, by card id): each
 * captain message about one of them, with the reply Firstmate started right
 * after it, and the ids of those items, which the conversation leaves out. A
 * reply that also asks the captain something (a question picker) stays in the
 * conversation, where it can be answered.
 */
export function threads(
	items: Item[],
	cards: ReadonlySet<string>
): { byCard: Map<string, Thread>; hidden: Set<string> } {
	const byCard = new Map<string, Thread>();
	const hidden = new Set<string>();
	for (let i = 0; i < items.length; i++) {
		const it = items[i];
		if (it.kind !== 'user') continue;
		const d = parseDiscuss(it.text);
		if (!d || !cards.has(d.cardId)) continue;
		const thread = byCard.get(d.cardId) ?? { messages: [], answering: false };
		byCard.set(d.cardId, thread);
		thread.messages.push({
			id: it.id,
			who: 'captain',
			text: d.body,
			at: it.at,
			question: d.question
		});
		thread.answering = false;
		hidden.add(it.id);
		const next = items[i + 1];
		if (next?.kind !== 'turn' || next.trigger !== 'captain') continue;
		if (next.parts.some((p) => p.kind === 'question')) continue;
		hidden.add(next.id);
		for (const p of next.parts) {
			if (p.kind === 'text')
				thread.messages.push({
					id: p.id,
					who: 'firstmate',
					text: p.text,
					at: next.at,
					question: d.question
				});
		}
		thread.answering = !next.done && !next.interrupted;
		i++;
	}
	return { byCard, hidden };
}

/** The captain's questions still on their way, by card id; the conversation leaves them out. */
export function pendingThreads(
	pending: Pending[]
): Map<string, { pending: Pending; body: string }[]> {
	const out = new Map<string, { pending: Pending; body: string }[]>();
	for (const p of pending) {
		const d = parseDiscuss(p.text);
		if (!d) continue;
		out.set(d.cardId, [...(out.get(d.cardId) ?? []), { pending: p, body: d.body }]);
	}
	return out;
}
