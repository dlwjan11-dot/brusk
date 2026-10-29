#!/usr/bin/env bash
# Push build logs to a branch (ci-logs-<name>) so they can be read without opening Actions.
# usage: scripts/ci-log.sh <name> <status> <file>...
set -u
name="$1"; status="$2"; shift 2
dir="$(mktemp -d)"
for f in "$@"; do [ -f "$f" ] && cp "$f" "$dir/"; done
{ echo "status=$status"; echo "commit=${GITHUB_SHA:-}"; echo "ref=${GITHUB_REF_NAME:-}"; } > "$dir/status.txt"
cd "$dir"
git init -q -b "ci-logs-$name"
git -c user.name="github-actions" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" add -A
git -c user.name="github-actions" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -qm "$name build log ($status)"
git push -fq "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" "ci-logs-$name"
