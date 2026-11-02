# Developing Wheelhouse

## Run from a clone

```bash
git clone https://github.com/chrisjowen/wheelhouse.git
cd wheelhouse
npm ci
npm run build
npm link          # puts your local `wheelhouse` on your PATH
```

To bring a clone up to date later, run `wheelhouse upgrade` (or use the header's update menu): it fast-forwards the clone to the default branch on GitHub, runs `npm ci` and `npm run build`, and restarts a running Wheelhouse. It refuses, changing nothing, while the clone has local changes, is on another branch or has commits of its own; see [Keeping Wheelhouse up to date](guide.md#keeping-wheelhouse-up-to-date).

For live reloading while you work on the UI:

```bash
npm ci
WHEELHOUSE_FIRSTMATE_DIR=~/firstmate WHEELHOUSE_HOME=~/crew npm run dev
```

In development Wheelhouse starts (or shows) the Firstmate session the same way, on its first request.

| Script               | Does                                                                                                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`      | Builds the web app (`build/`) and the CLIs (`dist/cli.js`, `dist/wh-vault.js`)                                                                                                                        |
| `npm run check`      | Type-checks the app (svelte-check) and the CLI (tsc)                                                                                                                                                  |
| `npm run lint`       | Prettier and ESLint                                                                                                                                                                                   |
| `npm run format`     | Formats everything with Prettier                                                                                                                                                                      |
| `npm run test:unit`  | Unit tests: adapter, store, messenger, security, collector, plugins, the messaging gateway, the Firstmate session and chat; `*.dom.test.ts` files mount components in a simulated browser (happy-dom) |
| `npm run test:smoke` | Builds, then starts the CLI against a fake Firstmate home                                                                                                                                             |
| `npm test`           | Both                                                                                                                                                                                                  |
| `npm run guide`      | Records the README's animated clips and the video tour against a throwaway demo; see [Recording the guide](#recording-the-guide)                                                                      |

The code is laid out as the spec describes: `src/routes` (UI and API), `src/lib/components`, `src/lib/server/firstmate` (the script adapter and data-source rules), `src/lib/server/collector` (polling and SSE), `src/lib/bell.ts` and `src/lib/server/bell` (the ship's bell's alerts; `src/lib/client/bell.svelte.ts` rings them in the browser), `src/lib/server/store` (message request ids and receipts), `src/lib/server/issues` (the issue watcher: what Wheelhouse rings or sends on its own for newly seen GitHub issues), `src/lib/server/sessions` (the Firstmate session, its transcript and terminal), `src/lib/server/insights` (decisions made for you, where time went and the work-time estimate, Claude usage), `src/lib/server/buildlog` (what a task's build looks like from the inside: the conversation, what each check found, the docs it read or changed), `src/lib/server/files` (the Markdown files Firstmate names, read only from inside the allowed folders, for the reader at `/files`; `src/lib/docpath.ts` finds those paths in text and links them), `src/lib/server/gateway` (the messaging gateway: the core that routes phone messages, alerts and buttons, pairing, its settings, record and audit log, and `channels/discord.ts`, whose tests run against a fake Discord; its commands are in `cli/gateway.ts`), `src/lib/chat` (how the transcript reads as a chat, including the lines that name attached files; `src/lib/server/uploads.ts` saves, serves and cleans up those files), `src/lib/voice` (dictation and its speech engine), `src/lib/server/upgrade` (checking and upgrading the clone Wheelhouse runs from, checking installed plugins for updates, and the service behind the header's update menu and the Plugins page's install and update; `src/lib/updates.ts` holds what the pages and the server share), `cli/index.ts` (the Commander entry point; `cli/supervise.ts` is the watcher that restarts the server when it dies or when `wheelhouse plugin` or `wheelhouse upgrade` asks it to, through `cli/running.ts`, or a page's upgrade or plugin change does, through `src/lib/server/restart.ts`; `wheelhouse upgrade` is in `cli/upgrade.ts`), and `cli/vault` (`wh-vault`: its commands, the Keychain backend behind the backend interface, output masking and the usage log; its tests never touch the real Keychain). The Vault page's changes are `src/lib/server/vault.ts` and `src/routes/api/vault`, which run the bundled `wh-vault` (their tests stub it with a script), drawn by `src/lib/components/wh/vault/`. Plugins live in `src/lib/plugins` (the slot and block contract, panels, custom elements, host templates and address rewrites in `addresses.ts`, where pull requests open for review in `pullrequests.ts`, and each compiled-in plugin), `src/lib/server/hostroutes` (handing `*.localhost` requests to a plugin's host route, and the addresses on this computer Wheelhouse has shown) and `src/lib/server/plugins` (the registry and enablement, and for installed plugins the manifest, the startup loader and `wheelhouse plugin`, whose commands are in `cli/plugin.ts`); `packages/plugin-sdk` is the plugin SDK and `plugins/` holds the plugins bundled with Wheelhouse in the installed-plugin format (Project links, GitHub issues, Vault), which the server loads at startup through the same loader.

## Recording the guide

The README's two animated clips and the video tour are recorded by a script, against a throwaway Wheelhouse running on a made-up crew, so they can be re-recorded whenever the pages change:

```bash
npm run guide                  # all three: chat, review, tour
npm run guide -- chat review   # just the clips
```

| Pass     | Records                                                                                                | Writes                                              |
| -------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `chat`   | The Firstmate chat: a live preview card, then a decision answered in its card with a note              | `docs/screenshots/guide-chat.png`, a looping APNG   |
| `review` | A task's **Review PR** link opening the pull request in the PR review plugin's tab, and its stages     | `docs/screenshots/guide-review.png`, a looping APNG |
| `tour`   | The captioned tour: home, chat, decisions, Harbour, a project, a task, PR review, plugins and **Help** | `tour.mp4` (1440×900, H.264) and `tour-poster.jpg`  |

It needs `ffmpeg`, `tmux`, `python3` and `git` on your PATH, ports 4950 and 4951 free, network access to GitHub, and Chrome: `$CHROME_PATH`, else the newest Chrome for Testing in Playwright's cache (`npx playwright-core install chromium` puts one there), else Google Chrome. The whole run takes about ten minutes. Leave the checkout alone while it records: the demo runs Vite's dev server from it, and a changed file reloads the page mid-recording.

How it works (`scripts/guide/`):

- `record.sh` is the entry point. It installs the [PR review](https://github.com/chrisjowen/pr-review-wheelhouse) plugin with `wheelhouse plugin install`, into a scratch directory (`$PR_REVIEW_REF` picks a tag, branch or commit), and screenshots the made-up Lumen app (`appshots.mjs`). Then, for each pass, it builds a fresh demo home (`demo/build-demo.mjs`), starts Wheelhouse's dev server on 127.0.0.1:4950 against it (`demo/run-demo.sh`), records, stops everything it started (`demo/stop-demo.sh`, which also stops the plugin's review engine) and encodes. Everything but the clips stays in `$WORK`, a new temporary directory unless you set it; the tour ends up there too.
- The demo home is synthetic: projects, tasks, chat, pull requests and paths are made up. Its own `HOME`, state, config, plugins and tmux server keep it apart from your real Wheelhouse and Firstmate. A stand-in `claude` plays the Firstmate session, and answers the PR review plugin's `claude -p` with canned stages written for the demo's pull request (`demo/fake-reviewer.mjs`); a stand-in `gh` serves that pull request from the demo's own git history. No model, account or GitHub API is used.
- `record.mjs` drives headless Chrome with `playwright-core`. Frames come from Chrome's screencast, each with its own timestamp, so a busy machine records fewer frames, not a faster video. `overlay.js` draws the cursor, click rings, captions and title cards. A pass that sees no frame for 20 seconds (the machine slept) fails, to be run again.
- `encode.sh` makes the clips with ffmpeg: cropped to the column the flow happens in, at native pixels so the text stays readable at the width GitHub shows README images, 15 frames a second and one 256-colour palette. Keep each clip under 15 seconds and about 1.5 MB.

The clips are committed. The tour is not, and it is not in the npm package: it is uploaded to GitHub by hand, because GitHub only plays a video inline in a README when it is a `user-attachments` upload, and there is no API for those. To publish a new tour:

1. Edit `README.md` on GitHub (or any issue or pull request comment box) and drag `tour.mp4` in. GitHub uploads it and inserts a `https://github.com/user-attachments/assets/…` address (up to 10 MB on a free plan).
2. Put that address on its own line in the README's **Take the tour** section, in place of the previous one (or of the placeholder comment), and commit.

**Help** in Wheelhouse's header plays the tour from where it is hosted; nothing is bundled. By default it opens the README's tour section; set `WHEELHOUSE_TOUR_URL` to the uploaded video's address and it plays inside Wheelhouse instead.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and every push to `main`: `npm ci`, `npm run check`, `npm run lint`, `npm run test:unit`, and `npm pack --dry-run`, whose `prepack` step runs `npm run build`, so a broken build fails CI too. It then packs the package into a temporary directory, installs the tarball globally into a temporary prefix and runs `wheelhouse --help` and `wheelhouse --version`, so a package that builds but fails to start fails CI.

## Releasing

`.github/workflows/release.yml` publishes `@chrisjowen/wheelhouse` to npm when a `vX.Y.Z` tag is pushed or a GitHub release is published. It checks that the tag matches the version in `package.json`, runs the type-check, lint and unit tests, installs the packed tarball into a temporary prefix and runs `wheelhouse --help` and `wheelhouse --version`, then runs `npm publish --provenance --access public`; a pre-release version such as `1.2.0-beta.1` goes to the `next` dist-tag instead of `latest`. A tag push and the release made from it run one after the other, and whichever comes second finds the version already on npm and skips.

The package ships only `build/` (the web app), `dist/cli.js` (the CLI), `dist/wh-vault.js` (the vault helper), the bundled `plugins/`, the README and the licence, without source maps. `npm pack --dry-run` lists exactly what would be published.

To release a version:

1. Bump `version` in `package.json` (and `package-lock.json`, for example with `npm version 0.2.0 --no-git-tag-version`) in a pull request, and merge it.
2. Tag the merge commit on `main` and push the tag (`git tag v0.2.0 && git push origin v0.2.0`), or publish a GitHub release with a new `v0.2.0` tag.

### One-time npm setup

The release workflow authenticates in one of two ways:

- **Trusted publishing (preferred).** On npmjs.com, open the package's settings, add a trusted publisher for GitHub Actions with owner `chrisjowen`, repository `wheelhouse` and workflow `release.yml` (no environment). The workflow then publishes through GitHub's OIDC token, with no secret to manage, and npm shows a provenance attestation for each version. At the time of writing npm only lets you add a trusted publisher to a package that already exists, so the very first version has to be published with the token below (or once by hand with `npm publish --access public`).
- **`NPM_TOKEN` secret (fallback).** Create an npm granular access token with read and write access to the package (to all of your packages, before the first publish) that may publish without a 2FA prompt, and add it to the repository as the Actions secret `NPM_TOKEN`. Once trusted publishing is set up, npm uses that instead and the secret can be deleted.

## Stack choice: SvelteKit 2

Wheelhouse uses SvelteKit 2 with Svelte 5, Vite 7, Tailwind 4 and shadcn-svelte. The UI prototype ran on SvelteKit 3 and needed workarounds for shadcn-svelte: `#lib` aliases, a crash on `extends: "$app/tsconfig"`, and patched component state attributes. SvelteKit 2 works with shadcn-svelte's standard `$lib` aliases and components as generated, so this build pins it. Moving to SvelteKit 3 is a later, separate change once shadcn-svelte supports it cleanly.
