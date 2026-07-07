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

install_node_mac() {
  log "Installing Node.js via nvm..."
  export NVM_DIR="$HOME/.nvm"
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  # shellcheck source=/dev/null
  [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
  nvm install --lts
  nvm use --lts
  nvm alias default node
}

install_node_linux() {
  log "Installing Node.js via nvm..."
  export NVM_DIR="$HOME/.nvm"
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
  nvm install --lts
  nvm use --lts
}

# Load nvm if it exists but isn't in PATH yet
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  source "$NVM_DIR/nvm.sh"
fi

if command -v node &>/dev/null; then
  NODE_VER="$(node --version)"
  MAJOR="${NODE_VER//[^0-9.]*/}"
  MAJOR="${MAJOR%%.*}"
  MAJOR="${MAJOR//v/}"
  if [ "${MAJOR:-0}" -lt 18 ]; then
    warn "Node.js $NODE_VER is too old (need ≥18). Upgrading..."
    [[ "$OS" == "Darwin" ]] && install_node_mac || install_node_linux
  else
    ok "Node.js $NODE_VER"
  fi
else
  warn "Node.js not found. Installing..."
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
