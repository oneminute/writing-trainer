#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

MODE="local"
INSTALL_ONLY=0
SKIP_SYSTEM_PACKAGES=0
SKIP_OLLAMA_INSTALL=0

usage() {
  cat <<'EOF'
Writing Trainer — Omarchy / Arch Linux launcher

Usage:
  ./start-writing-trainer-omarchy.sh [options]

Options:
  --lan                  Listen on 0.0.0.0:5178 for other devices on the LAN
  --install-only         Install/check dependencies and exit without starting
  --skip-system-packages Do not install missing Arch packages with pacman
  --skip-ollama-install  Do not offer to install Ollama when it is missing
  -h, --help             Show this help

Examples:
  ./start-writing-trainer-omarchy.sh
  ./start-writing-trainer-omarchy.sh --lan
  ./start-writing-trainer-omarchy.sh --install-only
EOF
}

for arg in "$@"; do
  case "$arg" in
    --lan) MODE="lan" ;;
    --install-only) INSTALL_ONLY=1 ;;
    --skip-system-packages) SKIP_SYSTEM_PACKAGES=1 ;;
    --skip-ollama-install) SKIP_OLLAMA_INSTALL=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[ERROR] Unknown option: $arg"; usage; exit 2 ;;
  esac
done

echo "=========================================="
echo " Writing Trainer — Omarchy / Arch Linux"
echo "=========================================="
echo

if ! command -v pacman >/dev/null 2>&1; then
  echo "[WARN] pacman was not found."
  echo "       This script is intended for Omarchy / Arch Linux."
  echo "       It can still continue if Node.js and npm are already installed."
fi

need_packages=()
command -v node >/dev/null 2>&1 || need_packages+=(nodejs)
command -v npm  >/dev/null 2>&1 || need_packages+=(npm)
command -v git  >/dev/null 2>&1 || need_packages+=(git)
command -v curl >/dev/null 2>&1 || need_packages+=(curl)

if (("${#need_packages[@]}" > 0)); then
  echo "[SETUP] Missing system packages: ${need_packages[*]}"
  if [[ "$SKIP_SYSTEM_PACKAGES" -eq 1 ]]; then
    echo "[ERROR] Required packages are missing and --skip-system-packages was supplied."
    exit 1
  fi
  if command -v pacman >/dev/null 2>&1; then
    echo "[SETUP] Installing required Arch packages..."
    sudo pacman -S --needed --noconfirm "${need_packages[@]}"
  else
    echo "[ERROR] Cannot install required packages automatically because pacman is unavailable."
    exit 1
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js is still unavailable after setup."
  exit 1
fi

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$node_major" -lt 20 ]]; then
  echo "[ERROR] Node.js 20 or newer is required. Found: $(node --version)"
  exit 1
fi

echo "[OK] Node.js $(node --version)"
echo "[OK] npm $(npm --version)"

if [[ ! -f ".env" ]]; then
  if [[ -f ".env.example" ]]; then
    cp ".env.example" ".env"
    echo "[SETUP] Created .env from .env.example"
  else
    echo "[WARN] .env.example was not found; continuing without creating .env."
  fi
else
  echo "[OK] Existing .env kept unchanged"
fi

echo "[SETUP] Installing Node dependencies..."
npm install --no-fund --no-audit

echo "[CHECK] Running validation..."
npm test

if ! command -v ollama >/dev/null 2>&1; then
  echo
  echo "[WARN] Ollama is not installed."
  if [[ "$SKIP_OLLAMA_INSTALL" -eq 0 ]]; then
    if command -v curl >/dev/null 2>&1; then
      if [[ -t 0 ]]; then
        read -r -p "Install Ollama using the official installer now? [Y/n] " answer
        answer="${answer:-Y}"
      else
        answer="n"
      fi
      if [[ "$answer" =~ ^[Yy]$ ]]; then
        echo "[SETUP] Installing Ollama..."
        if ! curl -fsSL https://ollama.com/install.sh | sh; then
          echo "[WARN] Ollama installation failed. Writing Trainer will still be able to start."
        fi
      fi
    fi
  fi
fi

if command -v ollama >/dev/null 2>&1; then
  echo "[OK] Ollama command found"
  echo "     Writing Trainer will check/start the Ollama server automatically."
else
  echo "[WARN] Continuing without Ollama."
  echo "       You can install it later and restart Writing Trainer."
fi

if [[ "$INSTALL_ONLY" -eq 1 ]]; then
  echo
  echo "[DONE] Installation/checks completed. --install-only requested, so the app was not started."
  exit 0
fi

export PORT=5178

if [[ "$MODE" == "lan" ]]; then
  export HOST=0.0.0.0
  echo
  echo "[START] LAN mode"
  echo "        Writing Trainer will listen on 0.0.0.0:5178"
  echo
  if command -v hostname >/dev/null 2>&1; then
    lan_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    if [[ -n "${lan_ip:-}" ]]; then
      echo "        Open from another device:"
      echo "        http://$lan_ip:5178"
      echo
    fi
  fi
else
  export HOST=127.0.0.1
  echo
  echo "[START] Local mode"
  echo "        Open: http://127.0.0.1:5178"
  echo
fi

echo "[INFO] Press Ctrl+C to stop Writing Trainer."
exec npm start
