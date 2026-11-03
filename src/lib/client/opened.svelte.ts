/**
 * The decisions the captain brought into the chat from the Decisions page
 * (Chat about this, Change this call), by card id, remembered in this browser
 * so a question Firstmate is settling itself keeps its card in the
 * conversation once opened there. The newest are kept.
 */
const KEY = 'wheelhouse-chat-decisions';
const MAX = 50;

class OpenedDecisions {
	ids = $state<string[]>([]);
	private loaded = false;

	load() {
		if (this.loaded) return;
		this.loaded = true;
		try {
			const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
			if (Array.isArray(v)) this.ids = v.filter((x): x is string => typeof x === 'string');
		} catch {
			this.ids = [];
		}
	}

	add(id: string) {
		this.load();
		if (this.ids.includes(id)) return;
		this.ids = [...this.ids, id].slice(-MAX);
		try {
			localStorage.setItem(KEY, JSON.stringify(this.ids));
		} catch {
			// storage unavailable; it stays open for this page only
		}
	}
}

export const openedDecisions = new OpenedDecisions();
