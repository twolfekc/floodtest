#!/usr/bin/env bash
set -e

# ─────────────────────────────────────────────────────────────
# FloodTest Updater
# Pulls the latest image and restarts the container.
# Usage: curl -fsSL https://raw.githubusercontent.com/twolfekc/floodtest/main/update.sh | sudo bash
# ─────────────────────────────────────────────────────────────

INSTALL_DIR="/opt/floodtest"

echo ""
echo "============================================"
echo "  FloodTest — Updating to latest version"
echo "============================================"
echo ""

# ── Root check ───────────────────────────────────────────────
if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: This script must be run as root (use sudo)."
  exit 1
fi

# ── Check installation exists ────────────────────────────────
if [ ! -f "${INSTALL_DIR}/docker-compose.yml" ]; then
  echo "ERROR: FloodTest is not installed at ${INSTALL_DIR}."
  echo "Run the install script first:"
  echo "  curl -fsSL https://raw.githubusercontent.com/twolfekc/floodtest/main/install.sh | sudo bash"
  exit 1
fi

# ── Pull latest image ───────────────────────────────────────
echo "Pulling latest FloodTest image..."
cd "${INSTALL_DIR}"
docker compose pull

# ── Restart with new image ──────────────────────────────────
echo "Restarting FloodTest..."
docker compose up -d

# ── Show version info ────────────────────────────────────────
IMAGE_ID=$(docker inspect floodtest --format '{{.Image}}' 2>/dev/null | cut -c8-19)
echo ""
echo "============================================"
echo "  FloodTest updated successfully"
echo "  Image: ${IMAGE_ID:-latest}"
echo "============================================"
echo ""
echo "Your settings, schedules, and history are preserved."
echo ""
