/**
 * Questions Firstmate asks in the conversation itself, outside any decision
 * card: a reply of Firstmate's that ends with a `decision-form` block
 * (lib/decisionform.ts) shows its words without the block, then the form, as
 * a decision's discussion does. Firstmate only receives text, so answering
 * sends an ordinary chat message from the captain naming what they decided,
 * with any note after a blank line:
 *
 *     Decided: Welcome page only
 *
 *     After the release, please.
 *
 * The chat reads that back from the transcript: the first such message after
 * a form answers it, and the form then shows what was decided. Only the
 * latest form still waiting for an answer can be answered; one a later form
 * replaced stays as it was, closed. Pure, so it is unit-tested.
 */
import { DECIDED_MAX, formIn, type DecisionForm, type FormAnswer } from '../decisionform';
import type { Item } from './fold';

/** A form Firstmate asked in the conversation, and where it stands. */
export interface ChatForm {
	form: DecisionForm;
	/** The words the captain decided, once answered. */
	decided: string | null;
	/** The latest form still waiting for an answer: the only one that can be answered. */
	active: boolean;
}

const BLOCK = /```decision-form[^\n]*\n[\s\S]*?(?:```|$)/g;
const ANSWER = /^Decided: (.+)$/;

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The form a reply of Firstmate's ends with; null when it does not end with one. */
export function formAtEnd(text: string): DecisionForm | null {
	const blocks = [...text.matchAll(BLOCK)];
	const last = blocks[blocks.length - 1];
	if (!last || text.slice(last.index + last[0].length).trim()) return null;
	return formIn(text);
}

/** The message Firstmate receives for an answer; empty when it names nothing. */
export function answerText(a: FormAnswer, note: string | null): string {
	const words = tidy(a.decided ?? '').slice(0, DECIDED_MAX);
	if (!words) return '';
	const more = note?.trim();
	return more ? `Decided: ${words}\n\n${more}` : `Decided: ${words}`;
}

/** The words a sent answer decided; null when the message is not one. */
export function parseAnswer(text: string): string | null {
	const first = text.replace(/\r\n?/g, '\n').trim().split('\n')[0];
	const words = ANSWER.exec(first)?.[1];
	return words ? tidy(words) || null : null;
}

/**
 * The forms Firstmate asked in the conversation, by the id of the reply part
 * that asks each. `hidden` are the items in a decision's thread, whose forms
 * belong to that decision; `pending` the texts of the captain's messages not
 * in the transcript yet, which come after everything in it; `sent` the words
 * decided from this page, by part id, for an answer the transcript does not
 * show (one that went to Firstmate's inbox).
 */
export function chatForms(
	items: Item[],
	hidden: ReadonlySet<string>,
	pending: string[] = [],
	sent: Readonly<Record<string, string>> = {}
): Map<string, ChatForm> {
	const out = new Map<string, ChatForm>();
	// The latest form still waiting for an answer.
	let open: ChatForm | null = null;
	const answer = (text: string) => {
		const words = open ? parseAnswer(text) : null;
		if (open && words) {
			open.decided = words;
			open = null;
		}
	};
	for (const it of items) {
		if (hidden.has(it.id)) continue;
		if (it.kind === 'user') answer(it.text);
		if (it.kind !== 'turn') continue;
		for (const p of it.parts) {
			const form = p.kind === 'text' ? formAtEnd(p.text) : null;
			if (!form) continue;
			const asked: ChatForm = { form, decided: sent[p.id] ?? null, active: false };
			out.set(p.id, asked);
			open = asked.decided === null ? asked : null;
		}
	}
	for (const text of pending) answer(text);
	if (open) open.active = true;
	return out;
}
