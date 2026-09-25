/**
 * §11.2 — token encryption (AES-256-GCM, 32-byte keys from TOKEN_ENC_KEY_<KID>, base64) and hashing.
 * Ciphertext stores (ciphertext‖tag, nonce, kid); rotation re-encrypts under TOKEN_ENC_ACTIVE_KID.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

function keyFor(kid: string): Buffer {
  const raw = process.env[`TOKEN_ENC_KEY_${kid}`];
  if (!raw) throw new Error(`TOKEN_ENC_KEY_${kid} is not set`);
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error(`TOKEN_ENC_KEY_${kid} must be 32 bytes (base64)`);
  return key;
}

export const canEncryptTokens = (): boolean => {
  const kid = process.env.TOKEN_ENC_ACTIVE_KID;
  return !!kid && !!process.env[`TOKEN_ENC_KEY_${kid}`];
};

export function encryptToken(plaintext: string): { ciphertext: Buffer; nonce: Buffer; kid: string } {
  const kid = process.env.TOKEN_ENC_ACTIVE_KID;
  if (!kid) throw new Error('TOKEN_ENC_ACTIVE_KID is not set');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(kid), nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return { ciphertext, nonce, kid };
}

export function decryptToken(ciphertext: Uint8Array, nonce: Uint8Array, kid: string): string {
  const buf = Buffer.from(ciphertext);
  const decipher = createDecipheriv('aes-256-gcm', keyFor(kid), Buffer.from(nonce));
  decipher.setAuthTag(buf.subarray(buf.length - 16));
  return Buffer.concat([decipher.update(buf.subarray(0, buf.length - 16)), decipher.final()]).toString('utf8');
}

export const sha256 = (s: string | Uint8Array): Buffer => createHash('sha256').update(s).digest();

export const safeEqual = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && timingSafeEqual(a, b);

/** Random opaque token (beacon tokens, referral codes, share ids). */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function nanoid(len = 10): string {
  const bytes = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i]! % ALPHABET.length];
  return s;
}
