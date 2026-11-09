import { mount, unmount } from 'svelte';
import { afterEach, expect, it } from 'vitest';
import WorkerEvidence from './WorkerEvidence.svelte';
import { checkWorkerEvidence } from '$lib/worker-evidence';
let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
});
it('lists schema problems instead of silently showing an empty record', () => {
	app = mount(WorkerEvidence, {
		target: document.body,
		props: {
			value: checkWorkerEvidence({ schema: 'fm-evidence.v1', task: 'pilot', verify: [] }, 'pilot')
		}
	});
	expect(document.body.textContent).toContain('Evidence does not follow fm-evidence.v1');
	expect(document.body.textContent).toContain('verify_commands');
	expect(document.body.textContent).toContain('local shape check');
});
it('renders commands and never labels unresolved gates settled', () => {
	const value = checkWorkerEvidence(
		{
			schema: 'fm-evidence.v1',
			task: 'pilot',
			pack: 'core',
			head_sha: 'a',
			verify_commands: [{ id: 'check', cmd: 'npm run check', exit: 127 }],
			decisions: [{ rung: 'human-gate', choice: 'human-gate-x', why: 'UNRESOLVED: choose' }]
		},
		'pilot'
	);
	app = mount(WorkerEvidence, { target: document.body, props: { value } });
	expect(document.body.textContent).toContain('Failed (exit 127)');
	expect(document.body.textContent).toContain('Open human gate');
	expect(document.body.textContent).not.toContain('Settled decision');
});
