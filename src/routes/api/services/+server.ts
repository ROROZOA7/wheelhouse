import { error, json } from '@sveltejs/kit';
import { NO_STORE, readJson } from '$lib/server/http';
import { pluginService } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

/**
 * A plugin's companion service. GET `?plugin=&service=[&project=]` says whether
 * it is up, and starts it when it is stopped and its plugin is on there, as
 * Wheelhouse does on its own (answering `starting`; see
 * server/plugins/autostart.ts); POST `{ plugin, service, project? }` is the
 * captain's Launch (the session token and Origin are checked for every POST):
 * it starts it even after Wheelhouse stopped retrying, and answers once it is
 * up or has failed.
 */
const query = (o: Record<string, unknown>) => {
	const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
	const plugin = str(o.plugin);
	const service = str(o.service);
	if (!plugin || !service) error(400, 'Name a plugin and a service.');
	return { plugin, service, project: str(o.project) };
};

export const GET: RequestHandler = async ({ url }) => {
	const view = await pluginService(query(Object.fromEntries(url.searchParams)));
	if (!view) error(404, 'No such service here.');
	return json(view, { headers: NO_STORE });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await readJson(request, 4 * 1024);
	if (!body.ok) return body.response;
	const view = await pluginService(query(body.body), 'launch');
	if (!view) error(404, 'No such service here.');
	return json(view, { headers: NO_STORE });
};
