#!/usr/bin/env bash
# Runs a throwaway Wheelhouse (Vite dev server on 127.0.0.1:4950) against a demo home from
# build-demo.mjs. HOME, state, config, installed plugins and the tmux server (-L whvg) all live
# under the demo root; the made-up Lumen app's preview is served on 127.0.0.1:4951.
# Usage: run-demo.sh <wheelhouse checkout> <demo root>
# Env: WHVG_TMUX, a short directory for the tmux socket (socket paths are limited to ~104 bytes).
set -euo pipefail
WH="$1"
ROOT="$2"
HERE="$(cd "$(dirname "$0")" && pwd)"
FM="$ROOT/firstmate"
NODE_DIR="$(dirname "$(command -v node)")"
cd "$WH"
if ! lsof -nP -iTCP:4951 -sTCP:LISTEN >/dev/null 2>&1; then
	nohup python3 -m http.server 4951 --bind 127.0.0.1 --directory "$ROOT/site" >"$ROOT/preview.log" 2>&1 &
	echo $! >"$ROOT/preview.pid"
fi
# Start with the lock free so Wheelhouse starts the (fake) Firstmate session itself, then mark it
# held once that session has really started (the fake claude records its SessionStart), not on a
# timer, which loses the race when the machine is busy.
sed -e 's/"held"/"free"/; s/"live_harness": true/"live_harness": false/' "$FM/demo/ready-held.json" >"$FM/ready.json"
rm -f "$ROOT/wh-state/firstmate/session-start.json"
(
	for _ in $(seq 1 300); do
		[ -f "$ROOT/wh-state/firstmate/session-start.json" ] && break
		sleep 1
	done
	sleep 5
	cp "$FM/demo/ready-held.json" "$FM/ready.json"
) &
nohup "$NODE_DIR/node" "$HERE/tick-demo.mjs" "$ROOT" >"$ROOT/tick.log" 2>&1 &
echo $! >"$ROOT/tick.pid"
exec env -i \
	PATH="$ROOT/fakebin:$NODE_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" \
	HOME="$ROOT/home" USER="${USER:-demo}" LANG=en_US.UTF-8 TERM=xterm-256color \
	TMUX_TMPDIR="${WHVG_TMUX:-$ROOT/tmux}" \
	WHEELHOUSE_FIRSTMATE_DIR="$FM" \
	WHEELHOUSE_HOME="$FM" \
	WHEELHOUSE_TMUX_SOCKET=whvg \
	WHEELHOUSE_CONFIG_DIR="$ROOT/wh-config" \
	WHEELHOUSE_STATE_DIR="$ROOT/wh-state" \
	WHEELHOUSE_PLUGINS_DIR="$ROOT/plugins" \
	PR_REVIEW_STATE_DIR="$ROOT/pr-review-state" \
	"$WH/node_modules/.bin/vite" dev --host 127.0.0.1 --port 4950 --strictPort
