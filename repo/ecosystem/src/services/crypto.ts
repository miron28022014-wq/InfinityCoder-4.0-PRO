/**
 * Шифрование секретов провайдеров (API-ключи).
 * Ключи шифруются AES-256-GCM мастер-ключом и никогда не попадают в логи
 * или в ответы API — наружу отдаётся только маска.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const ALGO = 'aes-256-gcm';

export class SecretStore {
  private readonly key: Buffer;

  constructor(masterKey: string) {
    if (!masterKey || masterKey.length < 16) {
      throw new Error('INFINITY_MASTER_KEY должен быть не короче 16 символов');
    }
    this.key = createHash('sha256').update(masterKey).digest();
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
  }

  decrypt(payload: string): string {
    const parts = payload.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') {
      throw new Error('Некорректный формат зашифрованного секрета');
    }
    const iv = Buffer.from(parts[1]!, 'base64url');
    const tag = Buffer.from(parts[2]!, 'base64url');
    const data = Buffer.from(parts[3]!, 'base64url');
    const decipher = createDecipheriv(ALGO, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }

  /** Маска для UI: видно только начало и конец. */
  static mask(plaintext: string): string {
    if (plaintext.length <= 8) return '••••';
    return `${plaintext.slice(0, 3)}••••${plaintext.slice(-2)}`;
  }
}

/** Сравнение хэшей без утечки по времени. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
