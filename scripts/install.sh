#!/usr/bin/env bash
# Jivam installer for macOS (and Linux)
# Usage: curl -fsSL https://raw.githubusercontent.com/KarmaloopAI/Jivam/main/scripts/install.sh | bash
set -euo pipefail

JIVAM_COLOR='\033[0;35m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

log()    { echo -e "${JIVAM_COLOR}▸${NC} $*"; }
ok()     { echo -e "${GREEN}✓${NC} $*"; }
warn()   { echo -e "${YELLOW}⚠${NC}  $*"; }
error()  { echo -e "${RED}✗${NC} $*" >&2; }
header() { echo -e "\n${BOLD}${JIVAM_COLOR}$*${NC}\n"; }

# ─────────────────────────────────────────────────────────────────────────────
header "Jivam Installer"
echo "  This will install Jivam and set it up as a native app on your Mac."
echo ""

# ── 1. Check OS ──────────────────────────────────────────────────────────────
OS="$(uname -s)"
if [[ "$OS" != "Darwin" && "$OS" != "Linux" ]]; then
  error "Unsupported OS: $OS. Use install.ps1 on Windows."
  exit 1
fi

# ── 2. Node.js ───────────────────────────────────────────────────────────────
header "Step 1 of 3 — Node.js"

# nvm refuses `nvm use`/`nvm install` outright if ~/.npmrc pins a `prefix`
# and/or `globalconfig` (common if the user previously ran a manual
# `npm config set prefix ...`, e.g. from a Homebrew Node setup, or already
# has another version manager configured) — it dies with "nvm_die_on_prefix"
# before installing anything. Strip those two keys first so nvm can actually
# manage the Node version instead of getting stuck on this. Back up the
# original file rather than deleting anything outright.
sanitize_npmrc_for_nvm() {
  if [ -f "$HOME/.npmrc" ] && grep -qE '^(prefix|globalconfig)[[:space:]]*=' "$HOME/.npmrc" 2>/dev/null; then
    warn "Removing prefix/globalconfig from ~/.npmrc (incompatible with nvm) — backed up to ~/.npmrc.bak"
    sed -i.bak -E '/^(prefix|globalconfig)[[:space:]]*=/d' "$HOME/.npmrc"
  fi
}

install_node_mac() {
  log "Installing Node.js via nvm..."
  export NVM_DIR="$HOME/.nvm"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  fi
  # shellcheck source=/dev/null
  [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
  sanitize_npmrc_for_nvm
  nvm install --lts
  nvm use --lts
  nvm alias default node
}

install_node_linux() {
  log "Installing Node.js via nvm..."
  export NVM_DIR="$HOME/.nvm"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  fi
  [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
  sanitize_npmrc_for_nvm
  nvm install --lts
  nvm use --lts
}

# Look for a suitable Node.js on the *plain* PATH first, before touching nvm
# at all. This used to source ~/.nvm/nvm.sh unconditionally up front, which
# on a machine with nvm installed but no default alias/version "in use" yet
# can leave `node` resolving to nothing (or an old shell default) even though
# a perfectly good Node.js is already installed and reachable — tripping the
# "too old" branch and dragging in nvm's install/upgrade path (and its
# prefix/globalconfig error) for a machine that didn't need any of it.
node_major_version() {
  local ver
  ver="$(node --version 2>/dev/null)" || { echo 0; return; }
  local major="${ver#v}"
  major="${major%%.*}"
  echo "${major:-0}"
}

NODE_READY=false
if command -v node &>/dev/null; then
  MAJOR="$(node_major_version)"
  if [ "$MAJOR" -ge 20 ]; then
    ok "Node.js $(node --version) already installed — skipping Node setup"
    NODE_READY=true
  else
    warn "Node.js $(node --version 2>/dev/null || echo '(unknown)') is too old (need ≥20). Upgrading..."
  fi
else
  warn "Node.js not found. Installing..."
fi

if [ "$NODE_READY" = false ]; then
  [[ "$OS" == "Darwin" ]] && install_node_mac || install_node_linux
fi

# Verify
if ! command -v node &>/dev/null; then
  error "Node.js installation failed. Please install it from https://nodejs.org and re-run."
  exit 1
fi
ok "Node.js $(node --version) ready"

# ── 3. Install jivam + jiva-core ─────────────────────────────────────────────
header "Step 2 of 3 — Installing Jivam"
log "Installing jivam and jiva-core globally (this may take a minute)..."
npm install -g jivamai jiva-core
ok "jivam $(jivam --version 2>/dev/null || node -e "const p=require('$(npm root -g)/jivamai/package.json');console.log(p.version)" 2>/dev/null || echo '') installed"
ok "jiva-core installed"

# ── 4. App bundle + Dock (macOS) ─────────────────────────────────────────────
# Jivam runs as a genuine Safari web app on macOS — a real, separate .app
# bundle with its own Dock icon (Safari's "Add to Dock", macOS Sonoma+).
# `jivam --install` opens Safari to a plain tab with on-screen instructions
# for the one manual step Safari requires (File > Add to Dock…), then waits
# in the background for the resulting app bundle to appear — no
# Accessibility permission needed for any of this.
if [[ "$OS" == "Darwin" ]]; then
  header "Step 3 of 3 — Setting up the Jivam app"
  log "Opening Safari — follow the on-screen instructions to add Jivam to your Dock..."
  jivam --install
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}All done!${NC} Jivam is installed."
echo ""
if [[ "$OS" == "Darwin" ]]; then
  echo "  Click the ${BOLD}Jivam${NC} icon in your Dock to launch."
  echo "  The app will auto-update in the background each time you open it."
else
  echo "  Run ${BOLD}jivam${NC} in your terminal to start."
fi
echo ""
