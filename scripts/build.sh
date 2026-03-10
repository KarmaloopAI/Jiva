#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Jivam unified build script
#
# Usage:
#   ./scripts/build.sh                 # build for current OS (auto-detected)
#   ./scripts/build.sh --mac           # macOS DMG + ZIP (universal)
#   ./scripts/build.sh --win           # Windows NSIS installer + portable
#   ./scripts/build.sh --linux         # Linux AppImage + deb
#   ./scripts/build.sh --all           # all three platforms
#   ./scripts/build.sh --mac -o        # macOS build, then open release/ in Finder
#   ./scripts/build.sh --all --clean   # wipe release/ first, then build everything
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

# ── Flags ─────────────────────────────────────────────────────────────────────
BUILD_MAC=false
BUILD_WIN=false
BUILD_LINUX=false
OPEN_AFTER=false
CLEAN=false

for arg in "$@"; do
  case $arg in
    --mac)        BUILD_MAC=true ;;
    --win)        BUILD_WIN=true ;;
    --linux)      BUILD_LINUX=true ;;
    --all)        BUILD_MAC=true; BUILD_WIN=true; BUILD_LINUX=true ;;
    -o|--open)    OPEN_AFTER=true ;;
    --clean)      CLEAN=true ;;
    -h|--help)
      sed -n '3,12p' "$0" | sed 's/^# *//'
      exit 0 ;;
  esac
done

# Default: build for the current host platform
if ! $BUILD_MAC && ! $BUILD_WIN && ! $BUILD_LINUX; then
  case "$(uname -s)" in
    Darwin)              BUILD_MAC=true ;;
    MINGW*|CYGWIN*|MSYS*) BUILD_WIN=true ;;
    Linux)               BUILD_LINUX=true ;;
    *)
      echo -e "${RED}Unknown platform — pass --mac, --win, --linux, or --all${RESET}"
      exit 1 ;;
  esac
fi

# ── Resolve project root (script may be called from any directory) ─────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

# ── Read version from package.json ────────────────────────────────────────────
VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "?")

# ── Banner ────────────────────────────────────────────────────────────────────
TARGETS=""
$BUILD_MAC   && TARGETS+=" macOS"
$BUILD_WIN   && TARGETS+=" Windows"
$BUILD_LINUX && TARGETS+=" Linux"

echo ""
echo -e "${BOLD}${CYAN}╔════════════════════════════════════════════╗${RESET}"
printf "${BOLD}${CYAN}║  Jivam v%-6s  ─  Build:%s${RESET}\n" "$VERSION" "$TARGETS"
echo -e "${BOLD}${CYAN}╚════════════════════════════════════════════╝${RESET}"
echo -e "   ${YELLOW}$(date '+%Y-%m-%d %H:%M:%S')${RESET}"
echo ""

# ── Pre-flight checks ─────────────────────────────────────────────────────────
echo -e "${BOLD}▸ Pre-flight checks${RESET}"

for cmd in node npm npx; do
  if command -v "$cmd" &>/dev/null; then
    echo -e "  ${GREEN}✓${RESET}  $cmd  ($(command -v "$cmd"))"
  else
    echo -e "  ${RED}✗  '$cmd' not found in PATH — install Node.js first${RESET}"
    exit 1
  fi
done

if [ ! -f node_modules/.bin/electron-builder ]; then
  echo -e "  ${RED}✗  electron-builder not installed — run: npm install${RESET}"
  exit 1
fi
echo -e "  ${GREEN}✓${RESET}  electron-builder"

# Cross-compilation tool warnings (informational, non-fatal)
if $BUILD_WIN && [[ "$(uname -s)" != MINGW* ]] && [[ "$(uname -s)" != CYGWIN* ]]; then
  if command -v wine &>/dev/null; then
    echo -e "  ${GREEN}✓${RESET}  wine  (Windows NSIS cross-compile available)"
  else
    echo -e "  ${YELLOW}⚠${RESET}  wine not found — Windows NSIS installer may not build (portable target will still work)"
  fi
fi

if $BUILD_LINUX && [[ "$(uname -s)" != "Linux" ]]; then
  if command -v docker &>/dev/null; then
    echo -e "  ${GREEN}✓${RESET}  docker  (Linux cross-compile available)"
  else
    echo -e "  ${YELLOW}⚠${RESET}  docker not found — Linux AppImage cross-compile may fail"
  fi
fi
echo ""

# ── Clean (optional) ──────────────────────────────────────────────────────────
if $CLEAN; then
  echo -e "${BOLD}▸ Cleaning release/${RESET}"
  rm -rf release/
  echo -e "  ${GREEN}✓${RESET}  release/ removed"
  echo ""
fi

# ── TypeScript check ──────────────────────────────────────────────────────────
echo -e "${BOLD}▸ TypeScript check${RESET}"
if NODE_OPTIONS='' npx tsc --noEmit 2>&1; then
  echo -e "  ${GREEN}✓${RESET}  No type errors"
else
  echo -e "  ${RED}✗  TypeScript errors — build aborted${RESET}"
  exit 1
fi
echo ""

# ── Vite build (renderer + Electron main/preload) ─────────────────────────────
echo -e "${BOLD}▸ Vite build${RESET}"
NODE_OPTIONS='' npm run build
echo ""

# ── electron-builder ──────────────────────────────────────────────────────────
EB_FLAGS=""
$BUILD_MAC   && EB_FLAGS+=" --mac"
$BUILD_WIN   && EB_FLAGS+=" --win"
$BUILD_LINUX && EB_FLAGS+=" --linux"

echo -e "${BOLD}▸ electron-builder$EB_FLAGS${RESET}"
# shellcheck disable=SC2086
NODE_OPTIONS='' npx electron-builder $EB_FLAGS
echo ""

# ── Summary ───────────────────────────────────────────────────────────────────
echo -e "${BOLD}${GREEN}✓ Build complete${RESET}"
echo ""
echo -e "${BOLD}▸ Artifacts in release/${RESET}"

shopt -s nullglob
files=(
  release/*.dmg
  release/*.zip
  release/*.exe
  release/*.AppImage
  release/*.deb
  release/*.rpm
  release/*.snap
)

if [ ${#files[@]} -eq 0 ]; then
  echo -e "  ${YELLOW}(no installer files found — check release/ manually)${RESET}"
else
  for f in "${files[@]}"; do
    SIZE=$(du -sh "$f" | awk '{print $1}')
    printf "  ${CYAN}%6s${RESET}  %s\n" "$SIZE" "$(basename "$f")"
  done
fi
echo ""

# ── Open release/ in Finder (macOS only) ──────────────────────────────────────
if $OPEN_AFTER && [[ "$(uname -s)" == "Darwin" ]]; then
  open release/
fi
