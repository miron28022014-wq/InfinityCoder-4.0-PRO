import { useEffect, useState } from "react";
import { Icon, type IconName } from "../../icons";
import { Btn, Dialog, Field, Input, Segmented, Select, Switch } from "../ui";
import { useStore, shallow } from "../../hooks/useStore";
import { checkProvider, ecoConnect, openSettings, patchSettings } from "../../store";
import { CLOUD_MODELS, DEFAULT_SETTINGS, RELAY_BASE_URL } from "../../lib/settings";
import { AGENTS } from "../../lib/agents";
import { isTauri } from "../../lib/ipc";
import type { AskPolicy, Effort, Mode, ProviderKind } from "../../types";

const SECTIONS: Array<{ id: string; label: string; icon: IconName }> = [
  { id: "model", label: "Модель", icon: "cpu" },
  { id: "ecosystem", label: "Экосистема", icon: "server" },
  { id: "engine", label: "Движок", icon: "target" },
  { id: "autonomy", label: "Автономность", icon: "rocket" },
  { id: "swarm", label: "Рой", icon: "swarm" },
  { id: "agents", label: "Роли", icon: "bot" },
  { id: "ui", label: "Интерфейс", icon: "grid" }
];

export function SettingsDialog() {
  const open = useStore(s => s.settingsOpen);
  const settings = useStore(s => s.settings, shallow);
  const status = useStore(s => s.providerStatus);
  const message = useStore(s => s.providerMessage);
  const eco = useStore(s => s.eco);
  const [tab, setTab] = useState("model");
  const [showKey, setShowKey] = useState(false);
  const [base, setBase] = useState(settings.baseUrl);

  useEffect(() => {
    if (open) {
      setTab("model");
      setBase(settings.baseUrl);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog
      open={open}
      onClose={() => openSettings(false)}
      title="Настройки"
      icon="settings"
      width={720}
      footer={
        <>
          <span className="mr-auto flex items-center gap-1.5 text-[11px] text-ink-mute">
            <Icon
              name={status === "ready" ? "checkCircle" : status === "error" ? "xCircle" : "clock"}
              size={12}
              style={{
                color:
                  status === "ready"
                    ? "rgb(var(--ic-ok))"
                    : status === "error"
                      ? "rgb(var(--ic-danger))"
                      : "rgb(var(--ic-warn))"
              }}
            />
            {message}
          </span>
          <Btn variant="outline" onClick={() => openSettings(false)}>
            Закрыть
          </Btn>
        </>
      }
    >
      <div className="flex gap-5">
        {/* nav */}
        <nav className="w-[152px] shrink-0 space-y-0.5">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => setTab(s.id)}
              className="ic-list-row h-8"
              data-selected={tab === s.id}
            >
              <Icon name={s.icon} size={13} className="text-ink-mute" />
              {s.label}
            </button>
          ))}
        </nav>

        {/* body */}
        <div className="min-w-0 flex-1 space-y-4">
          {tab === "model" && (
            <>
              <div className="space-y-3">
                <Field label="Провайдер" hint={isTauri ? "облако или локальная модель" : "облако (в браузере локальной модели нет)"}>
                  <Segmented<ProviderKind>
                    value={settings.provider}
                    onChange={v =>
                      patchSettings({
                        provider: v,
                        baseUrl: v === "local" ? `http://127.0.0.1:${settings.localPort}` : base || RELAY_BASE_URL
                      })
                    }
                    items={[
                      { value: "cloud", label: "Облако", icon: "globe" },
                      { value: "local", label: "Локально", icon: "server" }
                    ]}
                  />
                </Field>

                {settings.provider === "cloud" ? (
                  <>
                    <Field label="API-ключ" hint="хранится только в этом браузере">
                      <div className="flex gap-1.5">
                        <div className="relative flex-1">
                          <Input
                            type={showKey ? "text" : "password"}
                            value={settings.apiKey}
                            placeholder="sk-…"
                            className="pr-8"
                            onChange={e => patchSettings({ apiKey: e.target.value.trim() })}
                          />
                          <button
                            onClick={() => setShowKey(v => !v)}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-mute transition-colors hover:bg-raised hover:text-ink"
                            type="button"
                          >
                            <Icon name={showKey ? "eyeOff" : "eye"} size={13} />
                          </button>
                        </div>
                        <Btn variant="outline" icon="refresh" tip="Проверить" onClick={() => void checkProvider()} />
                      </div>
                      {!settings.apiKey && (
                        <p className="mt-1.5 text-[11px] leading-relaxed text-warn">
                          Ключ не задан. Получите его у вашего провайдера и вставьте сюда — в сборку он не встроен.
                        </p>
                      )}
                    </Field>

                    <Field label="Модель" hint="выберите из списка или введите свою">
                      <Input
                        list="ic-models"
                        value={settings.model}
                        onChange={e => patchSettings({ model: e.target.value.trim() })}
                        placeholder="gpt-6-astra"
                      />
                      <datalist id="ic-models">
                        {CLOUD_MODELS.map(m => (
                          <option key={m} value={m} />
                        ))}
                      </datalist>
                    </Field>

                    <Field label="Базовый URL" hint="OpenAI-совместимый endpoint">
                      <div className="flex gap-1.5">
                        <Input
                          value={base}
                          onChange={e => setBase(e.target.value)}
                          onBlur={() => patchSettings({ baseUrl: base.replace(/\/+$/, "").replace(/\/v1$/, "") })}
                          placeholder={RELAY_BASE_URL}
                          className="flex-1"
                        />
                        <Btn variant="outline" onClick={() => { setBase(RELAY_BASE_URL); patchSettings({ baseUrl: RELAY_BASE_URL }); }}>
                          Сброс
                        </Btn>
                      </div>
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label="Порт локального сервера" hint="llama-server / LM Studio / Ollama">
                      <Input
                        type="number"
                        value={settings.localPort}
                        onChange={e =>
                          patchSettings({
                            localPort: Number(e.target.value) || 8080,
                            baseUrl: `http://127.0.0.1:${Number(e.target.value) || 8080}`
                          })
                        }
                      />
                    </Field>
                    <Field label="Имя модели" hint="alias, который вы задали при запуске сервера">
                      <Input value={settings.localModel} onChange={e => patchSettings({ localModel: e.target.value })} />
                    </Field>
                    <p className="rounded-xl2 border border-line bg-raised/40 p-2.5 text-[11.5px] leading-relaxed text-ink-mute">
                      Локальный режим управляет встроенным llama-server: приложение запускает его сам с моделью из
                      папки <span className="ic-mono text-ink-soft">%APPDATA%\com.miron.infinitycoder\models</span> и
                      ждёт готовности. Укажите порт, если он отличается от 8080.
                    </p>
                  </>
                )}
              </div>
            </>
          )}

          {tab === "ecosystem" && (
            <>
              <div className="space-y-3">
                <Field label="Core API" hint="общий сервер Infinity Ecosystem">
                  <div className="flex gap-2">
                    <Input
                      value={settings.ecosystemUrl}
                      placeholder="http://127.0.0.1:8787"
                      onChange={e => patchSettings({ ecosystemUrl: e.target.value })}
                    />
                    <Btn
                      variant="primary"
                      icon="link"
                      onClick={() => void ecoConnect(settings.ecosystemUrl)}
                    >
                      Подключить
                    </Btn>
                  </div>
                </Field>

                <ToggleRow
                  icon="server"
                  title="Использовать экосистему"
                  hint="Генерация идёт через AI Runtime ядра: ключи провайдеров хранит сервер, локальный режим блокирует облако на маршрутизаторе."
                  value={settings.ecosystemUse}
                  onChange={v => patchSettings({ ecosystemUse: v })}
                />
                <ToggleRow
                  icon="rotate"
                  title="Подключаться при запуске"
                  hint="Автоматически подключаться к указанному адресу при старте IDE."
                  value={settings.ecosystemAutoConnect}
                  onChange={v => patchSettings({ ecosystemAutoConnect: v })}
                />
                <ToggleRow
                  icon="history"
                  title="Синхронизация"
                  hint="Забирать журнал изменений экосистемы (Sync) и показывать счётчик в панели."
                  value={settings.ecosystemSync}
                  onChange={v => patchSettings({ ecosystemSync: v })}
                />
                <ToggleRow
                  icon="memory"
                  title="Общая память"
                  hint="Отправлять факты из памяти проекта в общую память экосистемы — их увидят и другие приложения."
                  value={settings.ecosystemShareMemory}
                  onChange={v => patchSettings({ ecosystemShareMemory: v })}
                />
              </div>

              {eco.status === "online" && (
                <div className="rounded-xl2 border border-line bg-raised/35 px-3 py-2.5">
                  <p className="text-[12px] font-medium text-ink">
                    {eco.account ? `Вы вошли как ${eco.account.email}` : "Подключено без входа"}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-ink-mute">
                    Модели: {eco.models.length} · провайдеров: {eco.providers.length} · грантов:{" "}
                    {eco.grants.length}. Вход и управление разрешениями — в панели «Экосистема» слева.
                  </p>
                </div>
              )}
            </>
          )}

          {tab === "engine" && (
            <div className="space-y-3">
              <Field label="Режим работы" hint="рои лучше на больших независимых задачах">
                <Segmented<Mode>
                  value={settings.mode}
                  onChange={v => patchSettings({ mode: v })}
                  items={[
                    { value: "agent", label: "Один агент", icon: "bot" },
                    { value: "swarm", label: "Рой", icon: "swarm" }
                  ]}
                />
              </Field>

              <Field label="Сложность" hint="управляет глубиной, температурой и числом проверок">
                <Select<Effort>
                  value={settings.effort}
                  onChange={v => patchSettings({ effort: v as Effort })}
                  options={(["low", "medium", "high", "ultra"] as Effort[]).map(e => ({
                    value: e,
                    label: { low: "Низкий", medium: "Средний", high: "Высокий", ultra: "Ультра" }[e]
                  }))}
                />
              </Field>

              <Field label="Подтверждения" hint="когда спрашивать перед действием">
                <Select<AskPolicy>
                  value={settings.ask}
                  onChange={v => patchSettings({ ask: v as AskPolicy })}
                  options={[
                    { value: "never", label: "Никогда — работаю автономно" },
                    { value: "smart", label: "Только опасные операции" },
                    { value: "always", label: "Перед каждым действием" }
                  ]}
                />
              </Field>

              <div className="space-y-2 pt-1">
                <ToggleRow
                  icon="layers"
                  title="Строить план перед выполнением"
                  hint="Архитектор раскладывает задачу на шаги — надёжнее, но на один вызов модели больше."
                  value={settings.planFirst}
                  onChange={v => patchSettings({ planFirst: v })}
                />
                <ToggleRow
                  icon="shieldCheck"
                  title="Проверять и чинить результат"
                  hint="После ответа агент критикует сам себя и при необходимости продолжает работу."
                  value={settings.verifyResult}
                  onChange={v => patchSettings({ verifyResult: v })}
                />
                <ToggleRow
                  icon="memory"
                  title="Автоматическая память"
                  hint="Подмешивать релевантные записи из памяти проекта, когда агент встретил незнакомый термин."
                  value={settings.autoRecall}
                  onChange={v => patchSettings({ autoRecall: v })}
                />
              </div>
            </div>
          )}

          {tab === "autonomy" && (
            <div className="space-y-3">
              <div className="rounded-xl2 border border-violet/25 bg-violet/8 p-3">
                <div className="flex items-start gap-2">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-violet/15 text-violet">
                    <Icon name="rocket" size={14} />
                  </span>
                  <div className="min-w-0 text-[12px] leading-relaxed text-ink-soft">
                    В автономном режиме агент сам продолжает работу, если задача не закрыта,
                    и не спрашивает подтверждения на безопасных операциях. Разрушительные
                    действия и гранты экосистемы по-прежнему требуют вашего решения.
                  </div>
                </div>
              </div>

              <ToggleRow
                icon="rocket"
                title="Автономный режим"
                hint="Агент не останавливается на полпути: если финальный ответ оставляет задачу незакрытой, он продолжает работать инструментами."
                value={settings.autonomous}
                onChange={v => patchSettings({ autonomous: v })}
              />

              <Field label="Продолжений без спроса" hint="сколько раз агент может вернуться к незавершённой задаче">
                <Segmented
                  value={String(settings.autonomousNudges)}
                  onChange={v => patchSettings({ autonomousNudges: Number(v) })}
                  items={[
                    { value: "0", label: "Не продолжать" },
                    { value: "1", label: "1 раз" },
                    { value: "2", label: "2 раза" },
                    { value: "3", label: "3 раза" }
                  ]}
                />
              </Field>

              <Field label="Подтверждения" hint="когда спрашивать перед действием">
                <Select<AskPolicy>
                  value={settings.ask}
                  onChange={v => patchSettings({ ask: v as AskPolicy })}
                  options={[
                    { value: "never", label: "Никогда — работаю автономно" },
                    { value: "smart", label: "Только опасные операции" },
                    { value: "always", label: "Перед каждым действием" }
                  ]}
                />
              </Field>

              <ToggleRow
                icon="shieldCheck"
                title="Проверять и чинить результат"
                hint="После ответа агент критикует сам себя и при необходимости продолжает работу."
                value={settings.verifyResult}
                onChange={v => patchSettings({ verifyResult: v })}
              />

              <ToggleRow
                icon="layers"
                title="Строить план перед выполнением"
                hint="Архитектор раскладывает задачу на шаги — надёжнее, но на один вызов модели больше."
                value={settings.planFirst}
                onChange={v => patchSettings({ planFirst: v })}
              />
            </div>
          )}

          {tab === "swarm" && (
            <div className="space-y-3">
              <Field label="Размер роя" hint="сколько агентов работает одновременно">
                <Segmented
                  value={String(settings.swarmSize)}
                  onChange={v => patchSettings({ swarmSize: Number(v) })}
                  items={[2, 3, 4, 5, 6].map(n => ({ value: String(n), label: String(n) }))}
                />
              </Field>
              <ToggleRow
                icon="swarm"
                title="Параллельное выполнение"
                hint="Быстрее, но воркеры могут трогать одни и такие же файлы — конфликты подсвечиваются в отчёте."
                value={settings.parallelSwarm}
                onChange={v => patchSettings({ parallelSwarm: v })}
              />
              <p className="rounded-xl2 border border-line bg-raised/40 p-2.5 text-[11.5px] leading-relaxed text-ink-mute">
                Рой автоматически назначает подзадачи ролям: тесты — тестировщику, ревью — ревьюеру, поиск и API —
                исследователю, остальное — разработчику. Каждый воркер получает свой системный промпт и
                ограниченный набор инструментов.
              </p>
            </div>
          )}

          {tab === "agents" && (
            <div className="space-y-2">
              <p className="mb-2 text-[11.5px] leading-relaxed text-ink-mute">
                Роль по умолчанию. При автовыборе агент переключает роль сам в зависимости от задачи.
              </p>
              {AGENTS.map(a => {
                const on = settings.activeAgent === a.id && !settings.autoRoute;
                return (
                  <button
                    key={a.id}
                    onClick={() => patchSettings({ activeAgent: a.id, autoRoute: false })}
                    className="w-full rounded-xl2 border px-3 py-2.5 text-left transition-all duration-200"
                    style={{
                      borderColor: on ? `rgb(${a.tint} / 0.5)` : "rgb(var(--ic-line))",
                      background: on ? `rgb(${a.tint} / 0.08)` : "rgb(var(--ic-raised) / 0.4)"
                    }}
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
                        style={{ background: `rgb(${a.tint} / 0.16)`, color: `rgb(${a.tint})` }}
                      >
                        <Icon name={a.icon as IconName} size={14} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] font-medium text-ink">{a.name}</span>
                        <span className="block text-[11px] text-ink-mute">
                          {a.allow.length ? `${a.allow.length} инструментов` : "все инструменты"} · до {a.maxTurns} ходов
                        </span>
                      </span>
                      {on && <Icon name="check" size={14} style={{ color: `rgb(${a.tint})` }} />}
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-ink-mute">{a.directive}</p>
                  </button>
                );
              })}
              <ToggleRow
                icon="wand"
                title="Автовыбор роли"
                hint="Агент сам подбирает роль под характер задачи (по умолчанию включено)."
                value={settings.autoRoute}
                onChange={v => patchSettings({ autoRoute: v })}
              />
            </div>
          )}

          {tab === "ui" && (
            <div className="space-y-3">
              <Field label="Тема">
                <Segmented
                  value={settings.theme}
                  onChange={v => patchSettings({ theme: v as "dark" | "light" })}
                  items={[
                    { value: "dark", label: "Тёмная", icon: "moon" },
                    { value: "light", label: "Светлая", icon: "sun" }
                  ]}
                />
              </Field>
              <ToggleRow
                icon="activity"
                title="Журнал действий"
                hint="Показывать под чатом подробный поток вызовов инструментов."
                value={settings.showActivity}
                onChange={v => patchSettings({ showActivity: v })}
              />
              <div className="flex justify-end pt-1">
                <Btn
                  variant="ghost"
                  size="sm"
                  icon="rotate"
                  onClick={() => patchSettings({ ...DEFAULT_SETTINGS, apiKey: settings.apiKey })}
                >
                  Сбросить настройки
                </Btn>
              </div>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function ToggleRow({
  icon,
  title,
  hint,
  value,
  onChange
}: {
  icon: IconName;
  title: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      className="flex items-start gap-2.5 rounded-xl2 border border-line bg-raised/35 px-3 py-2.5 transition-colors hover:border-line-strong"
    >
      <Icon name={icon} size={14} className="mt-0.5 shrink-0 text-ink-mute" />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-mute">{hint}</p>
      </div>
      <Switch checked={value} onChange={onChange} label={title} />
    </div>
  );
}
