import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PlaybookReader } from './reader';

const FIXTURE = path.join(import.meta.dirname, 'testdata');

async function firstmate(script?: string) {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'wh-playbooks-'));
	await mkdir(path.join(dir, 'bin'));
	if (script !== undefined) {
		const file = path.join(dir, 'bin', 'fm-pack.sh');
		await writeFile(file, `#!/bin/sh\n${script}\n`);
		await chmod(file, 0o755);
	}
	return dir;
}

const reader = (firstmateDir: string, fixtureDir: string | null = null) =>
	new PlaybookReader({ firstmateDir, homeDir: firstmateDir, env: process.env, fixtureDir });

describe('PlaybookReader', () => {
	it('hides playbooks when this Firstmate has no fm-pack.sh', async () => {
		const r = reader(await firstmate());
		expect(await r.source()).toEqual({ available: false, reason: expect.stringMatching(/absent/) });
		expect((await r.list()).ok).toBe(false);
	});

	it('reads the fixture, labelled as one, while fm-pack.sh is absent', async () => {
		const r = reader(await firstmate(), FIXTURE);
		expect(await r.source()).toEqual({ available: true, source: 'fixture', phase: 'A' });
		const list = await r.list();
		expect(list.ok && list.value.packs[0].name).toBe('core');
		const res = await r.resolve('wheelhouse');
		expect(res.ok && res.value.binding?.pack).toBe('core');
	});

	it('reports a project without a binding as unbound', async () => {
		const res = await reader(await firstmate(), FIXTURE).resolve('lumen');
		expect(res.ok && res.value.binding).toBeNull();
		expect(res.ok && res.value.readiness.note).toBe('no pack bound');
	});

	it('uses fm-pack.sh when it reports the contract, passing FM_HOME', async () => {
		const dir = await firstmate(`case "$1" in
version) echo '{"schema":"fm-pack.v1","contracts":["fm-pack.v1"],"phase":"A"}' ;;
resolve) echo "{\\"schema\\":\\"fm-pack.v1\\",\\"project\\":\\"$2\\",\\"skills\\":[],\\"binding\\":null,\\"readiness\\":{\\"ok\\":true},\\"fm_home\\":\\"$FM_HOME\\"}" ;;
esac`);
		const r = reader(dir, FIXTURE);
		expect(await r.source()).toEqual({ available: true, source: 'fm-pack', phase: 'A' });
		const res = await r.resolve('wheelhouse');
		expect(res.ok && res.value.project).toBe('wheelhouse');
		// Lists a partial answer leaves out are filled in.
		expect(res.ok && res.value.readiness.refusals).toEqual([]);
		expect(res.ok && res.value.hooks).toEqual([]);
	});

	it('refuses a script that does not report fm-pack.v1', async () => {
		const r = reader(await firstmate(`echo '{"schema":"something-else"}'`));
		expect(await r.source()).toMatchObject({ available: false });
	});

	it('never passes a project id that is not one', async () => {
		const res = await reader(await firstmate(), FIXTURE).resolve('../etc');
		expect(res).toEqual({ ok: false, reason: 'Not a project id.' });
	});
});
