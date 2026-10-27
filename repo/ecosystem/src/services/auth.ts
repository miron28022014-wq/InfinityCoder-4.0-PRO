/**
 * Infinity ID: аутентификация и проверка доступа.
 * Токены — случайные, хранятся только в виде хэша.
 */

import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import type { Db } from '../db/db.js';
import { newId } from '../ids.js';
import { ConflictError, UnauthorizedError, ValidationError } from '../errors.js';

export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  password_salt: string;
  created_at: string;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

export function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex');
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashPassword(password, salt), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface AuthServiceOptions {
  db: Db;
}

export class AuthService {
  private readonly db: Db;

  constructor(options: AuthServiceOptions) {
    this.db = options.db;
  }

  register(email: string, password: string, displayName: string): User {
    const normalized = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
      throw new ValidationError('Некорректный email');
    }
    if (password.length < 8) {
      throw new ValidationError('Пароль должен быть не короче 8 символов');
    }
    const existing = this.db.get('SELECT id FROM users WHERE email = ?', normalized);
    if (existing) throw new ConflictError('Пользователь с таким email уже существует');

    const salt = randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    const id = newId('usr');
    this.db.run(
      `INSERT INTO users (id, email, display_name, password_hash, password_salt, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      normalized,
      displayName.trim() || normalized.split('@')[0]!,
      hashPassword(password, salt),
      salt,
      now,
      now,
    );
    return { id, email: normalized, displayName: displayName.trim() || normalized, createdAt: now };
  }

  login(email: string, password: string): User {
    const row = this.db.get<UserRow>('SELECT * FROM users WHERE email = ?', email.trim().toLowerCase());
    // Сравниваем всегда, чтобы не выдавать разницу по времени ответа.
    const salt = row?.password_salt ?? 'unknown-salt';
    const hash = row?.password_hash ?? '';
    if (!row || !verifyPassword(password, salt, hash)) {
      throw new UnauthorizedError('Неверный email или пароль');
    }
    return toUser(row);
  }

  createApiKey(userId: string, label: string, scopes: string[] = []): { id: string; key: string } {
    const key = `infk_${randomBytes(24).toString('base64url')}`;
    const id = newId('ses');
    this.db.run(
      `INSERT INTO api_keys (id, user_id, key_hash, label, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      userId,
      hashToken(key),
      label,
      JSON.stringify(scopes),
      new Date().toISOString(),
    );
    return { id, key };
  }

  /** Возвращает пользователя по токену или null. Отозванные ключи не работают. */
  resolveToken(token: string): User | null {
    const row = this.db.get<UserRow & { key_hash: string }>(
      `SELECT u.* FROM api_keys k
       JOIN users u ON u.id = k.user_id
       WHERE k.key_hash = ? AND k.revoked_at IS NULL`,
      hashToken(token),
    );
    return row ? toUser(row) : null;
  }

  revokeApiKey(userId: string, keyId: string): void {
    const res = this.db.run(
      'UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
      new Date().toISOString(),
      keyId,
      userId,
    );
    if (res.changes === 0) throw new UnauthorizedError('Ключ не найден или уже отозван');
  }

  getUser(userId: string): User | null {
    const row = this.db.get<UserRow>('SELECT * FROM users WHERE id = ?', userId);
    return row ? toUser(row) : null;
  }
}
