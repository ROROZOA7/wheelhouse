#!/usr/bin/env bash
# Records the Wheelhouse guide: two looping APNG clips for the README and the captioned MP4 tour.
# For each pass it builds a fresh synthetic demo home (recording changes it: a decision gets
# answered, a review gets written), starts a throwaway Wheelhouse on 127.0.0.1:4950 against it with
# the PR review plugin installed, records the pass in headless Chrome, stops it and encodes.
#
# Usage: npm run guide [-- pass...]      passes: chat review tour (default: all three)
#   chat   -> docs/screenshots/guide-chat.png     the chat: a live preview, then a decision answered
#   review -> docs/screenshots/guide-review.png   a pull request reviewed in the PR review plugin's tab
#   tour   -> $WORK/tour.mp4 and tour-poster.jpg  the captioned tour, uploaded to GitHub by hand
# Env: WORK (scratch: demo homes, frames and the tour; default a new temp dir),
#      PR_REVIEW_REF (the plugin's tag, branch or commit; default its default branch),
#      CHROME_PATH (see chrome.mjs).
# Needs ffmpeg, tmux, python3, git and network access to clone the plugin from GitHub.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WH="$(cd "$HERE/../.." && pwd)"
PASSES="${*:-chat review tour}"
WORK="${WORK:-$(mktemp -d "${TMPDIR:-/tmp}/wh-guide.XXXXXX")}"
SHOTS="$WH/docs/screenshots"
for tool in ffmpeg tmux python3 git; do
	command -v "$tool" >/dev/null || {
		echo "record.sh needs $tool on PATH" >&2
		exit 1
	}
done
for pass in $PASSES; do
	case "$pass" in chat | review | tour) ;; *)
		echo "unknown pass $pass; use chat, review or tour" >&2
		exit 1
		;;
	esac
done
if lsof -nP -iTCP:4950 -sTCP:LISTEN >/dev/null 2>&1 || lsof -nP -iTCP:4951 -sTCP:LISTEN >/dev/null 2>&1; then
	echo "ports 4950 and 4951 must be free for the demo Wheelhouse and its preview" >&2
	exit 1
fi
# tmux socket paths are limited to ~104 bytes, so keep the socket directory short.
export WHVG_TMUX="$WORK/t"
mkdir -p "$WORK" "$WHVG_TMUX"
echo "== work: $WORK"

# Once per $WORK: the PR review plugin, installed as a captain would, and the demo app's screenshots.
if [ ! -d "$WORK/plugins/pr-review" ]; then
	(cd "$WH" && npm run --silent build:cli)
	node "$WH/dist/cli.js" plugin --plugins-dir "$WORK/plugins" --config-dir "$WORK/plugin-config" \
		install --yes "chrisjowen/pr-review-wheelhouse${PR_REVIEW_REF:+@$PR_REVIEW_REF}"
fi
node "$HERE/appshots.mjs" "$WORK/appshots"

for pass in $PASSES; do
	root="$WORK/root-$pass"
	frames="$WORK/frames-$pass"
	rm -rf "$root" "$frames"
	echo "== $pass: demo home $root"
	(cd "$WH" && APPSHOTS="$WORK/appshots" node "$HERE/demo/build-demo.mjs" "$root" >/dev/null)
	cp -R "$WORK/plugins" "$root/plugins"
	printf '%s\n' '{"plugins":{"pr-review":{"enabled":true},"github-issues":{"enabled":true},"project-links":{"enabled":true}}}' >"$root/wh-config/plugins.json"
	bash "$HERE/demo/stop-demo.sh" "$root" >/dev/null 2>&1 || true
	nohup bash "$HERE/demo/run-demo.sh" "$WH" "$root" >"$root/vite.log" 2>&1 &
	# Ready once Vite answers (its first compile is slow under load) and the fake Firstmate
	# session holds the lock, so the chat can be answered.
	for _ in $(seq 1 180); do
		curl -s -o /dev/null -m 60 "http://127.0.0.1:4950/" && grep -q '"held"' "$root/firstmate/ready.json" 2>/dev/null && break
		sleep 1
	done
	sleep 3
	status=0
	node "$HERE/record.mjs" "$pass" "$frames" || status=$?
	bash "$HERE/demo/stop-demo.sh" "$root" >/dev/null 2>&1 || true
	if [ "$status" -ne 0 ]; then
		echo "$pass failed; see $frames/failure.png and $root/vite.log" >&2
		exit "$status"
	fi
	case "$pass" in
		tour) bash "$HERE/encode.sh" tour "$frames" "$WORK" ;;
		*) bash "$HERE/encode.sh" "$pass" "$frames" "$SHOTS" ;;
	esac
done
echo "== done. Clips: $SHOTS/guide-*.png"
[[ " $PASSES " == *" tour "* ]] && echo "== tour: $WORK/tour.mp4 and $WORK/tour-poster.jpg (upload by hand; see docs/development.md)"
true
