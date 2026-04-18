/**
 * @jest-environment node
 */
const fs = require('fs');
const path = require('path');
const {
  encryptKey,
  decryptKey,
  getSettings,
  saveSettings,
  getModelConfig,
  getChapterConfig,
  getWritingMode,
  buildReviewDimensionsText,
} = require('../src/services/settings-store');
const { Setting, initDb } = require('../src/models');

const USER_SETTINGS_FILE = path.join(__dirname, '../config/user-settings.json');

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

describe('settings-store CRUD', () => {
  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await Setting.destroy({ where: {} });
    if (fs.existsSync(USER_SETTINGS_FILE)) {
      fs.unlinkSync(USER_SETTINGS_FILE);
    }
  });

  test('getSettings returns default settings when DB empty', async () => {
    const settings = await getSettings();
    expect(settings).toBeDefined();
    expect(typeof settings).toBe('object');
  });

  test('saveSettings persists and getSettings retrieves', async () => {
    const testSettings = {
      provider: 'openai',
      model: 'gpt-4',
      chapterConfig: { targetWords: 2500, minWords: 2000, maxWords: 3000 },
    };
    await saveSettings(testSettings);
    const retrieved = await getSettings();
    expect(retrieved.provider).toBe('openai');
    expect(retrieved.model).toBe('gpt-4');
    expect(retrieved.chapterConfig.targetWords).toBe(2500);
  });

  test('getModelConfig returns default when no settings', async () => {
    const config = await getModelConfig();
    expect(config).toBeDefined();
    expect(typeof config).toBe('object');
  });

  test('getChapterConfig returns defaults when empty', async () => {
    const cfg = await getChapterConfig();
    expect(cfg.targetWords).toBe(2000);
    expect(cfg.minWords).toBe(1800);
    expect(cfg.maxWords).toBe(2200);
  });

  test('getWritingMode returns industrial by default', async () => {
    const mode = await getWritingMode();
    expect(mode).toBe('industrial');
  });

  test('buildReviewDimensionsText returns dimensions text with defaults', async () => {
    const text = await buildReviewDimensionsText();
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('判断：[]');
  });

  test('buildReviewDimensionsText replaces style placeholder', async () => {
    const text = await buildReviewDimensionsText('热血玄幻');
    expect(text).toContain('热血玄幻');
  });
});
