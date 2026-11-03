import { describe, expect, it } from 'vitest';
import { pointAt } from './previewhelper';

describe('pointAt', () => {
	it('names the element clicked, the way the captain would', () => {
		document.body.innerHTML =
			'<div class="row"><span>Link expires</span><button><span>Copy link</span></button></div>';
		const p = pointAt(
			document.querySelector('button span'),
			{ x: 0.8, y: 0.2 },
			{ w: 1000, h: 600 }
		);
		expect(p).toEqual({
			kind: 'element',
			label: 'the “Copy link” button',
			detail: '<button> “Copy link”, near the top right of the page'
		});
	});

	it('names a spot when it cannot look inside the page', () => {
		expect(pointAt(null, { x: 0.5, y: 0.5 }, { w: 1000, h: 600 })).toEqual({
			kind: 'spot',
			label: 'a spot near the middle of the page',
			detail: '50% across and 50% down the part of the page in view (1000×600)'
		});
	});
});
