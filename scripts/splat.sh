#!/usr/bin/env bash
# Splat PLY (leveled and scaled in SuperSplat) → data/scans/<scan>/splat.spz (spec §12). Run with --help for usage.
set -euo pipefail

SPLAT_TRANSFORM="@playcanvas/splat-transform@3.10.1"
# Spec §2.3: a splat is at most 1.5M splats, as SPZ. Issue #12: about 25 MB or less.
MAX_SPLATS="${SPLAT_MAX:-1500000}"
MAX_MB=25
# -H 0 keeps base color only. The higher bands are view-dependent shine, and cost the most size.
SH_BANDS="${SPLAT_SH_BANDS:-0}"
# v3 is the one every viewer reads (Spark 2.3.1 can't be checked from here); v4 was ~2% smaller in a test.
SPZ_VERSION="${SPLAT_SPZ_VERSION:-3}"

usage() {
  cat <<'EOF'
Usage: scripts/splat.sh <input.ply> [--scan <id>] [--box x,y,z,X,Y,Z]

Crops, strips spherical-harmonic bands, decimates, and writes data/scans/<scan>/splat.spz.
  <input.ply>  the splat after leveling, scaling, and floater removal in SuperSplat
  --scan       scan id (default: lounge-v1)
  --box        crop to min,max corners, in the frame SuperSplat shows (+Y up). The splat has its own
               origin until the Align step (#16), so this is NOT the room box from setup.json.
               Without it there is no crop.

Env overrides: SPLAT_MAX (default 1500000), SPLAT_SH_BANDS (default 0), SPLAT_SPZ_VERSION (default 3).
EOF
}

die() { echo "splat.sh: $*" >&2; exit 1; }
usage_error() { echo "splat.sh: $*" >&2; echo >&2; usage >&2; exit 2; }

input="" scan="lounge-v1" box=""
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --scan) [ $# -ge 2 ] || usage_error "--scan needs a value"; scan="$2"; shift 2 ;;
    --box) [ $# -ge 2 ] || usage_error "--box needs a value"; box="$2"; shift 2 ;;
    -*) usage_error "unknown option $1" ;;
    *) [ -z "$input" ] || usage_error "more than one input given"; input="$1"; shift ;;
  esac
done

[ -n "$input" ] || usage_error "missing the input PLY path"
[ -f "$input" ] || die "no such file: $input"
case "$input" in *.ply) ;; *) die "expected a .ply, got: $input" ;; esac
command -v node >/dev/null || die "node is required"

num='-?[0-9]+(\.[0-9]+)?'
if [ -n "$box" ]; then
  echo "$box" | grep -Eq "^$num(,$num){5}\$" || usage_error "--box must be six numbers: x,y,z,X,Y,Z (got: $box)"
  echo "$box" | awk -F, '{ exit !($1 < $4 && $2 < $5 && $3 < $6) }' || die "--box min corner must be below the max corner on every axis (got: $box)"
fi
for v in "$MAX_SPLATS" "$SH_BANDS" "$SPZ_VERSION"; do
  echo "$v" | grep -Eq '^[0-9]+$' || die "SPLAT_MAX, SPLAT_SH_BANDS, and SPLAT_SPZ_VERSION must be whole numbers (got: $v)"
done

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out_dir="$root/data/scans/$scan"
out="$out_dir/splat.spz"

st() { npx --yes "$SPLAT_TRANSFORM" -q "$@"; }

# Reads the JSON that --info/--stats print between splat-transform's banner and its trailing log lines.
json_eval() {
  node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const o = JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1));
    console.log(eval(process.argv[1]));
  });' "$1"
}
count() { st "$1" null --info json | json_eval 'o.numGaussians'; }
# Splat-transform loads a PLY with X and Y negated (the 180° turn about Z that SuperSplat also uses), and --box
# works in that frame. Print the PLY's bounds in it, so a --box can be read straight off them.
bounds() {
  st "$1" null --stats json | json_eval '(() => {
    const { min, max } = o.stats[0].data;
    return `x [${-max[0]}, ${-min[0]}]  y [${-max[1]}, ${-min[1]}]  z [${min[2]}, ${max[2]}]`;
  })()'
}
pct() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.0f", 100 * a / b }'; }
mb() { awk -v b="$1" 'BEGIN { printf "%.1f", b / 1000000 }'; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

in_count="$(count "$input")"
echo "input:   $input"
echo "         $in_count splats; bounds (--box frame) $(bounds "$input")"

# Decimation must be the last action and write a PLY, so the steps are: filter, decimate, convert.
filters=(-N)
if [ -n "$box" ]; then
  echo "crop:    --box $box"
  filters+=(-B "$box")
else
  echo "WARNING: no --box, so nothing is cropped. Floaters outside the room will stay in the file." >&2
fi
filters+=(-H "$SH_BANDS")
st -w "$input" "${filters[@]}" "$tmp/filtered.ply" \
  || die "splat-transform failed while filtering. If --box (${box:-none}) is outside the splat it removes everything; compare it to the bounds above (same frame, +Y up)."

kept="$(count "$tmp/filtered.ply")"
echo "kept:    $kept of $in_count splats ($(pct "$kept" "$in_count")%)"
if [ -n "$box" ] && [ "$(pct "$kept" "$in_count")" -lt 50 ]; then
  echo "WARNING: the crop dropped over half the splats. If that's more than the floaters, the box is probably in the wrong frame." >&2
fi

# -d is a no-op when the target is above the count.
st -w "$tmp/filtered.ply" -d "$MAX_SPLATS" "$tmp/decimated.ply"
st -w --spz-version "$SPZ_VERSION" "$tmp/decimated.ply" "$tmp/splat.spz"

mkdir -p "$out_dir"
mv "$tmp/splat.spz" "$out"

bytes="$(wc -c < "$out" | tr -d ' ')"
echo "output:  $out"
echo "         $(mb "$bytes") MB, $(count "$out") splats (SPZ v$SPZ_VERSION, SH bands <= $SH_BANDS)"
if [ "$bytes" -gt $((MAX_MB * 1000000)) ]; then
  echo "WARNING: over $MAX_MB MB. Try a lower count, e.g. SPLAT_MAX=1200000 scripts/splat.sh $input" >&2
fi
echo "next:    open it in SuperSplat or Spark to check it's level, roughly to scale, and recognizably the lounge."
