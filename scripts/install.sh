#!/usr/bin/env bash
# Jivam installer for macOS (and Linux)
# Usage: curl -fsSL https://raw.githubusercontent.com/karmaloop-ai/jivam/main/scripts/install.sh | bash
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
header "Step 1 of 4 — Node.js"

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

# ── 3. Chrome recommendation (macOS only) ────────────────────────────────────
if [[ "$OS" == "Darwin" ]]; then
  header "Step 2 of 4 — Chrome (recommended)"
  CHROME_PATH="/Applications/Google Chrome.app"
  if [ -d "$CHROME_PATH" ]; then
    ok "Google Chrome is already installed"
  else
    echo "  Jivam works best with Google Chrome (opens as a clean, tab-free app window)."
    echo "  Without Chrome it will open in Safari, which lacks the app-window experience."
    echo ""
    read -r -p "  Download Chrome now? [Y/n] " CHROME_CHOICE
    CHROME_CHOICE="${CHROME_CHOICE:-Y}"
    if [[ "$CHROME_CHOICE" =~ ^[Yy] ]]; then
      log "Opening Chrome download page..."
      open "https://www.google.com/chrome/" 2>/dev/null || true
      echo ""
      echo "  Install Chrome, then press Enter to continue..."
      read -r
    else
      warn "Skipping Chrome. You can install it later for the best experience."
    fi
  fi
fi

# ── 4. Install jivam + jiva-core ─────────────────────────────────────────────
header "Step 3 of 4 — Installing Jivam"
log "Installing jivam and jiva-core globally (this may take a minute)..."
npm install -g jivam jiva-core
ok "jivam $(jivam --version 2>/dev/null || node -e "const p=require('$(npm root -g)/jivam/package.json');console.log(p.version)" 2>/dev/null || echo '') installed"
ok "jiva-core installed"

# ── 5. App bundle + Dock (macOS) ─────────────────────────────────────────────
if [[ "$OS" == "Darwin" ]]; then
  header "Step 4 of 4 — Setting up Jivam.app"
  log "Creating Jivam.app and adding it to your Dock..."
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
