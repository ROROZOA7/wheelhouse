// Which Chrome the recorder drives: $CHROME_PATH, else the newest Chrome for Testing in
// Playwright's cache (`npx playwright-core install chromium` puts one there), else Google Chrome.
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CACHE = {
	darwin: path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
	linux: path.join(os.homedir(), '.cache', 'ms-playwright')
};
const BINARIES = [
	[
		'chrome-mac-arm64',
		'Google Chrome for Testing.app',
		'Contents',
		'MacOS',
		'Google Chrome for Testing'
	],
	['chrome-mac', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'],
	['chrome-linux64', 'chrome'],
	['chrome-linux', 'chrome']
];

/** @returns {import('playwright-core').LaunchOptions} */
export function launchOptions() {
	if (process.env.CHROME_PATH) return { executablePath: process.env.CHROME_PATH };
	const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? CACHE[process.platform];
	const dirs =
		cache && existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)) : [];
	dirs.sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)));
	for (const d of dirs) {
		for (const parts of BINARIES) {
			const p = path.join(cache, d, ...parts);
			if (existsSync(p)) return { executablePath: p };
		}
	}
	return { channel: 'chrome' };
}
