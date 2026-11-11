#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="https://gitee.com/masaka0426/weather-app.git"
REF="${1:-}"

if [ -z "$REF" ]; then
  REF="$(git -C "$ROOT" describe --tags --abbrev=0 2>/dev/null || echo master)"
fi

echo "==> Deploying ref: $REF"

# 用 detached worktree 构建确定版本，避免当前工作区未提交改动混入产物。
BUILD_DIR="$(mktemp -d)"
rmdir "$BUILD_DIR"
cleanup() {
  git -C "$ROOT" worktree remove --force "$BUILD_DIR" 2>/dev/null || rm -rf "$BUILD_DIR"
}
trap cleanup EXIT
git -C "$ROOT" worktree add --detach "$BUILD_DIR" "$REF"

APP="$BUILD_DIR/weatherApp-VUE3"
cd "$APP"
npm ci
npm test
npm run lint
VITE_SITE_BASE=./ npm run build

echo "==> deploy.json:"
cat "$APP/dist/deploy.json"

PAGES_DIR="$(mktemp -d)"
cp -R "$APP/dist/." "$PAGES_DIR"/

cd "$PAGES_DIR"
git init -q
git checkout -b gh-pages
git add -A
git -c user.name="weather-app deploy" -c user.email="deploy@local" \
  commit -q -m "deploy: $REF ($(git -C "$BUILD_DIR" rev-parse --short HEAD))"
git remote add origin "$REMOTE"
git push -f origin gh-pages

echo "==> Deployed $REF to origin/gh-pages"
