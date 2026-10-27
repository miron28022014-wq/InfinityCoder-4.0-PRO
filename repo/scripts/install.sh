#!/usr/bin/env bash
# Установщик InfinityCoder 4.0 (Linux, macOS).
#
# Ставит:
#   • InfinityCoder 4.0 — веб-IDE (собранный бандл + локальный сервер);
#   • Infinity Ecosystem Core API — серверная часть экосистемы (sidecar);
#   • терминальный мост — чтобы веб-сборка исполняла настоящие команды.
#
# Использование:
#   ./scripts/install.sh                      # установка в ~/InfinityCoder
#   ./scripts/install.sh --dir /opt/ic        # другой каталог
#   ./scripts/install.sh --no-service         # без systemd
#   ./scripts/install.sh --uninstall          # удаление (данные сохраняются)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALL_DIR="${INFINITY_INSTALL_DIR:-$HOME/InfinityCoder}"
WITH_SERVICE=1
DO_UNINSTALL=0
NODE_MIN_MAJOR=22
NODE_MIN_MINOR=5

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) INSTALL_DIR="$2"; shift 2 ;;
    --no-service) WITH_SERVICE=0; shift ;;
    --uninstall) DO_UNINSTALL=1; shift ;;
    -h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Неизвестный аргумент: $1" >&2; exit 1 ;;
  esac
done

say()  { printf '\033[1;36m▸\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✔\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m✖\033[0m %s\n' "$*" >&2; exit 1; }

# ── Удаление ────────────────────────────────────────────────────────────────
if [ "$DO_UNINSTALL" -eq 1 ]; then
  say "Останавливаю службы"
  if command -v systemctl >/dev/null 2>&1; then
    for svc in infinity-core infinity-coder infinity-bridge; do
      systemctl --user stop "$svc.service" 2>/dev/null || true
      systemctl --user disable "$svc.service" 2>/dev/null || true
      rm -f "$HOME/.config/systemd/user/$svc.service"
    done
    systemctl --user daemon-reload 2>/dev/null || true
  fi
  pkill -f "$INSTALL_DIR/ecosystem/dist/server.js" 2>/dev/null || true
  pkill -f "$INSTALL_DIR/scripts/serve-dist.cjs" 2>/dev/null || true
  pkill -f "$INSTALL_DIR/scripts/bridge.cjs" 2>/dev/null || true
  say "Удаляю $INSTALL_DIR (данные в $INSTALL_DIR.data сохраняются)"
  [ -d "$INSTALL_DIR" ] && rm -rf "$INSTALL_DIR"
  ok "Готово"
  exit 0
fi

# ── Проверки ────────────────────────────────────────────────────────────────
say "Проверяю окружение"
command -v node >/dev/null 2>&1 || die "Node.js не найден. Нужен Node.js ≥ ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR}"
command -v npm  >/dev/null 2>&1 || die "npm не найден"
NODE_OK="$(node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.stdout.write((a>22||(a===22&&b>=5))?"1":"0")')"
[ "$NODE_OK" = "1" ] || die "Node.js $(node -v) слишком старый. Нужен ≥ ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR}"
ok "Node.js $(node -v), npm $(npm -v)"

# ── Развёртывание ───────────────────────────────────────────────────────────
say "Разворачиваю InfinityCoder 4.0 в $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
for item in src public scripts ecosystem index.html package.json package-lock.json \
            tsconfig.json vite.config.ts tailwind.config.js postcss.config.js README.md; do
  [ -e "$ROOT_DIR/$item" ] && cp -R "$ROOT_DIR/$item" "$INSTALL_DIR/"
done
cp -R "$ROOT_DIR/docs" "$INSTALL_DIR/" 2>/dev/null || true
rm -rf "$INSTALL_DIR/node_modules" "$INSTALL_DIR/dist" "$INSTALL_DIR/ecosystem/dist"
ok "Файлы развёрнуты"

# ── Зависимости и сборка ────────────────────────────────────────────────────
cd "$INSTALL_DIR"
say "Устанавливаю зависимости"
npm install --no-audit --no-fund --loglevel=error --strict-ssl=false
ok "Зависимости установлены"

say "Собираю веб-IDE (vite)"
npm run build --silent
ok "Веб-IDE собран"

