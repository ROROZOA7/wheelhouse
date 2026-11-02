#!/usr/bin/env node
// Stands in for `claude -p --output-format stream-json` when the PR review plugin's engine reviews
// the demo's share-links pull request (lumen#142). It works out the stage from the JSON shape the
// prompt asks for, as the plugin's own tests do, and streams a canned answer written for that PR,
// so the recording shows the stages filling in without a model or a network.
// FAKE_REVIEWER_DELAY_MS sets the pause between streamed chunks (default 18).

const args = process.argv.slice(2);
let prompt = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) prompt += chunk;

const delay = Number(process.env.FAKE_REVIEWER_DELAY_MS ?? 18);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (v) => process.stdout.write(JSON.stringify(v) + '\n');

function stageOf(text) {
	if (!text.includes('Answer with this JSON shape')) return 'chat';
	if (text.includes('"headline"')) return 'walkthrough';
	if (text.includes('"findings"')) return 'quality';
	if (text.includes('"complexity"')) return 'change';
	return 'skim';
}

const walkthrough = {
	headline: 'Albums can be shared with a link that expires, and an expired link explains itself.',
	what: 'A share link carries a random 12-byte token, an expiry (a day, a week, a month or never) and a downloads switch. The share dialog picks the expiry, and /s/<token> opens the album for a visitor without an account, or a friendly page once the link has run out.',
	why: 'Friends and family were asked to make an account just to look at a trip album. The token length went from 9 to 12 bytes after the automated review raised it.',
	evidence: [
		{ claim: 'A link expires after its days', status: 'pass', detail: 'tests/links.test.ts' },
		{
			claim: 'An expired link shows the friendly page',
			status: 'pass',
			detail: 'screenshot 1-expired-link'
		},
		{
			claim: 'The share dialog offers four expiries',
			status: 'pass',
			detail: 'screenshot 3-share-dialog'
		},
		{
			claim: 'Withdrawing a link',
			status: 'untested',
			detail: 'the docs promise it; no code or test yet'
		}
	],
	risks: [
		'The token is the only thing protecting a shared album',
		'Withdrawing a link is documented but not built'
	],
	stops: [
		{
			title: 'Links and their expiry',
			files: ['src/lib/server/links.ts', 'src/lib/server/albums.ts'],
			why: 'The model everything else reads: the token, the expiry and the album a link opens.'
		},
		{
			title: 'The expired-link page',
			files: ['src/routes/s/[token]/+page.server.ts', 'src/routes/s/[token]/+page.svelte'],
			why: 'What a visitor sees, and the one place expiry is checked.'
		},
		{
			title: 'The share dialog',
			files: ['src/lib/components/ShareDialog.svelte'],
			why: 'Where the owner picks the expiry; small, so read it last.'
		}
	],
	take: [
		'Eleven files, but only five carry logic. The rest are a test, a snapshot, docs, the README and a lockfile bump.',
		'Start with the link model in links.ts: the token length and the downloads default are the two decisions worth checking.',
		'Then the page a visitor lands on, then the dialog.'
	],
	questions: [
		'Why 12 bytes and not 16?',
		'Where is a link withdrawn?',
		'What does a visitor see for a bad token?'
	]
};

const quality = {
	take: ['Tidy and small. Two notes, neither blocking.'],
	findings: [
		{
			title: 'A rule hidden in a default argument',
			level: 'worth',
			file: 'src/lib/server/links.ts',
			from: 10,
			to: 14,
			body: '`allowDownloads = days !== null` reads the expiry to decide downloads. It is the product rule "links that never expire start without downloads", but it sits where a reader expects a plain default.',
			suggestion: 'Name the rule (downloadsByDefault(days)) and call it from createLink.'
		},
		{
			title: 'The whole select on one line',
			level: 'nit',
			file: 'src/lib/components/ShareDialog.svelte',
			from: 8,
			to: 8,
			body: 'Four options and a binding share one long line, so a new expiry means editing the middle of it.',
			suggestion: 'Map an array of { days, label } into the options.'
		}
	],
	questions: ['Is the downloads rule in the spec?', 'Should the expiries come from config?']
};

