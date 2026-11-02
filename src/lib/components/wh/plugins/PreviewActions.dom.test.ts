import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewCheck } from '$lib/preview';
import type { SlotEntry, SlotView } from '$lib/plugins/types';
import { taskSummary } from '../../../../../tests/helpers/task-summary';

vi.mock('$app/state', () => ({ page: { data: {} } }));
const { default: LivePreview } = await import('../LivePreview.svelte');
const { default: PreviewStudio } = await import('../PreviewStudio.svelte');
const { default: ChatPreview } = await import('../../firstmate/ChatPreview.svelte');
const { default: PreviewActions } = await import('./PreviewActions.svelte');

/*
 * Plugins' actions beside a task's live preview (the preview.actions slot):
 * where each place that draws a preview puts them, what the element gets, and
 * that the preview itself stays as it was. Each test uses a task of its own,
 * since the browser keeps a task's entries for 15 s.
 */

const URL_ = 'http://localhost:5173/app';
const check = (state: PreviewCheck['state'] = 'live'): PreviewCheck => ({
	url: state === 'none' ? null : URL_,
	reportedAt: null,
	state,
	reason: null,
	checkedAt: '2026-11-02T00:00:00Z'
});

const action = (taskId: string, o: Partial<SlotEntry> = {}): SlotEntry => ({
	key: 'share/share',
	slot: 'preview.actions',
	pluginId: 'share',
	contributionId: 'share',
	title: 'Share',
	order: 500,
	step: null,
	projectId: 'lumen',
	taskId,
	render: { element: 'share-button' },
	ui: '/api/plugins/share/ui/index.js?v=1',
	badge: null,
	content: { available: true, value: { shared: false }, source: 'a test', observedAt: null },
	...o
});

/** The element a plugin's bundle would define: it shows what it was given. */
class ShareButton extends HTMLElement {
	entry?: SlotEntry;
	#data: unknown;
	set data(v: unknown) {
		this.#data = v;
		this.textContent = `Share ${this.entry?.taskId} ${JSON.stringify(v)}`;
	}
	get data() {
		return this.#data;
	}
}
if (!customElements.get('share-button')) customElements.define('share-button', ShareButton);

let app: ReturnType<typeof mount> | null = null;
let fetchMock: ReturnType<typeof vi.fn>;
/** What /api/slots answers for a task's preview actions, and what its preview check says. */
let actions: SlotEntry[] = [];
let previewState: PreviewCheck['state'] = 'live';

