#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/weatherApp-VUE3"
DIST="$APP/dist"

cd "$APP"
npm ci
npm test
npm run lint
VITE_SITE_BASE=./ npm run build

cd "$ROOT"
WORKTREE="$(mktemp -d)"
cleanup() { rm -rf "$WORKTREE"; }
trap cleanup EXIT

cp -R "$DIST"/. "$WORKTREE"/

cd "$WORKTREE"
git init -q
git checkout -b gh-pages
git add -A
git -c user.name="weather-app deploy" -c user.email="deploy@local" \
  commit -q -m "deploy: $(git -C "$ROOT" rev-parse --short HEAD)"
git remote add origin "https://gitee.com/masaka0426/weather-app.git"
git push -f origin gh-pages

echo "Deployed dist to origin/gh-pages"