say "Собираю Core API экосистемы"
npm run ecosystem:build --silent
ok "Core API собран"

# ── Конфигурация ────────────────────────────────────────────────────────────
ENV_FILE="$INSTALL_DIR/.env"
DATA_DIR="$INSTALL_DIR/.data"
mkdir -p "$DATA_DIR"

if [ -f "$ENV_FILE" ]; then
  ok "Конфигурация $ENV_FILE уже есть — сохраняю её"
else
  if command -v openssl >/dev/null 2>&1; then
    MASTER_KEY="$(openssl rand -hex 32)"
  else
    MASTER_KEY="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  fi
  cat > "$ENV_FILE" <<EOF
# InfinityCoder 4.0 — конфигурация. Создано установщиком.
# Мастер-ключ шифрует секреты провайдеров в экосистеме. НЕ теряйте и не публикуйте.
INFINITY_MASTER_KEY=$MASTER_KEY
INFINITY_DB=$DATA_DIR/infinity.db
INFINITY_CODER_WORKSPACE=$DATA_DIR/coder-workspaces
INFINITY_HOST=127.0.0.1
INFINITY_PORT=8787
INFINITY_DEFAULT_MODE=cloud
INFINITY_CORS_ORIGINS=*
INFINITY_CODER_HOST=127.0.0.1
INFINITY_CODER_PORT=8090
INFINITY_BRIDGE_PORT=5299
INFINITY_API_URL=http://127.0.0.1:8787
EOF
  chmod 600 "$ENV_FILE"
  ok "Создан $ENV_FILE с мастер-ключом"
fi

# ── Миграции ────────────────────────────────────────────────────────────────
say "Применяю миграции БД экосистемы"
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
npm run ecosystem:migrate --silent
ok "Схема БД актуальна"

# ── Службы ──────────────────────────────────────────────────────────────────
NODE_BIN="$(command -v node)"
if [ "$WITH_SERVICE" -eq 1 ] && command -v systemctl >/dev/null 2>&1; then
  UNIT_DIR="$HOME/.config/systemd/user"
  mkdir -p "$UNIT_DIR"
  write_unit() {
    local name="$1" desc="$2" cmd="$3"
    cat > "$UNIT_DIR/$name.service" <<EOF
[Unit]
Description=$desc
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN $cmd
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF
  }
  write_unit infinity-core "Infinity Ecosystem Core API" "$INSTALL_DIR/ecosystem/dist/server.js"
  write_unit infinity-coder "InfinityCoder 4.0 — веб-IDE" "$INSTALL_DIR/scripts/serve-dist.cjs 8090"
  write_unit infinity-bridge "InfinityCoder — терминальный мост" "$INSTALL_DIR/scripts/bridge.cjs"
  systemctl --user daemon-reload >/dev/null 2>&1 || true
  for svc in infinity-core infinity-coder infinity-bridge; do
    systemctl --user enable --now "$svc.service" >/dev/null 2>&1 \
      || warn "Не удалось запустить $svc.service — запустите вручную"
  done
  ok "Службы зарегистрированы: infinity-core, infinity-coder, infinity-bridge"
else
  warn "Службы systemd не регистрировались — запуск через ./scripts/start.sh"
fi

cat <<EOF

$(ok "Установка InfinityCoder 4.0 завершена")

  Каталог установки : $INSTALL_DIR
  Конфигурация      : $ENV_FILE
  Данные и проекты  : $DATA_DIR

  Веб-IDE           : http://127.0.0.1:8090
  Core API          : http://127.0.0.1:8787
  Терминальный мост : http://127.0.0.1:5299

  Запуск вручную    : cd $INSTALL_DIR && ./scripts/start.sh
  Остановка         : cd $INSTALL_DIR && ./scripts/stop.sh
  Удаление          : ./scripts/install.sh --uninstall

  Что дальше:
   1. Откройте http://127.0.0.1:8090 и зарегистрируйтесь (Infinity ID).
   2. Вкладка «Экосистема» слева → адрес Core API → «Подключить».
   3. В «Настройки → Модель» добавьте провайдера (llama.cpp или OpenAI-совместимый).
   4. В «Настройки → Экосистема» включите «Использовать экосистему» и выберите модель:
      генерация пойдёт через AI Runtime ядра, ключи останутся на сервере.

EOF
