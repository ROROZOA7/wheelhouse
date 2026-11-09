import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

	it('never passes a project id that is not one, or one that reads as an option', async () => {
		const r = reader(await firstmate(), FIXTURE);
		expect(await r.resolve('../etc')).toEqual({ ok: false, reason: 'Not a project id.' });
		expect(await r.resolve('--help')).toEqual({ ok: false, reason: 'Not a project id.' });
		expect(await r.resolve('-x')).toEqual({ ok: false, reason: 'Not a project id.' });
	});

	it('runs fm-pack.sh once for callers at the same time', async () => {
		const dir = await firstmate(`echo x >> "$FM_HOME/calls"
case "$1" in
version) echo '{"schema":"fm-pack.v1","phase":"A"}' ;;
list) echo '{"schema":"fm-pack.v1","packs":[]}' ;;
esac`);
		const r = reader(dir);
		await Promise.all([r.source(), r.source(), r.source()]);
		await Promise.all([r.list(), r.list(), r.list()]);
		const calls = (await readFile(path.join(dir, 'calls'), 'utf8')).trim().split('\n');
		expect(calls).toHaveLength(2);
	});

	it('never throws on output that is JSON but not an object', async () => {
		const r = reader(await firstmate(`echo null`));
		expect(await r.source()).toMatchObject({ available: false });
	});

	it('shows a failing fm-pack.sh as failing, not the fixture, and tries again soon', async () => {
		let t = 0;
		const dir = await firstmate(`exit 1`);
		const r = new PlaybookReader({
			firstmateDir: dir,
			homeDir: dir,
			env: process.env,
			fixtureDir: FIXTURE,
			now: () => t
		});
		expect(await r.source()).toEqual({
			available: false,
			reason: expect.stringMatching(/version failed/)
		});
		await writeFile(
			path.join(dir, 'bin', 'fm-pack.sh'),
			`#!/bin/sh\necho '{"schema":"fm-pack.v1","phase":"A"}'\n`
		);
		t += 2 * 60_000;
		expect(await r.source()).toMatchObject({ available: true, source: 'fm-pack' });
	});

	it('tells health when detection changes its answer', async () => {
		const seen: unknown[] = [];
		const dir = await firstmate();
		const r = new PlaybookReader({
			firstmateDir: dir,
			homeDir: dir,
			env: process.env,
			onchange: (s) => seen.push(s)
		});
		await r.source();
		expect(seen).toHaveLength(1);
	});

	it('fills missing per-item fields so a partial answer still renders', async () => {
		const dir = await firstmate(`case "$1" in
version) echo '{"schema":"fm-pack.v1"}' ;;
list) echo '{"schema":"fm-pack.v1","packs":[{"name":"core","version":"0.1.0","digest":"sha256:ab"}]}' ;;
resolve) echo '{"schema":"fm-pack.v1","project":"p","binding":null,"skills":[{"id":"tdd","name":"core:tdd","phase":"task"}],"hooks":[{"id":"h"}],"readiness":{"ok":false,"refusals":["binding-invalid"]}}' ;;
esac`);
		const r = reader(dir);
		const list = await r.list();
		expect(list.ok && list.value.packs[0]).toMatchObject({
			risk: [],
			bound_projects: [],
			source: null,
			contents: { skills: 0, hooks: 0, mcp: 0 }
		});
		const res = await r.resolve('p');
		expect(res.ok && res.value.skills[0].delivery).toEqual({});
		expect(res.ok && res.value.hooks[0].delivery).toEqual({});
		expect(res.ok && res.value.readiness).toMatchObject({
			ok: false,
			refusals: ['binding-invalid']
		});
	});

	it('reports an fm-pack.sh that is there but cannot be run, never the fixture', async () => {
		const dir = await firstmate('echo never');
		await chmod(path.join(dir, 'bin', 'fm-pack.sh'), 0o644);
		expect(await reader(dir, FIXTURE).source()).toEqual({
			available: false,
			reason: expect.stringMatching(/cannot be run/)
		});
	});

	it('survives a health listener that throws', async () => {
		const dir = await firstmate();
		const r = new PlaybookReader({
			firstmateDir: dir,
			homeDir: dir,
			env: process.env,
			onchange: () => {
				throw new Error('boom');
			}
		});
		expect(await r.source()).toMatchObject({ available: false });
	});

	it('normalises readiness notices and skill kinds', async () => {
		const dir = await firstmate(`case "$1" in
version) echo '{"schema":"fm-pack.v1"}' ;;
resolve) echo '{"schema":"fm-pack.v1","project":"p","skills":[{"name":"a","kinds":[1,"bug"]}],"readiness":{"ok":false,"refusals":[null,{"code":"x","detail":2},"y"],"warnings":[{"nope":1}]}}' ;;
esac`);
		const res = await reader(dir).resolve('p');
		expect(res.ok && res.value.skills[0].kinds).toEqual(['1', 'bug']);
		expect(res.ok && res.value.readiness.refusals).toEqual(['unknown', { code: 'x' }, 'y']);
		expect(res.ok && res.value.readiness.warnings).toEqual(['[object Object]']);
	});
});
