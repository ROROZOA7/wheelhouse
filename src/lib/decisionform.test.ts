import { describe, expect, it } from 'vitest';
import {
	cardForm,
	decidedLabel,
	formIn,
	recommendedOption,
	withoutForm,
	type DecisionForm
} from './decisionform';
import type { InboxCard, InboxChoices } from './inbox';

const base: Pick<InboxCard, 'kind' | 'choices' | 'recommendation'> = {
	kind: 'hold',
	choices: null,
	recommendation: null
};
const labels = (f: DecisionForm) =>
	f.kind === 'buttons' || f.kind === 'choice' ? f.options.map((o) => o.label) : [];

describe('cardForm', () => {
	it('gives a merge call two one-tap answers, Merge recommended', () => {
		const f = cardForm({ ...base, kind: 'merge' });
		expect(f.kind).toBe('buttons');
		expect(labels(f)).toEqual(['Merge', 'Not yet']);
		expect(recommendedOption(f)?.answer).toEqual({ choice: 'approve', picks: null, decided: null });
		expect(f.kind === 'buttons' && f.options[1].answer.choice).toBe('skip');
	});

	it('fits the plain answers to the kind and marks the recorded recommendation', () => {
		const hold = cardForm({ ...base, recommendation: { choice: 'fix', text: 'Not as built.' } });
		expect(labels(hold)).toEqual(['Go ahead', 'Not like this']);
		expect(recommendedOption(hold)?.label).toBe('Not like this');
		expect(labels(cardForm({ ...base, kind: 'preview' }))).toEqual([
			'Sign it off',
			'Request changes'
		]);
		expect(recommendedOption(cardForm(base))).toBeNull();
		// The review's questions keep their three calls, picked then decided.
		const review = cardForm({
			...base,
			kind: 'review',
			recommendation: { choice: 'skip', text: '' }
		});
		expect(review.kind).toBe('choice');
		expect(labels(review)).toEqual(['Keep it as is', 'Fix it', 'Leave it for later']);
		expect(recommendedOption(review)?.answer.choice).toBe('skip');
	});

	const one: InboxChoices = {
		intro: 'Which search?',
		after: null,
		calls: [
			{
				id: 'main',
				number: null,
				prompt: null,
				required: true,
				options: [
					{ id: 'A', label: 'Pagefind', detail: 'static', recommended: true },
					{ id: 'B', label: 'Algolia', detail: 'hosted', recommended: false }
				]
			}
		]
	};

	it('makes the options a question names a choice that sends the picks', () => {
		const f = cardForm({ ...base, choices: one });
		expect(f.kind).toBe('choice');
		expect(labels(f)).toEqual(['Pagefind', 'Algolia']);
		expect(recommendedOption(f)?.answer).toEqual({
			choice: 'approve',
			picks: { main: 'A' },
			decided: null
		});
	});

	it('keeps several calls as the card asks them', () => {
		const two = { ...one, calls: [...one.calls, { ...one.calls[0], id: '2', number: 2 }] };
		const f = cardForm({ ...base, choices: two });
		expect(f.kind).toBe('picks');
		expect(recommendedOption(f)).toBeNull();
	});
});

describe('formIn', () => {
	it('reads the last decision-form block of a reply', () => {
		const text = [
			'The tour teaches more, but most people skip it.',
			'',
			'```decision-form',
			'Which should ship?',
			'- Welcome page, tour behind a link: a "Show me around" link opens it (recommended)',
			'- Welcome page only',
			'- Three-step tour',
			'```'
		].join('\n');
		const f = formIn(text)!;
		expect(f.kind).toBe('choice');
		expect(f.prompt).toBe('Which should ship?');
		expect(f.from).toBe('firstmate');
		expect(f.kind === 'choice' && f.options[0]).toMatchObject({
			label: 'Welcome page, tour behind a link',
			detail: 'a "Show me around" link opens it',
			recommended: true,
			answer: { choice: 'approve', picks: null, decided: 'Welcome page, tour behind a link' }
		});
		expect(labels(f)).toEqual([
			'Welcome page, tour behind a link',
			'Welcome page only',
			'Three-step tour'
		]);
		expect(withoutForm(text)).toBe('The tour teaches more, but most people skip it.');
	});

	it('makes two short options one-tap buttons, and reads a written answer', () => {
		const yesNo = formIn('```decision-form\nMerge now?\n- Merge (recommended)\n- Not yet\n```')!;
		expect(yesNo.kind).toBe('buttons');
		expect(recommendedOption(yesNo)?.label).toBe('Merge');
		const written = formIn('Tell me which.\n```decision-form\nWhich browsers?\n- (written)\n```')!;
		expect(written).toEqual({ kind: 'text', prompt: 'Which browsers?', from: 'firstmate' });
	});

	it('finds nothing without a block, or in an empty one', () => {
		expect(formIn('Plain words, no form.')).toBeNull();
		expect(formIn('```decision-form\n```')).toBeNull();
		expect(formIn('```js\n- a\n```')).toBeNull();
	});
});

describe('decidedLabel', () => {
	it('reads an answer as what was decided', () => {
		const merge = cardForm({ ...base, kind: 'merge' });
		expect(decidedLabel(merge, { choice: 'approve', label: 'Approve', picks: null })).toBe('Merge');
		expect(decidedLabel(merge, { choice: 'skip', label: 'Skip', picks: null })).toBe('Not yet');
		expect(decidedLabel(null, { choice: 'approve', label: 'Decided', picks: 'Welcome page' })).toBe(
			'Welcome page'
		);
		expect(decidedLabel(null, { choice: 'fix', label: 'Fix', picks: null })).toBe('Fix');
	});
});