const stops = {
	'src/lib/server/links.ts': {
		take: [
			'This is the heart of the PR: what a link is and when it stops working.',
			'The token is 12 random bytes in base64url, 16 characters. That is plenty against guessing, and still short enough to paste.'
		],
		complexity: 'moderate',
		rationale:
			'Little code, but the token and the downloads rule are security and product decisions.',
		notes: [
			{
				file: 'src/lib/server/links.ts',
				from: 10,
				to: 14,
				tag: 'moderate',
				title: 'Making a link',
				body: 'A fresh token, an expiry counted in days from now (null means never), and downloads off for links that never expire.',
				concern:
					'Expiry uses the server clock; a link made just before midnight lasts the full days, not calendar days.'
			},
			{
				file: 'src/lib/server/links.ts',
				from: 16,
				to: 16,
				tag: 'simple',
				title: 'Has it run out?',
				body: 'A link with no expiry never runs out; otherwise it has expired at its expiry time exactly.',
				concern: ''
			},
			{
				file: 'src/lib/server/albums.ts',
				from: 7,
				to: 11,
				tag: 'simple',
				title: 'The album a link opens',
				body: 'Looks the token up and returns its album, or null. It does not check expiry; the page does.',
				concern: 'A second caller could forget the expiry check. Consider checking it here.'
			}
		],
		alternatives: [
			{
				title: 'Signed tokens (JWT)',
				pros: 'No lookup per visit',
				cons: 'Cannot withdraw a link',
				verdict: 'worse'
			},
			{
				title: 'Check expiry in albumForLink',
				pros: 'One place decides',
				cons: 'The page still needs to know why',
				verdict: 'recommend'
			},
			{
				title: 'nanoid instead of randomBytes',
				pros: 'Already a dependency',
				cons: 'Same strength, another import',
				verdict: 'consider'
			}
		],
		pick: 'Keep random tokens in the database, and move the expiry check into albumForLink so every caller gets it.',
		questions: ['What happens to a link when its album is deleted?', 'Is 12 bytes enough?']
	},
	'src/routes/s/[token]/+page.server.ts': {
		take: [
			'The page a visitor lands on. An unknown token is a 404; a known but expired one is a friendly page.'
		],
		complexity: 'simple',
		rationale: 'One load function and one branch in the page.',
		notes: [
			{
				file: 'src/routes/s/[token]/+page.server.ts',
				from: 4,
				to: 8,
				tag: 'simple',
				title: 'Loading the link',
				body: 'Finds the link and hands the page whether it has expired, so the page can explain itself.',
				concern: ''
			},
			{
				file: 'src/routes/s/[token]/+page.svelte',
				from: 5,
				to: 10,
				tag: 'simple',
				title: 'Expired or not',
				body: 'An expired link asks the visitor to get a new one from whoever shared it; otherwise the album opens read-only.',
				concern: ''
			}
		],
		alternatives: [
			{
				title: 'Answer 410 Gone',
				pros: 'Honest to crawlers',
				cons: 'Visitors see an error',
				verdict: 'later'
			}
		],
		pick: 'As written: visitors without an account deserve a sentence, not a status code.',
		questions: ['Should the page offer a way to ask for a new link?']
	},
	'src/lib/components/ShareDialog.svelte': {
		take: ['The dialog the owner shares from. It only picks the expiry for now.'],
		complexity: 'simple',
		rationale: 'Markup and one piece of state.',
		notes: [
			{
				file: 'src/lib/components/ShareDialog.svelte',
				from: 3,
				to: 8,
				tag: 'simple',
				title: 'Choosing the expiry',
				body: 'Seven days by default, with tomorrow, thirty days and never.',
				concern: 'The downloads switch from the screenshots is not in this file yet.'
			}
		],
		alternatives: [
			{
				title: 'Radio buttons',
				pros: 'All choices visible',
				cons: 'Taller dialog',
				verdict: 'consider'
			}
		],
		pick: 'Fine as it is; add the downloads switch before merging.',
		questions: []
	}
};

const skimNotes = {
	'tests/links.test.ts': [
		'low',
		'Expiry after its days, and no downloads for links that never expire.'
	],
	'docs/adr/0004-share-link-tokens.md': ['low', 'Records the 12-byte token decision.'],
	'docs/sharing.md': ['medium', 'Promises withdrawing a link, which is not built yet.'],
	'README.md': ['low', 'Points to the sharing guide.'],
	'src/lib/server/albums.ts': ['low', 'Formatting only in remove().']
};

function answer(stage) {
	if (stage === 'walkthrough') return walkthrough;
	if (stage === 'quality') return quality;
	if (stage === 'change') {
		const files = (prompt.match(/Its files: (.*)/)?.[1] ?? '').split(', ');
		return stops[files[0]] ?? stops['src/lib/server/links.ts'];
	}
	if (stage === 'skim') {
		const files = Object.entries(skimNotes)
			.filter(([f]) => prompt.includes(f))
			.map(([file, [risk, note]]) => ({ file, risk, note }));
		return { take: ['Nothing risky left: a test, docs and the README.'], files, questions: [] };
	}
	return 'Twelve bytes is 96 bits of randomness, far past guessing at any request rate the site allows, and it keeps the link at 16 characters. Sixteen bytes would add six characters for no practical gain.';
}

if (args.includes('--version')) {
	console.log('2.1.40 (Claude Code)');
	process.exit(0);
}
const a = answer(stageOf(prompt));
const text = typeof a === 'string' ? a : JSON.stringify(a);
for (let i = 0; i < text.length; i += 48) {
	out({
		type: 'stream_event',
		event: {
			type: 'content_block_delta',
			index: 0,
			delta: { type: 'text_delta', text: text.slice(i, i + 48) }
		}
	});
	await sleep(delay);
}
out({
	type: 'result',
	subtype: 'success',
	is_error: false,
	result: text,
	usage: { input_tokens: prompt.length >> 2, output_tokens: text.length >> 2 }
});
