import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseBatch } from '$lib/previewhelper';

vi.mock('$app/state', () => ({ page: { data: { sessionToken: 'tok' } } }));

const { default: PreviewHelper } = await import('./PreviewHelper.svelte');
const { previewHelpers } = await import('$lib/client/previewhelper.svelte');

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
	localStorage.clear();
	previewHelpers.byTask = {};
});

const settle = async () => {
	for (let i = 0; i < 6; i++) {
		await new Promise((r) => setTimeout(r, 0));
		await tick();
	}
	flushSync();
};
const say = (text: string) => {
	const box = document.querySelector<HTMLTextAreaElement>(
		'textarea[aria-label="Talk about this preview"]'
	)!;
	box.value = text;
	box.dispatchEvent(new Event('input'));
	flushSync();
	document.querySelector<HTMLButtonElement>('button[aria-label="Say it"]')!.click();
};

describe('the preview helper', () => {
	it('talks it through, builds an editable list, and sends nothing until Send', async () => {
		const posts: [string, Record<string, unknown>][] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init?: RequestInit) => {
				posts.push([url, JSON.parse(String(init?.body ?? '{}'))]);
				if (url.endsWith('/preview/helper')) {
					return Response.json({
						reply: 'The brief says 7 days. I would put it as:',
						suggest: ['Make share links last 30 days by default']
					});
				}
				return Response.json({ message: { delivery: 'delivered' } }, { status: 201 });
			})
		);
		let pointing = false;
		app = mount(PreviewHelper, {
			target: document.body,
			props: {
				task: { id: 'lumen-share', shortTitle: 'Share links' },
				url: 'http://127.0.0.1:5240/',
				attached: {
					pointer: { kind: 'element', label: 'the “In 7 days” menu', detail: null },
					at: { x: 0.8, y: 0.5 }
				},
				get pointing() {
					return pointing;
				},
				set pointing(v: boolean) {
					pointing = v;
				}
			}
		});
		flushSync();
		expect(document.querySelector('[data-attached]')?.textContent).toContain('“In 7 days” menu');
		say('7 days feels short');
		await settle();
		const [url, body] = posts[0];
		expect(url).toBe('/api/tasks/lumen-share/preview/helper');
		expect(body).toEqual({
			turns: [
				{
					who: 'captain',
					text: '7 days feels short',
					points: { kind: 'element', label: 'the “In 7 days” menu', detail: null }
				}
			],
			list: []
		});
		// Only the helper was asked: nothing has gone to Firstmate.
		expect(posts.some(([u]) => u === '/api/firstmate/messages')).toBe(false);
		expect(document.body.textContent).toContain('The brief says 7 days.');

		document.querySelector<HTMLButtonElement>('[data-add-to-list]')!.click();
		flushSync();
		expect(document.querySelector('[data-suggestion]')?.textContent).toContain('On your list');
		const line = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Feedback 1"]')!;
		expect(line.value).toBe('Make share links last 30 days by default');
		line.value = 'Make share links last 30 days by default, keep 7 in the menu';
		line.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(document.querySelector('[data-feedback-list]')?.textContent).toContain(
			'Points at the “In 7 days” menu'
		);

		document.querySelector<HTMLButtonElement>('[data-send-batch]')!.click();
		await settle();
		const sent = posts.find(([u]) => u === '/api/firstmate/messages')!;
		expect(sent[1].taskId).toBe('lumen-share');
		expect(parseBatch(String(sent[1].text))?.items).toEqual([
			{
				text: 'Make share links last 30 days by default, keep 7 in the menu',
				points: 'the “In 7 days” menu'
			}
		]);
		expect(document.querySelectorAll('textarea[aria-label^="Feedback"]')).toHaveLength(0);
		expect(document.body.textContent).toContain('Sent to Firstmate: 1 note');
		expect(document.querySelector('a[href="/"]')?.textContent).toBe('See it in the chat');
	});
});
