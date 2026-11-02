import { describe, expect, it } from 'vitest';
import { DEFAULT_TOUR_URL, playsInPlace, tourUrl } from './tour';

describe('tourUrl', () => {
	it('is the README’s tour section by default', () => {
		expect(tourUrl({})).toBe(DEFAULT_TOUR_URL);
		expect(tourUrl({ WHEELHOUSE_TOUR_URL: '  ' })).toBe(DEFAULT_TOUR_URL);
	});

	it('takes an http(s) address from WHEELHOUSE_TOUR_URL', () => {
		expect(tourUrl({ WHEELHOUSE_TOUR_URL: ' https://example.com/tour.mp4 ' })).toBe(
			'https://example.com/tour.mp4'
		);
		expect(tourUrl({ WHEELHOUSE_TOUR_URL: 'http://127.0.0.1:8000/tour.webm' })).toBe(
			'http://127.0.0.1:8000/tour.webm'
		);
	});

	it('keeps the default for anything that is not an http(s) address', () => {
		expect(tourUrl({ WHEELHOUSE_TOUR_URL: 'javascript:alert(1)' })).toBe(DEFAULT_TOUR_URL);
		expect(tourUrl({ WHEELHOUSE_TOUR_URL: 'file:///tmp/tour.mp4' })).toBe(DEFAULT_TOUR_URL);
		expect(tourUrl({ WHEELHOUSE_TOUR_URL: 'tour.mp4' })).toBe(DEFAULT_TOUR_URL);
	});
});

describe('playsInPlace', () => {
	it('plays video files and files uploaded to GitHub', () => {
		expect(playsInPlace('https://example.com/media/tour.mp4')).toBe(true);
		expect(playsInPlace('https://example.com/tour.WEBM?v=2')).toBe(true);
		expect(
			playsInPlace(
				'https://github.com/user-attachments/assets/0f7e2a1c-1111-2222-3333-444455556666'
			)
		).toBe(true);
	});

	it('opens anything else in a new tab', () => {
		expect(playsInPlace(DEFAULT_TOUR_URL)).toBe(false);
		expect(playsInPlace('https://example.com/user-attachments/assets/x')).toBe(false);
		expect(playsInPlace('not a url')).toBe(false);
	});
});
