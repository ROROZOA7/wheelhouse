import { SLOTS, type Slot } from './types';

/**
 * How pages name what they want plugin entries for. The key doubles as the
 * `/api/slots` query string, so the server load and the browser's refresh ask
 * for the same thing.
 */
export type SlotKey = string;

export const slotKey = {
	fleet: 'fleet' as SlotKey,
	project: (id: string): SlotKey => `project=${encodeURIComponent(id)}`,
	/** A task's entries; with `slot`, only that slot's (a preview's actions, say). */
	task: (id: string, slot?: Slot): SlotKey =>
		`task=${encodeURIComponent(id)}${slot ? `&slot=${encodeURIComponent(slot)}` : ''}`
};

export type SlotQuery =
	| { scope: 'fleet' }
	| { scope: 'project'; projectId: string }
	| { scope: 'task'; taskId: string; slot?: Slot };

/** A slot name from a query string, or null when it names none Wheelhouse has. */
export const slotParam = (s: string | null): Slot | null =>
	s !== null && (SLOTS as readonly string[]).includes(s) ? (s as Slot) : null;

export function parseSlotKey(key: SlotKey): SlotQuery {
	if (key.startsWith('project=')) {
		return { scope: 'project', projectId: decodeURIComponent(key.slice('project='.length)) };
	}
	if (key.startsWith('task=')) {
		const [id, ...rest] = key.slice('task='.length).split('&');
		const slot = slotParam(new URLSearchParams(rest.join('&')).get('slot'));
		return { scope: 'task', taskId: decodeURIComponent(id), ...(slot ? { slot } : {}) };
	}
	return { scope: 'fleet' };
}

export const slotsUrl = (key: SlotKey) =>
	key === slotKey.fleet ? '/api/slots' : `/api/slots?${key}`;

/** A project.tab entry's own page: `/projects/<project>/<plugin>/<contribution>`. */
export const projectTabHref = (
	projectId: string,
	e: { pluginId: string; contributionId: string }
) =>
	`/projects/${encodeURIComponent(projectId)}/${encodeURIComponent(e.pluginId)}/${encodeURIComponent(e.contributionId)}`;

/** A nav.page entry's own page, a top-level menu item: `/plugins/<plugin>/<contribution>`. */
export const navPageHref = (e: { pluginId: string; contributionId: string }) =>
	`/plugins/${encodeURIComponent(e.pluginId)}/${encodeURIComponent(e.contributionId)}`;
