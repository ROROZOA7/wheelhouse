/**
 * The video tour Help plays. It is never bundled with Wheelhouse: it is hosted
 * (uploaded to GitHub with the README), and Help opens it from there.
 * WHEELHOUSE_TOUR_URL points it elsewhere, such as the video file itself so it
 * plays inside Wheelhouse.
 */

/** The README's tour section, where the video plays on GitHub. */
export const DEFAULT_TOUR_URL = 'https://github.com/chrisjowen/wheelhouse#-take-the-tour';

/** The tour's address: WHEELHOUSE_TOUR_URL when it is an http(s) address, else the README's. */
export function tourUrl(env: Record<string, string | undefined>): string {
	const raw = env.WHEELHOUSE_TOUR_URL?.trim();
	if (!raw) return DEFAULT_TOUR_URL;
	try {
		const u = new URL(raw);
		return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : DEFAULT_TOUR_URL;
	} catch {
		return DEFAULT_TOUR_URL;
	}
}

/**
 * Whether the address is the video itself, which Help can play in place: a
 * video file, or a file uploaded to GitHub (`github.com/user-attachments/assets/…`).
 * Anything else, such as the README's section, opens in a new tab.
 */
export function playsInPlace(url: string): boolean {
	let u: URL;
	try {
		u = new URL(url);
	} catch {
		return false;
	}
	if (/\.(mp4|webm|m4v|mov)$/i.test(u.pathname)) return true;
	return u.hostname === 'github.com' && u.pathname.startsWith('/user-attachments/assets/');
}
