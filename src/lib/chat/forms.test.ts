import { describe, expect, it } from 'vitest';
import type { Item, Part } from './fold';
import { answerText, chatForms, formAtEnd, parseAnswer } from './forms';

const user = (id: string, text: string): Item => ({
	kind: 'user',
	id,
	text,
	at: '2026-11-05T09:00:00.000Z',
	queued: false,
	command: false
});
const turn = (id: string, parts: Part[]): Item => ({
	kind: 'turn',
	id,
	parts,
	at: '2026-11-05T09:00:05.000Z',
	durationMs: null,
	done: true,
	interrupted: false,
	trigger: 'captain'
});
const text = (id: string, t: string): Part => ({ kind: 'text', id, text: t });

const SHIP =
	'Two ways to go.\n\n```decision-form\nWhich should ship?\n- Welcome page, tour behind a link: a "Show me around" link opens it (recommended)\n- Welcome page only\n- Three-step tour\n```';
const MERGE = 'Checks are green.\n\n```decision-form\nMerge it now?\n- Merge\n- Not yet\n```\n';

const SHIP_ANSWER = (words: string) => `Decided: ${words} — for: “Which should ship?”`;
const MERGE_ANSWER = (words: string) => `Decided: ${words} — for: “Merge it now?”`;

describe('formAtEnd', () => {
	it('reads the form a reply ends with, and the words before it', () => {
		const r = formAtEnd(SHIP)!;
		expect(r.form.kind).toBe('choice');
		expect(r.form.prompt).toBe('Which should ship?');
		expect(r.form.from).toBe('firstmate');
		expect(r.words).toBe('Two ways to go.');
		expect(formAtEnd(MERGE)?.form.kind).toBe('buttons');
	});

	it('leaves a block with more words after it, such as an example, as text', () => {
		expect(formAtEnd(`${SHIP}\n\nThat is how a form looks.`)).toBeNull();
		expect(formAtEnd('No form here.')).toBeNull();
	});

	it('keeps an example block earlier in the reply in its words', () => {
		const example = 'A form looks like this:\n\n```decision-form\nReady?\n- Yes\n- No\n```';
		const r = formAtEnd(`${example}\n\n${MERGE}`)!;
		expect(r.form.prompt).toBe('Merge it now?');
		expect(r.words).toBe(`${example}\n\nChecks are green.`);
	});
});

describe('answerText and parseAnswer', () => {
	const ship = formAtEnd(SHIP)!.form;
	const a = { choice: 'approve' as const, picks: null, decided: 'Welcome page only' };

	it('names the words decided and the question, with a note after a blank line, and reads them back', () => {
		expect(answerText(ship, a, null)).toBe(SHIP_ANSWER('Welcome page only'));
		expect(answerText(ship, a, '  After the release.  ')).toBe(
			`${SHIP_ANSWER('Welcome page only')}\n\nAfter the release.`
		);
		expect(parseAnswer(`${SHIP_ANSWER('Welcome page only')}\n\nAfter the release.`)).toEqual({
			words: 'Welcome page only',
			question: 'Which should ship?'
		});
	});

	it('names no question for a form without one, and reads an answer that names none', () => {
		const bare = formAtEnd('```decision-form\n- Yes\n- No\n```')!.form;
		expect(bare.prompt).toBeNull();
		expect(answerText(bare, { ...a, decided: 'Yes' }, null)).toBe('Decided: Yes');
		expect(parseAnswer('Decided: Welcome page only')).toEqual({
			words: 'Welcome page only',
			question: null
		});
	});

	it('puts a written answer on one line, and sends nothing without words', () => {
		expect(answerText(ship, { ...a, decided: 'Ship\n it  Friday' }, null)).toBe(
			SHIP_ANSWER('Ship it Friday')
		);
		expect(answerText(ship, { ...a, decided: '  ' }, 'note')).toBe('');
		expect(parseAnswer('Let us go with the welcome page.')).toBeNull();
	});
});

