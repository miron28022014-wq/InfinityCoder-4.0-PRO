import { Icon, type IconName } from "../../icons";
import { useStore } from "../../hooks/useStore";
import { openFolder, patchSettings, openSettings } from "../../store";

/**
 * Стартовый экран: показывается, пока не открыт проект.
 * Это первое, что видит человек — поэтому он должен выглядеть как продукт,
 * а не как пустой экран с кнопкой.
 */
export function StartScreen() {
  const eco = useStore(s => s.eco);

  return (
    <div className="ic-start">
      <div className="ic-start__glow" />

      <div className="ic-start__inner">
        <div className="ic-start__badge">
          <Icon name="infinity" size={13} strokeWidth={2} />
          InfinityCoder 4.0 · Infinity Ecosystem
        </div>

        <h1 className="ic-start__title">
          Автономный <span className="ic-grad-text">агентный IDE</span>
        </h1>
        <p className="ic-start__lead">
          Агент читает проект, планирует работу, правит файлы, гоняет команды и
          проверяет результат. Ядро экосистемы держит модели, права доступа и
          общую память — ключи никогда не попадают в интерфейс.
        </p>

        <div className="ic-start__actions">
          <button className="ic-start__cta ic-start__cta--primary" onClick={() => void openFolder()}>
            <Icon name="folderOpen" size={16} />
            Открыть проект
            <span className="ic-start__kbd">⌘O</span>
          </button>
          <button
            className="ic-start__cta"
            onClick={() => openSettings(true)}
          >
            <Icon name="server" size={16} />
            {eco.status === "online" ? "Экосистема подключена" : "Подключить экосистему"}
          </button>
          <button className="ic-start__cta" onClick={() => openSettings(true)}>
            <Icon name="zap" size={16} />
            Автономный режим
          </button>
        </div>

        <div className="ic-start__grid">
          <Feature
            icon="target"
            title="Планирование"
            text="Задача разбивается на шаги, агент идёт по ним до результата и отмечает выполненное."
          />
          <Feature
            icon="checkCircle"
            title="Проверка и починка"
            text="После изменений — сборка, тесты и линтер. Если проверка упала, агент чинит сам."
          />
          <Feature
            icon="shield"
            title="Права на сервере"
            text="Гранты экосистемы и подтверждения локально. Данные и чужие файлы — только через сервер."
          />
          <Feature
            icon="memory"
            title="Общая память"
            text="Ledger проекта и память экосистемы: следующий сеанс начинается с того, что уже известно."
          />
          <Feature
            icon="swarm"
            title="Рой субагентов"
            text="Задача делится между агентами с ролями, результаты собираются в один отчёт."
          />
          <Feature
            icon="cpu"
            title="Локально или в облаке"
            text="Локальная модель или облачный провайдер — переключается на лету, ключи хранит ядро."
          />
        </div>

        <div className="ic-start__foot">
          <Icon name="info" size={13} />
          Проект не открыт — агент ещё не видит файлы. Откройте папку, чтобы начать.
        </div>
      </div>
    </div>
  );
}

function Feature({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <div className="ic-start__card">
      <div className="ic-start__cardIcon">
        <Icon name={icon} size={15} />
      </div>
      <div>
        <div className="ic-start__cardTitle">{title}</div>
        <div className="ic-start__cardText">{text}</div>
      </div>
    </div>
  );
}
