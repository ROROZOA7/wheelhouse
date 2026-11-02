#!/usr/bin/env bash
# Turns one recorded pass (frames and concat.txt from record.mjs) into its finished file.
#   tour   -> tour.mp4 (1440x900, 30 fps, H.264, captions drawn by the overlay) and tour-poster.jpg
#   chat   -> guide-chat.png     APNG of the chat column, looping
#   review -> guide-review.png   APNG of the review tab's middle, looping
# Usage: encode.sh <pass> <frames dir> <out dir>
# Env: APNG_FPS (default 15).
set -euo pipefail
PASS="$1"
SRC="$2"
OUT="$(mkdir -p "$3" && cd "$3" && pwd)"
APNG_FPS="${APNG_FPS:-15}"
cd "$SRC"
ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }
# APNG: crop to the column the flow happens in (native pixels, so text stays crisp), drop to a low
# frame rate, then one 256-colour palette for the whole clip. An ordered (Bayer) dither keeps
# gradients from banding and, unlike error diffusion, stays stable between frames, so they diff cheaply.
apng() {
	local crop="$1" name="$2"
	ff -f concat -safe 0 -i concat.txt \
		-vf "fps=$APNG_FPS,crop=$crop,split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
		-plays 0 -pred mixed -f apng "$OUT/$name"
}
# The crop (w:h:x:y) for a clip comes from record.mjs, which measures the column on the page.
crop() { node -e 'const c = require(process.argv[1]).crop; process.stdout.write(`${c.width}:${c.height}:${c.x}:${c.y}`)' "$PWD/chapters.json"; }
case "$PASS" in
	tour)
		ff -f concat -safe 0 -i concat.txt -vf "fps=30,format=yuv420p" \
			-c:v libx264 -preset slow -crf 20 -tune stillimage -movflags +faststart "$OUT/tour.mp4"
		# The player's poster: the title card.
		ff -ss 2 -i "$OUT/tour.mp4" -frames:v 1 -q:v 3 "$OUT/tour-poster.jpg"
		;;
	chat) apng "$(crop)" guide-chat.png ;;
	review) apng "$(crop)" guide-review.png ;;
	*)
		echo "unknown pass $PASS" >&2
		exit 1
		;;
esac
ls -l "$OUT"
