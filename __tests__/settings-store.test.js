/**
 * @jest-environment node
 */
const { encryptKey, decryptKey } = require('../src/services/settings-store');

describe('settings-store encryption', () => {
  const originalEnv = process.env.ENCRYPTION_KEY;

  afterEach(() => {
    process.env.ENCRYPTION_KEY = originalEnv;
  });

  test('encryptKey returns empty for empty input', () => {
    expect(encryptKey('')).toBe('');
    expect(encryptKey(null)).toBe('');
  });

  test('without ENCRYPTION_KEY: falls back to base64 (backward compatible)', () => {
    delete process.env.ENCRYPTION_KEY;
    const encrypted = encryptKey('my-api-key');
    expect(encrypted).toMatch(/^enc:/);
    const decrypted = decryptKey(encrypted);
    expect(decrypted).toBe('my-api-key');
  });

  test('with ENCRYPTION_KEY: uses AES-256-GCM', () => {
    process.env.ENCRYPTION_KEY = 'a-very-strong-32-char-secret-key';
    const encrypted = encryptKey('my-secret-api-key');
    expect(encrypted).toMatch(/^aes:/);
    const decrypted = decryptKey(encrypted);
    expect(decrypted).toBe('my-secret-api-key');
  });

  test('AES encryption produces different ciphertext each time (IV randomness)', () => {
    process.env.ENCRYPTION_KEY = 'a-very-strong-32-char-secret-key';
    const e1 = encryptKey('same-text');
    const e2 = encryptKey('same-text');
    expect(e1).not.toBe(e2);
    expect(decryptKey(e1)).toBe('same-text');
    expect(decryptKey(e2)).toBe('same-text');
  });

  test('decryptKey handles plaintext fallback', () => {
    expect(decryptKey('plaintext-key')).toBe('plaintext-key');
  });

  test('encryptKey idempotent: encrypted input returns as-is', () => {
    process.env.ENCRYPTION_KEY = 'a-very-strong-32-char-secret-key';
    const encrypted = encryptKey('test');
    expect(encryptKey(encrypted)).toBe(encrypted);
  });
});
