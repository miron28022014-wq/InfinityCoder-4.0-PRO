#!/usr/bin/env bash
# Остановка процессов InfinityCoder 4.0, запущенных скриптом start.sh.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
pkill -f "$ROOT_DIR/ecosystem/dist/server.js" 2>/dev/null || true
pkill -f "$ROOT_DIR/scripts/serve-dist.cjs" 2>/dev/null || true
pkill -f "$ROOT_DIR/scripts/bridge.cjs" 2>/dev/null || true
echo "✔ Остановлено"
