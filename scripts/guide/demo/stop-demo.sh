#!/usr/bin/env bash
# Stops the demo Wheelhouse, its ticker, its preview server, the PR review engine it launched
# (which outlives Wheelhouse by design) and its private tmux server.
# Usage: stop-demo.sh <demo root>
ROOT="$1"
pkill -f "vite dev --host 127.0.0.1 --port 4950"
pkill -f "$ROOT/plugins/"
[ -f "$ROOT/tick.pid" ] && kill "$(cat "$ROOT/tick.pid")" 2>/dev/null
[ -f "$ROOT/preview.pid" ] && kill "$(cat "$ROOT/preview.pid")" 2>/dev/null
TMUX_TMPDIR="${WHVG_TMUX:-$ROOT/tmux}" tmux -L whvg kill-server 2>/dev/null
true
