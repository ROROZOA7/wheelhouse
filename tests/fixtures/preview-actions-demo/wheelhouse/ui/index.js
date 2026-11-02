/**
 * The example preview action as a custom element: a small Copy link button
 * that opens a popover below it with the preview's address and a Copy button.
 * Wheelhouse sets `entry` (with the task's id as `entry.taskId`) and `data`
 * (the provider's value); it styles itself with Wheelhouse's CSS variables.
 *
 * @typedef {{ taskId: string; url: string }} PreviewLink
 */

const STYLE = `
	:host { position: relative; display: inline-flex; font: inherit; color: var(--foreground); }
	button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer;
		border-radius: 0.25rem; padding: 0.125rem 0.375rem; }
	button:hover { background: var(--accent); }
	.pop { position: absolute; top: calc(100% + 0.375rem); right: 0; z-index: 30; width: max-content;
		max-width: 20rem; padding: 0.5rem 0.625rem; border: 1px solid var(--border);
		border-radius: var(--radius); background: var(--card); color: var(--card-foreground);
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.12); }
	.url { display: block; margin-bottom: 0.375rem; font-family: ui-monospace, monospace;
		overflow-wrap: anywhere; color: var(--muted-foreground); }
`;

export class PreviewActionsDemoCopy extends HTMLElement {
	/** @type {PreviewLink | null} */
	#data = null;
	#open = false;

	constructor() {
		super();
		this.attachShadow({ mode: 'open' });
	}

	/** @param {PreviewLink | null} value */
	set data(value) {
		this.#data = value;
		this.render();
	}

	get data() {
		return this.#data;
	}

	connectedCallback() {
		this.render();
	}

	render() {
		const d = this.#data;
		if (!d || !this.shadowRoot) return;
		const style = document.createElement('style');
		style.textContent = STYLE;
		const toggle = document.createElement('button');
		toggle.type = 'button';
		toggle.textContent = 'Copy link';
		toggle.setAttribute('aria-expanded', String(this.#open));
		toggle.addEventListener('click', () => {
			this.#open = !this.#open;
			this.render();
		});
		/** @type {HTMLElement[]} */
		const parts = [style, toggle];
		if (this.#open) {
			const pop = document.createElement('div');
			pop.className = 'pop';
			pop.setAttribute('role', 'dialog');
			pop.setAttribute('aria-label', `Link to ${d.taskId}'s preview`);
			const url = document.createElement('span');
			url.className = 'url';
			url.textContent = d.url;
			const copy = document.createElement('button');
			copy.type = 'button';
			copy.textContent = 'Copy';
			copy.addEventListener('click', async () => {
				await navigator.clipboard?.writeText(d.url).catch(() => {});
				copy.textContent = 'Copied';
			});
			pop.append(url, copy);
			parts.push(pop);
		}
		this.shadowRoot.replaceChildren(...parts);
	}
}

if (!customElements.get('preview-actions-demo-copy')) {
	customElements.define('preview-actions-demo-copy', PreviewActionsDemoCopy);
}
