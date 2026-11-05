/**
 * Questions Firstmate asks in the conversation itself, outside any decision
 * card: a reply of Firstmate's that ends with a `decision-form` block
 * (lib/decisionform.ts) shows its words without the block, then the form, as
 * a decision's discussion does. Firstmate only receives text, so answering
 * sends an ordinary chat message from the captain naming what they decided
 * and the question it answers, with any note after a blank line:
 *
 *     Decided: Welcome page only — for: “Which should ship?”
 *
 *     After the release, please.
 *
 * A form without a question line is answered with `Decided: <words>` alone.
 *
 * The chat reads answers back from the transcript (and from messages still
 * being sent, which come after it). An answer naming a question goes to the
 * latest form asked before it with that question that is still waiting, so a
 * form keeps its own answer even when a later one was asked first (an answer
 * queued while Firstmate's turn went on). An answer naming no question goes to
 * the latest form asked before it, only when that form is still waiting and
 * the words are one of its options (any words for a written form). So every
 * waiting form can be answered while it is the latest form with its question;
 * a form without a question only while it is the latest form of all. Any
 * other waiting form was replaced by a later one and stays closed. Pure, so
 * it is unit-tested.
 */
import { DECIDED_MAX, formIn, type DecisionForm, type FormAnswer } from '../decisionform';
import type { Item } from './fold';

/** A form Firstmate asked in the conversation, and where it stands. */
export interface ChatForm {
	form: DecisionForm;
	/** The reply's words before the form, as its bubble shows them. */
	words: string;
	/** The words the captain decided, once answered. */
	decided: string | null;
	/** Still waiting, and the latest form with its question: one that can be answered. */
	active: boolean;
}

/** A reply's words and the form it ends with. */
export interface ReplyForm {
	form: DecisionForm;
	words: string;
}

/** An answer the page sent: the message itself and the words it decided. */
export interface SentAnswer {
	text: string;
	words: string;
}

/** An answer read back from a message: the words decided and the question it names, if any. */
export interface Answer {
	words: string;
	question: string | null;
}

const BLOCK = /```decision-form[^\n]*\n[\s\S]*?(?:```|$)/g;
const ANSWER = /^Decided: (.+?)(?: — for: “(.+)”)?$/;

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
const message = (s: string) => s.replace(/\r\n?/g, '\n').trim();

/** The form a reply of Firstmate's ends with, and its words before it; null when it does not end with one. */
export function formAtEnd(text: string): ReplyForm | null {
	const blocks = [...text.matchAll(BLOCK)];
	const last = blocks[blocks.length - 1];
	if (!last || text.slice(last.index + last[0].length).trim()) return null;
	const form = formIn(text);
	return form && { form, words: text.slice(0, last.index).trim() };
}

/** The message Firstmate receives for an answer to a form; empty when it names nothing. */
export function answerText(form: DecisionForm, a: FormAnswer, note: string | null): string {
	const words = tidy(a.decided ?? '').slice(0, DECIDED_MAX);
	if (!words) return '';
	const question = tidy(form.prompt ?? '');
	const line = question ? `Decided: ${words} — for: “${question}”` : `Decided: ${words}`;
	const more = note?.trim();
	return more ? `${line}\n\n${more}` : line;
}

/** What a sent answer decided, and the question it names; null when the message is not one. */
export function parseAnswer(text: string): Answer | null {
	const first = text.replace(/\r\n?/g, '\n').trim().split('\n')[0];
	const m = ANSWER.exec(first);
	const words = m ? tidy(m[1]) : '';
	return words ? { words, question: m?.[2] ? tidy(m[2]) : null } : null;
}

/** Whether words a message decided are one of a form's answers. */
const fits = (form: DecisionForm, words: string) =>
	form.kind === 'text' ||
	(form.kind !== 'picks' && form.options.some((o) => o.answer.decided === words));

/**
 * The forms Firstmate asked in the conversation, by the id of the reply part
 * that asks each. `hidden` are the items in a decision's thread, whose forms
 * belong to that decision; `pending` the texts of the captain's messages not
 * in the transcript yet, which come after everything in it; `sent` the words
 * decided from this page and the message that sent them, by part id: such a
 * form stays decided even when its message never shows (one that went to
 * Firstmate's inbox), and each message the page sent answers only its own
 * form, once, so it is never counted again for another.
 */
export function chatForms(
	items: Item[],
	hidden: ReadonlySet<string>,
	pending: string[] = [],
	sent: Readonly<Record<string, SentAnswer>> = {}
): Map<string, ChatForm> {
	const out = new Map<string, ChatForm>();
	// Every form asked so far, oldest first.
	const asked: ChatForm[] = [];
	// The page's own sent messages whose echo has not shown yet, oldest first.
	const unechoed = Object.values(sent).map((a) => message(a.text));
	const answer = (text: string) => {
		const echo = unechoed.indexOf(message(text));
		if (echo >= 0) {
			unechoed.splice(echo, 1);
			return;
		}
		const a = parseAnswer(text);
		if (!a) return;
		const to = a.question
			? asked.findLast((f) => f.decided === null && tidy(f.form.prompt ?? '') === a.question)
			: asked.at(-1);
		if (to && to.decided === null && (a.question || fits(to.form, a.words))) to.decided = a.words;
	};
	for (const it of items) {
		if (hidden.has(it.id)) continue;
		if (it.kind === 'user') answer(it.text);
		if (it.kind !== 'turn') continue;
		for (const p of it.parts) {
			const reply = p.kind === 'text' ? formAtEnd(p.text) : null;
			if (!reply) continue;
			const f: ChatForm = { ...reply, decided: sent[p.id]?.words ?? null, active: false };
			out.set(p.id, f);
			asked.push(f);
		}
	}
	for (const text of pending) answer(text);
	const seen = new Set<string>();
	for (const f of asked.toReversed()) {
		const key = f.form.prompt ? tidy(f.form.prompt) : null;
		f.active = f.decided === null && (key === null ? f === asked.at(-1) : !seen.has(key));
		if (key !== null) seen.add(key);
	}
	return out;
}
