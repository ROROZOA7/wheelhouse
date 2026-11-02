import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_TOUR_URL } from '$lib/tour';
import TourPlayer from './TourPlayer.svelte';

/** Help's tour: played in place when its address is the video, else opened on GitHub. */

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
});

function shown(url: string) {
	app = mount(TourPlayer, { target: document.body, props: { url } });
	flushSync();
	const links = [...document.querySelectorAll('a')];
	return {
		video: document.querySelector('video'),
		watch: links.find((a) => a.textContent?.includes('Watch the tour')),
		guide: links.find((a) => a.textContent?.includes('Read the guide'))
	};
}

describe('TourPlayer', () => {
	it('opens the README’s tour on GitHub, with nothing to play here', () => {
		const { video, watch, guide } = shown(DEFAULT_TOUR_URL);
		expect(video).toBeNull();
		expect(watch?.getAttribute('href')).toBe(DEFAULT_TOUR_URL);
		expect(watch?.getAttribute('target')).toBe('_blank');
		expect(guide?.getAttribute('href')).toContain('docs/guide.md');
	});

	it('plays the tour in place when its address is the video', () => {
		const url = 'https://github.com/user-attachments/assets/0f7e2a1c-1111-2222-3333-444455556666';
		const { video, watch } = shown(url);
		expect(video?.getAttribute('src')).toBe(url);
		expect(video?.hasAttribute('controls')).toBe(true);
		expect(watch).toBeUndefined();
	});
});