describe('chatForms', () => {
	it('opens the latest form until the captain decides, then shows what was decided', () => {
		const items = [user('u1', 'How should onboarding work?'), turn('t1', [text('p1', SHIP)])];
		expect(chatForms(items, new Set()).get('p1')).toMatchObject({
			words: 'Two ways to go.',
			decided: null,
			active: true
		});
		const answered = [...items, user('u2', SHIP_ANSWER('Welcome page only'))];
		expect(chatForms(answered, new Set()).get('p1')).toMatchObject({
			decided: 'Welcome page only',
			active: false
		});
	});

	it('keeps a form open through other messages, and answers it from one still being sent', () => {
		const items = [
			turn('t1', [text('p1', SHIP)]),
			user('u1', 'What does the tour cost?'),
			turn('t2', [text('p2', 'About a day.')])
		];
		expect(chatForms(items, new Set()).get('p1')?.active).toBe(true);
		expect(chatForms(items, new Set(), [SHIP_ANSWER('Three-step tour')]).get('p1')).toMatchObject({
			decided: 'Three-step tour',
			active: false
		});
	});

	it('keeps each form answerable on its own when a later one is asked', () => {
		const items = [turn('t1', [text('p1', SHIP)]), turn('t2', [text('p2', MERGE)])];
		const forms = chatForms(items, new Set());
		expect(forms.get('p1')).toMatchObject({ decided: null, active: true });
		expect(forms.get('p2')).toMatchObject({ decided: null, active: true });
		const after = chatForms([...items, user('u1', SHIP_ANSWER('Welcome page only'))], new Set());
		expect(after.get('p1')).toMatchObject({ decided: 'Welcome page only', active: false });
		expect(after.get('p2')).toMatchObject({ decided: null, active: true });
	});

	it('answers the form an answer queued during a busy turn names, not a later one that turn asked', () => {
		// The captain answers p1 while the turn goes on; the turn then asks p2, and the answer lands after it.
		const items = [turn('t1', [text('p1', SHIP), text('p2', MERGE)])];
		const queued = chatForms(items, new Set(), [SHIP_ANSWER('Welcome page only')]);
		expect(queued.get('p1')).toMatchObject({ decided: 'Welcome page only', active: false });
		expect(queued.get('p2')).toMatchObject({ decided: null, active: true });
		const landed = [...items, user('u1', SHIP_ANSWER('Welcome page only'))];
		expect(chatForms(landed, new Set()).get('p2')).toMatchObject({ decided: null, active: true });
		const both = chatForms([...landed, user('u2', MERGE_ANSWER('Merge'))], new Set());
		expect(both.get('p1')?.decided).toBe('Welcome page only');
		expect(both.get('p2')?.decided).toBe('Merge');
	});

	it('gives an answer naming no question to the latest form only when it is one of its options', () => {
		const items = [turn('t1', [text('p1', SHIP), text('p2', MERGE)])];
		const stray = chatForms([...items, user('u1', 'Decided: Welcome page only')], new Set());
		expect(stray.get('p1')?.decided).toBeNull();
		expect(stray.get('p2')).toMatchObject({ decided: null, active: true });
		const fits = chatForms([...items, user('u1', 'Decided: Merge')], new Set());
		expect(fits.get('p2')?.decided).toBe('Merge');
		const written = [
			turn('t1', [text('p1', '```decision-form\nWhich browsers?\n- (written)\n```')])
		];
		expect(
			chatForms([...written, user('u1', 'Decided: The last two years')], new Set()).get('p1')
				?.decided
		).toBe('The last two years');
	});

	it('closes a form a later one with the same question replaced', () => {
		const again =
			'Still two ways.\n\n```decision-form\nWhich should ship?\n- Welcome page only\n- Three-step tour\n```';
		const items = [turn('t1', [text('p1', SHIP)]), turn('t2', [text('p2', again)])];
		const forms = chatForms([...items, user('u1', SHIP_ANSWER('Three-step tour'))], new Set());
		expect(forms.get('p1')).toMatchObject({ decided: null, active: false });
		expect(forms.get('p2')).toMatchObject({ decided: 'Three-step tour', active: false });
	});

	it('closes a form without a question once a later form is asked', () => {
		const bare = '```decision-form\n- Yes\n- No\n```';
		const forms = chatForms([turn('t1', [text('p1', bare), text('p2', MERGE)])], new Set());
		expect(forms.get('p1')).toMatchObject({ decided: null, active: false });
		expect(forms.get('p2')?.active).toBe(true);
	});

	it('leaves forms in a decision’s thread to that decision', () => {
		const items = [turn('t1', [text('p1', SHIP)])];
		expect(chatForms(items, new Set(['t1'])).size).toBe(0);
	});

	it('remembers an inbox answer given from the page whose message never shows', () => {
		const items = [turn('t1', [text('p1', SHIP)])];
		const sent = { p1: { text: SHIP_ANSWER('Welcome page only'), words: 'Welcome page only' } };
		expect(chatForms(items, new Set(), [], sent).get('p1')).toMatchObject({
			decided: 'Welcome page only',
			active: false
		});
	});

	describe('an answer sent from the page counts once, for its own form', () => {
		const again = `Still green.\n\n${MERGE}`;
		const merge = { text: MERGE_ANSWER('Merge'), words: 'Merge' };

		it('answers the earlier form when the same question is asked again before its message shows', () => {
			// A busy turn: the captain answers p1, the turn asks it again as p2, then the answer lands.
			const items = [turn('t1', [text('p1', MERGE), text('p2', again)])];
			for (const forms of [
				chatForms(items, new Set(), [merge.text], { p1: merge }),
				chatForms([...items, user('u1', merge.text)], new Set(), [], { p1: merge })
			]) {
				expect(forms.get('p1')).toMatchObject({ decided: 'Merge', active: false });
				expect(forms.get('p2')).toMatchObject({ decided: null, active: true });
			}
		});

		it('answers the later form and leaves the one it replaced closed', () => {
			const items = [turn('t1', [text('p1', MERGE)]), turn('t2', [text('p2', again)])];
			for (const forms of [
				chatForms(items, new Set(), [merge.text], { p2: merge }),
				chatForms([...items, user('u1', merge.text)], new Set(), [], { p2: merge })
			]) {
				expect(forms.get('p1')).toMatchObject({ decided: null, active: false });
				expect(forms.get('p2')).toMatchObject({ decided: 'Merge', active: false });
			}
		});

		it('still reads a second, identical message the page did not send', () => {
			const items = [turn('t1', [text('p1', MERGE), text('p2', again)])];
			const forms = chatForms(
				[...items, user('u1', merge.text), user('u2', merge.text)],
				new Set(),
				[],
				{ p1: merge }
			);
			expect(forms.get('p1')?.decided).toBe('Merge');
			expect(forms.get('p2')?.decided).toBe('Merge');
		});
	});
});
