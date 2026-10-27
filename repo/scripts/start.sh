#!/usr/bin/env bash
# Запуск и остановка InfinityCoder 4.0: Core API + терминальный мост + веб-IDE.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

CORE_PORT="${INFINITY_PORT:-8787}"
CODER_PORT="${INFINITY_CODER_PORT:-8090}"
BRIDGE_PORT="${INFINITY_BRIDGE_PORT:-5299}"

stop_all() {
  pkill -f "$ROOT_DIR/ecosystem/dist/server.js" 2>/dev/null || true
  pkill -f "$ROOT_DIR/scripts/serve-dist.cjs" 2>/dev/null || true
  pkill -f "$ROOT_DIR/scripts/bridge.cjs" 2>/dev/null || true
}

case "${1:-start}" in
  start)
    stop_all
    sleep 0.3
    echo "▸ Core API   → http://127.0.0.1:${CORE_PORT}"
    node "$ROOT_DIR/ecosystem/dist/server.js" &
    CORE_PID=$!
    sleep 1
    echo "▸ Мост      → http://127.0.0.1:${BRIDGE_PORT} (терминал для веб-сборки)"
    BRIDGE_PORT="$BRIDGE_PORT" node "$ROOT_DIR/scripts/bridge.cjs" &
    BRIDGE_PID=$!
    echo "▸ Веб-IDE   → http://127.0.0.1:${CODER_PORT}"
    node "$ROOT_DIR/scripts/serve-dist.cjs" "$CODER_PORT" &
    CODER_PID=$!
    trap 'kill $CORE_PID $BRIDGE_PID $CODER_PID 2>/dev/null || true' INT TERM
    wait
    ;;
  stop)
    stop_all
    echo "✔ Остановлено"
    ;;
  core)
    exec node "$ROOT_DIR/ecosystem/dist/server.js"
    ;;
  coder)
    exec node "$ROOT_DIR/scripts/serve-dist.cjs" "$CODER_PORT"
    ;;
  bridge)
    exec node "$ROOT_DIR/scripts/bridge.cjs"
    ;;
  logs)
    journalctl --user -u infinity-core.service -u infinity-coder.service -u infinity-bridge.service -n 100 --no-pager 2>/dev/null \
      || echo "Журналы systemd недоступны"
    ;;
  *)
    echo "Использование: $0 [start|stop|core|coder|bridge|logs]" >&2
    exit 1
    ;;
esac
