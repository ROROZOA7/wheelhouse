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

describe('formAtEnd', () => {
	it('reads the form a reply ends with', () => {
		const f = formAtEnd(SHIP)!;
		expect(f.kind).toBe('choice');
		expect(f.prompt).toBe('Which should ship?');
		expect(f.from).toBe('firstmate');
		expect(formAtEnd(MERGE)?.kind).toBe('buttons');
	});

	it('leaves a block with more words after it, such as an example, as text', () => {
		expect(formAtEnd(`${SHIP}\n\nThat is how a form looks.`)).toBeNull();
		expect(formAtEnd('No form here.')).toBeNull();
	});
});

describe('answerText and parseAnswer', () => {
	it('names the words decided, with a note after a blank line, and reads them back', () => {
		const a = { choice: 'approve' as const, picks: null, decided: 'Welcome page only' };
		expect(answerText(a, null)).toBe('Decided: Welcome page only');
		expect(answerText(a, '  After the release.  ')).toBe(
			'Decided: Welcome page only\n\nAfter the release.'
		);
		expect(parseAnswer('Decided: Welcome page only\n\nAfter the release.')).toBe(
			'Welcome page only'
		);
	});

	it('puts a written answer on one line, and sends nothing without words', () => {
		expect(answerText({ choice: 'approve', picks: null, decided: 'Ship\n it  Friday' }, null)).toBe(
			'Decided: Ship it Friday'
		);
		expect(answerText({ choice: 'approve', picks: null, decided: '  ' }, 'note')).toBe('');
		expect(parseAnswer('Let us go with the welcome page.')).toBeNull();
	});
});

describe('chatForms', () => {
	it('opens the latest form until the captain decides, then shows what was decided', () => {
		const items = [user('u1', 'How should onboarding work?'), turn('t1', [text('p1', SHIP)])];
		expect(chatForms(items, new Set()).get('p1')).toMatchObject({
			decided: null,
			active: true
		});
		const answered = [...items, user('u2', 'Decided: Welcome page only')];
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
		expect(chatForms(items, new Set(), ['Decided: Three-step tour']).get('p1')).toMatchObject({
			decided: 'Three-step tour',
			active: false
		});
	});

	it('closes a form a later one replaced, leaving only the latest open', () => {
		const items = [turn('t1', [text('p1', SHIP)]), turn('t2', [text('p2', MERGE)])];
		const forms = chatForms(items, new Set());
		expect(forms.get('p1')).toMatchObject({ decided: null, active: false });
		expect(forms.get('p2')).toMatchObject({ decided: null, active: true });
		// Its answer goes to the latest form, never the replaced one.
		const after = chatForms([...items, user('u1', 'Decided: Merge')], new Set());
		expect(after.get('p1')?.decided).toBeNull();
		expect(after.get('p2')?.decided).toBe('Merge');
	});

	it('leaves forms in a decision’s thread to that decision', () => {
		const items = [turn('t1', [text('p1', SHIP)])];
		expect(chatForms(items, new Set(['t1'])).size).toBe(0);
	});

	it('remembers an answer given from the page that the transcript does not show', () => {
		const items = [turn('t1', [text('p1', SHIP)])];
		expect(chatForms(items, new Set(), [], { p1: 'Welcome page only' }).get('p1')).toMatchObject({
			decided: 'Welcome page only',
			active: false
		});
	});
});
