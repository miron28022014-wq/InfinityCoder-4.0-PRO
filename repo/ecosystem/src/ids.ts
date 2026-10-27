/**
 * Infinity ID — единый идентификатор экосистемы.
 *
 * Формат: `<type>_<base32 Crockford, 26 символов>` — сортируемый по времени,
 * поэтому не нужен отдельный суррогатный ключ. Type отражает сущность
 * (user, chat, file, note, task...) и не даёт перепутать типы при разборе.
 */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export type IdType =
  | 'usr'
  | 'srv'
  | 'ses'
  | 'msg'
  | 'cvs'
  | 'fil'
  | 'nte'
  | 'tsk'
  | 'mdl'
  | 'prv'
  | 'mmo'
  | 'ext'
  | 'mem'
  | 'lnk'
  | 'dev'
  | 'tst'
  | 'req'
  | 'ver'
  | 'prj'   // проект InfinityCoder
  | 'cos'   // сессия InfinityCoder
  | 'cor'   // запуск агента InfinityCoder
  | 'cst'   // шаг запуска InfinityCoder
  | 'cfv'   // версия файла InfinityCoder
  | 'lck'   // блокировка файла между субагентами
  | 'tab'   // вкладка редактора;

export type InfinityId = string & { readonly __brand: 'InfinityId' };

const ID_RE = /^[a-z]{3}_[0-9A-HJKMNP-TV-Z]{26}$/;

const TIME_CHARS = 10;
const RANDOM_CHARS = 16;

let lastMs = 0;
let lastRandom: number[] = [];

function randomBytes16(): number[] {
  const out: number[] = new Array(RANDOM_CHARS);
  for (let i = 0; i < RANDOM_CHARS; i += 1) out[i] = Math.floor(Math.random() * 32);
  return out;
}

function encodeBase32(bytes: number[]): string {
  let out = '';
  for (const b of bytes) out += CROCKFORD[b % 32];
  return out;
}

/** Монотонно возрастающий ULID-подобный суффикс: 10 символов времени + 16 случайных. */
function monotonicSuffix(): string {
  const now = Date.now();
  if (now === lastMs) {
    // инкрементируем последний байт, сохраняя сортируемость
    for (let i = lastRandom.length - 1; i >= 0; i -= 1) {
      if (lastRandom[i]! < 31) {
        lastRandom[i] = lastRandom[i]! + 1;
        break;
      }
      lastRandom[i] = 0;
    }
  } else {
    lastMs = now;
    lastRandom = randomBytes16();
  }
  const timeChars: number[] = [];
  let t = now;
  for (let i = 0; i < TIME_CHARS; i += 1) {
    timeChars.unshift(t % 32);
    t = Math.floor(t / 32);
  }
  return encodeBase32([...timeChars, ...lastRandom]);
}

export function newId(type: IdType): InfinityId {
  return `${type}_${monotonicSuffix()}` as InfinityId;
}

export function isInfinityId(value: unknown): value is InfinityId {
  return typeof value === 'string' && ID_RE.test(value);
}

/** Разбирает ID на тип и временную часть (мс). Бросает на некорректном вводе. */
export function parseId(id: string): { type: IdType; time: number } {
  if (!isInfinityId(id)) throw new TypeError(`Некорректный Infinity ID: ${id}`);
  const type = id.slice(0, 3) as IdType;
  let time = 0;
  for (let i = 0; i < TIME_CHARS; i += 1) {
    time = time * 32 + CROCKFORD.indexOf(id[4 + i]!);
  }
  return { type, time };
}

/** Сортировка по времени создания — сравнение ID эквивалентно сравнению времени. */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
