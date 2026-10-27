/**
 * Панель «Экосистема».
 *
 * Здесь IDE подключается к Infinity Ecosystem: Infinity ID, модели и
 * провайдеры (AI Runtime), общие разрешения инструментов (Tool Runtime),
 * поиск по другим приложениям, общая память, журнал изменений (Sync) и
 * диагностика ядра. Вне экосистемы IDE работает автономно.
 */
import { useEffect, useState } from "react";
import { Icon } from "../../icons";
import { Btn, Empty, Field, Input, Select, StatusDot } from "../ui";
import { useStore } from "../../hooks/useStore";
import {
  ecoConnect,
  ecoLogin,
  ecoLogout,
  ecoRefresh,
  ecoRegister,
  ecoSaveReport,
  ecoSearch,
  ecoSetGrant,
  ecoSync,
  patchSettings
} from "../../store";
import { ecoStatus } from "../../lib/tokens";

type GrantScope = "ask" | "allow" | "deny";

const SCOPE_LABEL: Record<GrantScope, string> = {
  ask: "спрашивать",
  allow: "разрешить",
  deny: "запретить"
};

export function EcosystemPanel() {
  const eco = useStore(s => s.eco);
  const settings = useStore(s => s.settings);
  const messages = useStore(s => s.messages);

  const [url, setUrl] = useState(settings.ecosystemUrl || eco.url);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ objectId: string; app: string; title: string; snippet: string }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setUrl(settings.ecosystemUrl || eco.url);
  }, [settings.ecosystemUrl, eco.url]);

  const status: "ready" | "error" | "checking" | "offline" =
    eco.status === "online" ? "ready" : eco.status === "connecting" ? "checking" : eco.status === "error" ? "error" : "offline";

  const selectedModel = eco.models.find(m => m.id === settings.ecosystemModelId);
  const scopeConflict = Boolean(selectedModel && selectedModel.scope === "cloud" && settings.ecosystemScope === "local");

  const runSearch = async () => {
    if (!query.trim()) {
      setHits([]);
      return;
    }
    setBusy(true);
    try {
      setHits(await ecoSearch(query.trim()));
    } finally {
      setBusy(false);
    }
  };

  const lastReport = [...messages].reverse().find(m => m.role === "assistant" && m.content.trim().length > 0);

  return (
    <div className="ic-scroll flex h-full flex-col gap-3 p-2.5">
      {/* ── Связь ─────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
            <Icon name="server" size={13} className="text-accent" />
            Infinity Ecosystem
          </span>
          <span className="flex items-center gap-1.5 text-[10.5px] text-ink-mute">
            <StatusDot status={status} size={6} />
            {eco.message}
          </span>
        </div>

        <div className="flex gap-1.5">
          <Input
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="http://127.0.0.1:8787"
            className="h-7 text-[11.5px]"
          />
          <Btn
            size="sm"
            variant="primary"
            icon="link"
            tip="Подключиться к Core API"
            onClick={() => void ecoConnect(url)}
          />
        </div>
        {eco.error && (
          <p className="rounded-lg border border-line bg-raised/50 px-2 py-1.5 text-[11px] text-ink-mute">
            {eco.error}
          </p>
        )}
        {eco.status === "online" && (
          <div className="flex items-center gap-1.5">
            <Btn size="sm" icon="refresh" tip="Обновить модели, провайдеры и разрешения" onClick={() => void ecoRefresh()} />
            <Btn
              size="sm"
              icon="rotate"
              tip="Забрать изменения экосистемы (Sync)"
              onClick={() => void ecoSync()}
            >
              {eco.pendingChanges > 0 ? eco.pendingChanges : "Sync"}
            </Btn>
            {eco.lastSync && (
              <span className="text-[10px] text-ink-mute">
                {new Date(eco.lastSync).toLocaleTimeString("ru-RU")}
              </span>
            )}
          </div>
        )}
      </section>

      {/* ── Infinity ID ───────────────────────────────────────────── */}
      <section className="space-y-2 border-t border-line pt-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
            <Icon name="user" size={13} className="text-accent" />
            Infinity ID
          </span>
          {eco.account && (
            <Btn size="sm" variant="ghost" icon="x" tip="Выйти" onClick={() => void ecoLogout()} />
          )}
        </div>

        {eco.account ? (
          <div className="rounded-xl2 border border-line bg-raised/40 px-2.5 py-2">
            <p className="truncate text-[12px] font-medium text-ink">{eco.account.displayName}</p>
            <p className="truncate text-[10.5px] text-ink-mute">{eco.account.email}</p>
            <p className="mt-1 font-mono text-[9.5px] text-ink-mute">{eco.account.id}</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Input
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="email"
              className="h-7 text-[11.5px]"
            />
            <Input
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="пароль"
              type="password"
              className="h-7 text-[11.5px]"
              onKeyDown={e => {
                if (e.key === "Enter" && email && password) void ecoLogin(email, password);
              }}
            />
            <div className="flex gap-1.5">
              <Btn
                size="sm"
                variant="primary"
                className="flex-1 justify-center"
                disabled={!email || !password}
                onClick={() => void ecoLogin(email, password)}
              >
                Войти
              </Btn>
              <Btn
                size="sm"
                className="flex-1 justify-center"
                disabled={!email || !password}
                onClick={() => void ecoRegister(email, password)}
              >
                Регистрация
              </Btn>
            </div>
            <p className="text-[10px] leading-snug text-ink-mute">
              Токен хранится только в этом браузере. Без входа IDE работает автономно.
            </p>
          </div>
        )}
      </section>

      {/* ── Модель и режим ────────────────────────────────────────── */}
      <section className="space-y-2 border-t border-line pt-2.5">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
          <Icon name="cpu" size={13} className="text-accent" />
          Модель и режим
        </span>

        <Field label="Использовать экосистему" hint="AI Runtime ядра">
          <div className="flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={settings.ecosystemUse}
              aria-label="Использовать экосистему"
              className="ic-switch"
              data-on={settings.ecosystemUse}
              onClick={() => patchSettings({ ecosystemUse: !settings.ecosystemUse })}
            />
            <span className="text-[11px] text-ink-mute">
              {settings.ecosystemUse ? "генерация идёт через сервер" : "локальный провайдер"}
            </span>
          </div>
        </Field>

        <Field label="Модель">
          <Select
            value={settings.ecosystemModelId}
            onChange={v => patchSettings({ ecosystemModelId: v })}
            options={[
              { value: "", label: "— не выбрана —" },
              ...eco.models.map(m => ({
                value: m.id,
                label: `${m.displayName} · ${m.scope === "local" ? "локальная" : "облако"}`
              }))
            ]}
            className="h-7 text-[11.5px]"
          />
        </Field>

        <Field label="Режим маршрутизации" hint="сервер блокирует облако в local">
          <Select
            value={settings.ecosystemScope}
            onChange={v => patchSettings({ ecosystemScope: v })}
            options={[
              { value: "local", label: "локально" },
              { value: "cloud", label: "облако" }
            ]}
            className="h-7 text-[11.5px]"
          />
        </Field>

        {scopeConflict && (
          <p className="rounded-lg border px-2 py-1.5 text-[10.5px] leading-snug"
             style={{ borderColor: "rgb(var(--ic-warn) / 0.5)", color: "rgb(var(--ic-warn))" }}>
            Выбрана облачная модель при локальном режиме. Сервер вернёт LOCAL_MODE_BLOCKED — облако
            вызвано не будет. Смените модель или режим.
          </p>
        )}
      </section>

      {/* ── Разрешения инструментов ───────────────────────────────── */}
      <section className="space-y-1.5 border-t border-line pt-2.5">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
          <Icon name="shieldCheck" size={13} className="text-accent" />
          Разрешения инструментов
        </span>
        {eco.grants.length === 0 ? (
          <p className="text-[10.5px] leading-snug text-ink-mute">
            Грантов пока нет. Они появятся после входа: Tool Runtime хранит их на сервере.
          </p>
        ) : (
          eco.grants.map(g => (
            <div key={g.tool} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-mono text-[10.5px] text-ink-soft">{g.tool}</span>
              <Select
                value={g.scope}
                onChange={v => void ecoSetGrant(g.tool, v as GrantScope)}
                options={(["ask", "allow", "deny"] as GrantScope[]).map(s => ({
                  value: s,
                  label: SCOPE_LABEL[s]
                }))}
                className="h-6 w-[104px] shrink-0 text-[10.5px]"
              />
            </div>
          ))
        )}
      </section>

      {/* ── Поиск по экосистеме ───────────────────────────────────── */}
      <section className="space-y-1.5 border-t border-line pt-2.5">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
          <Icon name="search" size={13} className="text-accent" />
          Поиск по экосистеме
        </span>
        <div className="flex gap-1.5">
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Notes, Drive, история, память…"
            className="h-7 text-[11.5px]"
            onKeyDown={e => {
              if (e.key === "Enter") void runSearch();
            }}
          />
          <Btn size="sm" icon="search" loading={busy} tip="Найти" onClick={() => void runSearch()} />
        </div>
        {hits.length > 0 && (
          <div className="max-h-44 space-y-1 overflow-y-auto">
            {hits.map(h => (
              <div key={h.objectId} className="rounded-lg border border-line bg-raised/40 px-2 py-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-accent/15 px-1 text-[9.5px] text-accent">{h.app}</span>
                  <span className="min-w-0 truncate text-[11px] text-ink">{h.title}</span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-[10px] text-ink-mute">{h.snippet}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Обмен с другими приложениями ──────────────────────────── */}
      <section className="space-y-1.5 border-t border-line pt-2.5">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
          <Icon name="link" size={13} className="text-accent" />
          Обмен с приложениями
        </span>
        <Btn
          size="sm"
          className="w-full justify-center"
          icon="save"
          disabled={!lastReport || !eco.account}
          tip={lastReport ? "Сохранить последний отчёт агента в Infinity Notes" : "Сначала получите отчёт агента"}
          onClick={() => {
            if (!lastReport) return;
            void ecoSaveReport(
              `InfinityCoder · ${new Date().toLocaleString("ru-RU")}`,
              lastReport.content
            );
          }}
        >
          Сохранить отчёт в Infinity Notes
        </Btn>
      </section>

      {/* ── Диагностика ───────────────────────────────────────────── */}
      {eco.diagnostics && (
        <section className="space-y-1 border-t border-line pt-2.5">
          <span className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
            <Icon name="activity" size={13} className="text-accent" />
            Диагностика ядра
          </span>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10.5px] text-ink-mute">
            <span>провайдеров</span>
            <span className="tabular text-right text-ink-soft">
              {eco.diagnostics.enabled}/{eco.diagnostics.providers}
            </span>
            <span>моделей</span>
            <span className="tabular text-right text-ink-soft">{eco.diagnostics.models}</span>
            <span>локальных / облачных</span>
            <span className="tabular text-right text-ink-soft">
              {eco.diagnostics.local} / {eco.diagnostics.cloud}
            </span>
            <span>в индексе поиска</span>
            <span className="tabular text-right text-ink-soft">{eco.diagnostics.indexed}</span>
          </div>
          <p className="pt-1 text-[9.5px] text-ink-mute">
            Статус интеграции: {ecoStatus.partial} — автономный режим сохранён, серверные проекты
            и сопряжение устройств не реализованы.
          </p>
        </section>
      )}

      {eco.status === "off" && !eco.url && (
        <Empty
          icon="server"
          title="Экосистема не подключена"
          hint="Укажите адрес Core API — и модель, разрешения, память и поиск переедут на сервер."
        />
      )}
    </div>
  );
}
