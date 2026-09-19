import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/**
 * 密码哈希（node:crypto scrypt，无第三方依赖）
 * 存储格式：s2:<salt-hex>:<hash-hex>
 */
const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEY_LEN).toString('hex');
  return `s2:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split(':');
  if (scheme !== 's2' || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, KEY_LEN);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/** 密码强度：8-64 位 */
export function validatePasswordStrength(password: string): string | null {
  if (typeof password !== 'string' || password.length < 8 || password.length > 64) {
    return '密码长度需在 8-64 位之间';
  }
  return null;
}
