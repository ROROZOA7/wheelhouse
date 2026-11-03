import { cardForm, recommendedOption, type FormAnswer } from '$lib/decisionform';
import type { InboxCard } from '$lib/inbox';
import { inbox } from './inbox.svelte';

/** Send one answer from a decision's form: its choice, with the picks or words it carries. */
export const answerWith = (card: InboxCard, a: FormAnswer, note: string | null, token: string) =>
	inbox.answer(card, a.choice, note, token, a.picks, a.decided);

/** Agree: send the option Firstmate recommends on the card's own form; false when there is none. */
export async function agreeWith(card: InboxCard, token: string): Promise<boolean> {
	const o = recommendedOption(cardForm(card));
	return o ? answerWith(card, o.answer, null, token) : false;
}