beforeEach(() => {
	actions = [];
	previewState = 'live';
	fetchMock = vi.fn(async (u: string) => {
		if (u.startsWith('/api/slots?')) {
			const view: SlotView = { schema: 'wheelhouse-slots.v1', entries: actions };
			return new Response(JSON.stringify(view), { status: 200 });
		}
		if (u.endsWith('/preview')) return new Response(JSON.stringify(check(previewState)));
		return new Response('{}', { status: 404 });
	});
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
	if (app) unmount(app);
	app = null;
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

const slotCalls = () =>
	fetchMock.mock.calls.map(([u]) => u as string).filter((u) => u.startsWith('/api/slots'));

async function settle(until: () => unknown) {
	await vi.waitFor(() => expect(until()).toBeTruthy());
	flushSync();
	await tick();
}

/** The toolbar's items in order, by their text. */
const toolbarText = () =>
	[...document.querySelector('[data-live-preview] > div')!.children].map(
		(el) => el.textContent?.trim() ?? ''
	);

describe('preview actions in a live preview’s toolbar', () => {
	it('sits after Open in new tab and before Full screen, given the task’s entry and data', async () => {
		actions = [action('t-tool')];
		app = mount(LivePreview, {
			target: document.body,
			props: { taskId: 't-tool', feedback: false, onfullscreen: () => {} }
		});
		await settle(() => document.querySelector('share-button')?.textContent);
		expect(slotCalls()).toEqual(['/api/slots?task=t-tool']);
		const items = toolbarText();
		const open = items.findIndex((t) => t.includes('Open in new tab'));
		const share = items.findIndex((t) => t.includes('Share t-tool'));
		const full = items.findIndex((t) => t.includes('Full screen'));
		expect(open).toBeGreaterThan(-1);
		expect(share).toBe(open + 1);
		expect(full).toBe(share + 1);
		expect(document.querySelector('share-button')!.textContent).toBe(
			'Share t-tool {"shared":false}'
		);
		// The local preview stays embedded, at the address the worker reported.
		expect(document.querySelector('iframe')!.getAttribute('src')).toBe(URL_);
	});

	it('is left out without a reported preview, and where its host draws them itself', async () => {
		actions = [action('t-none')];
		previewState = 'none';
		app = mount(LivePreview, { target: document.body, props: { taskId: 't-none' } });
		await settle(() => document.querySelector('[data-live-preview="none"]'));
		expect(document.querySelector('[data-slot="preview.actions"]')).toBeNull();
		expect(slotCalls()).toEqual([]);
		unmount(app);

		previewState = 'live';
		app = mount(LivePreview, {
			target: document.body,
			props: { taskId: 't-off', feedback: false, actions: false }
		});
		await settle(() => document.querySelector('iframe'));
		expect(document.querySelector('[data-slot="preview.actions"]')).toBeNull();
		expect(slotCalls()).toEqual([]);
	});
});

describe('preview actions in the full-screen view', () => {
	it('sit in the header before Close, once', async () => {
		actions = [action('t-studio')];
		app = mount(PreviewStudio, {
			target: document.body,
			props: { taskId: 't-studio', title: 'Share links', url: URL_, feedback: false, onclose() {} }
		});
		await settle(() => document.querySelector('share-button')?.textContent);
		await settle(() => document.querySelector('iframe'));
		expect(document.querySelectorAll('share-button')).toHaveLength(1);
		const header = document.querySelector('[data-preview-studio] > div')!;
		const buttons = [...header.querySelectorAll('share-button, button')];
		expect(buttons.at(-2)?.tagName).toBe('SHARE-BUTTON');
		expect(buttons.at(-1)?.textContent).toMatch(/Close/);
	});
});

describe('preview actions on a chat preview card', () => {
	it('sit in the footer before Full size', async () => {
		actions = [action('t-chat')];
		const task = taskSummary('t-chat', 'needs-review', {
			preview: { url: URL_, reportedAt: '2026-11-02T00:00:00Z' }
		});
		app = mount(ChatPreview, {
			target: document.body,
			props: { preview: { task, landed: false }, now: Date.now() }
		});
		await settle(() => document.querySelector('share-button')?.textContent);
		const footer = document.querySelector('[data-chat-preview] footer')!;
		const items = [...footer.querySelectorAll('share-button, button')];
		expect(items[0].tagName).toBe('SHARE-BUTTON');
		expect(items[1].textContent).toMatch(/Full size/);
	});
});

describe('the example preview action plugin’s element', () => {
	it('opens a popover below the toolbar with the preview’s address', async () => {
		// Its UI bundle, as the page would import it.
		await import('../../../../../tests/fixtures/preview-actions-demo/wheelhouse/ui/index.js');
		actions = [
			action('t-demo', {
				key: 'preview-actions-demo/copy',
				pluginId: 'preview-actions-demo',
				contributionId: 'copy',
				title: 'Copy link',
				render: { element: 'preview-actions-demo-copy' },
				content: {
					available: true,
					value: { taskId: 't-demo', url: URL_ },
					source: 'a test',
					observedAt: null
				}
			})
		];
		app = mount(LivePreview, {
			target: document.body,
			props: { taskId: 't-demo', feedback: false, onfullscreen: () => {} }
		});
		const el = () => document.querySelector('preview-actions-demo-copy');
		await settle(() => el()?.shadowRoot?.querySelector('button'));
		const toggle = el()!.shadowRoot!.querySelector('button')!;
		expect(toggle.textContent).toBe('Copy link');
		toggle.click();
		const pop = el()!.shadowRoot!.querySelector('[role="dialog"]')!;
		expect(pop.textContent).toContain(URL_);
		expect(pop.getAttribute('aria-label')).toBe("Link to t-demo's preview");
	});
});

describe('PreviewActions', () => {
	it('says an action is not available, and draws blocks inline', async () => {
		actions = [
			action('t-1', {
				key: 'share/off',
				content: { available: false, reason: 'The share service is not running.' }
			}),
			action('t-1', {
				key: 'links/open',
				title: 'Links',
				render: { blocks: true },
				content: {
					available: true,
					value: [{ block: 'links.v1', links: [{ label: 'Public', href: 'https://x.test/' }] }],
					source: 'a test',
					observedAt: null
				}
			}),
			// Another slot's entry is never drawn here.
			action('t-1', { key: 'other/section', slot: 'task.section', title: 'Section' })
		];
		app = mount(PreviewActions, { target: document.body, props: { taskId: 't-1' } });
		await settle(() => document.querySelector('[data-preview-action="links/open"] a'));
		const drawn = [...document.querySelectorAll('[data-slot="preview.actions"]')];
		expect(drawn.map((d) => d.getAttribute('data-preview-action'))).toEqual([
			'share/off',
			'links/open'
		]);
		expect(drawn[0].textContent).toBe('Share not available');
		expect(drawn[0].querySelector('span')!.getAttribute('title')).toBe(
			'Not available. The share service is not running.'
		);
		expect(drawn[1].querySelector('a')!.getAttribute('href')).toBe('https://x.test/');
		expect(slotCalls()).toEqual(['/api/slots?task=t-1']);
	});
});
