import { Icon, type IconName } from "../../icons";
import { Btn } from "../ui";
import { useStore } from "../../hooks/useStore";
import { openSettings, patchSettings } from "../../store";
import type { SidebarTab } from "../../types";

/**
 * Действующая панель слева — как в современных IDE: значки вместо
 * вкладок, активный элемент подсвечен полосой.
 */
const ITEMS: Array<{ id: SidebarTab; icon: IconName; label: string }> = [
  { id: "files", icon: "stack", label: "Файлы" },
  { id: "agents", icon: "swarm", label: "Агенты" },
  { id: "memory", icon: "memory", label: "Память" },
  { id: "ecosystem", icon: "server", label: "Экосистема" }
];

export function ActivityRail() {
  const tab = useStore(s => s.settings.sidebarTab);
  const info = useStore(s => s.info);
  const pending = useStore(s => s.eco.pendingChanges);

  return (
    <nav className="ic-rail" aria-label="Основная навигация">
      {ITEMS.map(item => {
        const on = tab === item.id;
        const badge =
          item.id === "memory" ? info.memories : item.id === "ecosystem" ? pending : 0;
        return (
          <button
            key={item.id}
            onClick={() => patchSettings({ sidebarTab: item.id })}
            className="ic-rail__btn"
            data-on={on}
            title={item.label}
            aria-label={item.label}
            aria-current={on ? "true" : undefined}
          >
            <Icon name={item.icon} size={17} />
            {badge > 0 && (
              <span className="ic-rail__badge" aria-label={`${badge} уведомлений`}>
                {badge > 99 ? "99+" : badge}
              </span>
            )}
          </button>
        );
      })}

      <span className="flex-1" />

      <Btn
        icon="settings"
        tip="Настройки"
        tipSide="right"
        className="ic-rail__btn"
        onClick={() => openSettings(true)}
        aria-label="Настройки"
      />
    </nav>
  );
}
