import { readFileSync } from 'node:fs';
import path from 'node:path';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { PackResolve } from '$lib/playbooks';
import { unbound } from '$lib/server/playbooks/reader';
import PlaybookView from './PlaybookView.svelte';

const fixture = JSON.parse(
	readFileSync(
		path.join(import.meta.dirname, '../../../server/playbooks/testdata/resolve-wheelhouse.json'),
		'utf8'
	)
) as PackResolve;

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
});

const render = (r: PackResolve, isFixture = false) => {
	app = mount(PlaybookView, { target: document.body, props: { r, fixture: isFixture } });
	flushSync();
	return document.body;
};

describe('PlaybookView', () => {
	it('shows the bound pack, its skills and a delivery cell per harness', () => {
		const el = render(fixture);
		expect(el.querySelector('[data-binding]')?.textContent).toContain('core');
		expect(el.querySelector('[data-skill="core:tdd"]')).not.toBeNull();
		const firstRow = el.querySelector('[data-matrix] tbody tr')!;
		expect(firstRow.querySelectorAll('td')).toHaveLength(5);
		expect(firstRow.textContent).toContain('Advisory');
	});

	it('lists a skill under each phase that runs it', () => {
		const el = render(fixture);
		const phases = [...el.querySelectorAll('[data-skill="core:code-review"]')].map((e) =>
			e.getAttribute('data-skill-phase')
		);
		expect(phases.sort()).toEqual(['review', 'verify']);
	});

	it('keeps a turned-off skill listed, and shows what was ignored', () => {
		const el = render(fixture);
		expect(el.querySelector('[data-skill="core:visual"]')?.getAttribute('data-state')).toBe(
			'disabled'
		);
		expect(el.querySelector('[data-ignored]')?.textContent).toMatch(/may only narrow/);
	});

	it('shows project settings as the captain’s, never the pack’s', () => {
		const el = render(fixture);
		expect(el.querySelector('[data-project-settings]')?.textContent).toMatch(/never sets these/);
	});

	it('labels fixture data, and says when nothing is bound', () => {
		expect(render(fixture, true).querySelector('[data-fixture]')).not.toBeNull();
		unmount(app!);
		app = null;
		document.body.innerHTML = '';
		expect(render(unbound('lumen')).querySelector('[data-unbound]')).not.toBeNull();
	});

	it('says plainly when Firstmate would refuse to start workers', () => {
		const r = {
			...fixture,
			readiness: {
				ok: false,
				missing: ['tdd'],
				warnings: [],
				refusals: [{ code: 'digest-mismatch' }]
			}
		};
		const box = render(r).querySelector('[data-readiness="refused"]')!;
		expect(box.textContent).toContain('digest-mismatch');
		expect(box.textContent).toContain('Missing skill: tdd');
	});

	it('shows refusals even when no binding is present', () => {
		const el = render({
			...unbound('wheelhouse'),
			readiness: { ok: false, missing: [], warnings: [], refusals: ['binding-invalid'] }
		});
		expect(el.querySelector('[data-readiness="refused"]')?.textContent).toContain(
			'binding-invalid'
		);
		expect(el.querySelector('[data-unbound]')).not.toBeNull();
	});

	it('renders items whose ids collapsed to the same default', () => {
		const el = render({
			...unbound('wheelhouse'),
			binding: { pack: 'core', version: '0.1.0', digest: '', binding_digest: '' },
			banned: [
				{ id: '?', origin: 'pack', delivery: {} },
				{ id: '?', origin: 'pack', delivery: {} }
			]
		});
		expect(el.querySelectorAll('[data-binding]')).toHaveLength(1);
		expect(el.textContent?.split('?').length).toBeGreaterThan(2);
	});
});
