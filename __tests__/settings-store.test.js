/**
 * settings-store 测试
 */
const fs = require('fs');
const path = require('path');
const {
  encryptKey,
  decryptKey,
  getSettings,
  saveSettings,
  getAuthorStyles,
  saveAuthorStyles,
  getPlatformStyles,
  savePlatformStyles,
  getReviewDimensions,
  saveReviewDimensions,
  getReviewPreset,
  setReviewPreset,
  getAuthorStyle,
  getPlatformStyle,
  buildReviewDimensionsText,
  getModelConfig,
  saveModelConfig,
  getRoleModelConfig,
  resolveRoleModelConfig,
  resolveWriterModel,
  getChapterConfig,
  saveChapterConfig,
  getWritingMode,
  saveWritingMode,
} = require('../src/services/settings-store');
const { Setting, Work } = require('../src/models');

describe('settings-store', () => {
  const origEnv = process.env.ENCRYPTION_KEY;

  beforeEach(async () => {
    const { initDb, sequelize } = require('../src/models');
    await initDb();
    await sequelize.query('DELETE FROM settings');
    delete process.env.ENCRYPTION_KEY;
  });

  afterAll(() => {
    process.env.ENCRYPTION_KEY = origEnv;
  });

  // ==================== 加密解密 ====================
  describe('encryptKey / decryptKey', () => {
    it('should round-trip encrypt and decrypt with AES', () => {
      process.env.ENCRYPTION_KEY = 'a'.repeat(32);
      const original = 'my-secret-api-key-12345';
      const encrypted = encryptKey(original);
      expect(encrypted.startsWith('aes:')).toBe(true);
      const decrypted = decryptKey(encrypted);
      expect(decrypted).toBe(original);
    });

    it('should not double-encrypt', () => {
      process.env.ENCRYPTION_KEY = 'a'.repeat(32);
      const original = 'my-secret-api-key-12345';
      const encrypted = encryptKey(original);
      const encrypted2 = encryptKey(encrypted);
      expect(encrypted2).toBe(encrypted);
    });

    it('should fallback to base64 when no ENCRYPTION_KEY', () => {
      delete process.env.ENCRYPTION_KEY;
      const original = 'test-key';
      const encrypted = encryptKey(original);
      expect(encrypted.startsWith('enc:')).toBe(true);
      const decrypted = decryptKey(encrypted);
      expect(decrypted).toBe(original);
    });

    it('should handle empty/null keys', () => {
      expect(encryptKey('')).toBe('');
      expect(encryptKey(null)).toBe('');
      expect(decryptKey('')).toBe('');
      expect(decryptKey(null)).toBe('');
    });

    it('should return plaintext for non-encrypted input', () => {
      expect(decryptKey('plain-text')).toBe('plain-text');
    });

    it('should derive key from short ENCRYPTION_KEY', () => {
      process.env.ENCRYPTION_KEY = 'short';
      const original = 'secret';
      const encrypted = encryptKey(original);
      const decrypted = decryptKey(encrypted);
      expect(decrypted).toBe(original);
    });
  });

  // ==================== Settings CRUD ====================
  describe('getSettings / saveSettings', () => {
    it('should return defaults when no settings exist', async () => {
      const settings = await getSettings();
      expect(settings).toBeDefined();
      expect(settings.reviewPreset).toBeDefined();
      expect(settings.reviewDimensions).toBeDefined();
      expect(settings.skill).toBeDefined();
    });

    it('should save and retrieve settings', async () => {
      await saveSettings({ skill: 'expert', reviewPreset: '33' });
      const settings = await getSettings();
      expect(settings.skill).toBe('expert');
      expect(settings.reviewPreset).toBe('33');
    });

    it('should persist to database', async () => {
      await saveSettings({ skill: 'pro', reviewPreset: '15' });
      const row = await Setting.findByPk('user-settings');
      expect(row).toBeTruthy();
      const parsed = JSON.parse(row.value);
      expect(parsed.skill).toBe('pro');
    });
  });

  describe('getAuthorStyles / saveAuthorStyles', () => {
    it('should save and retrieve author styles', async () => {
      await saveAuthorStyles([{ name: 'Style A', description: 'Desc A' }]);
      const styles = await getAuthorStyles();
      expect(styles).toHaveLength(1);
      expect(styles[0].name).toBe('Style A');
    });
  });

  describe('getPlatformStyles / savePlatformStyles', () => {
    it('should save and retrieve platform styles', async () => {
      await savePlatformStyles([{ name: 'Web', description: 'Web style' }]);
      const styles = await getPlatformStyles();
      expect(styles).toHaveLength(1);
    });
  });

  describe('getReviewDimensions / saveReviewDimensions', () => {
    it('should save and retrieve review dimensions', async () => {
      await saveReviewDimensions([{ name: 'Style', description: 'Style check' }]);
      const dims = await getReviewDimensions();
      expect(dims).toHaveLength(1);
      expect(dims[0].name).toBe('Style');
    });
  });

  describe('getReviewPreset / setReviewPreset', () => {
    it('should set and get review preset', async () => {
      await setReviewPreset('8');
      const preset = await getReviewPreset();
      expect(preset).toBe('8');
    });

    it('should throw on invalid preset', async () => {
      await expect(setReviewPreset('99')).rejects.toThrow('不支持的评审预设');
    });
  });

  describe('getAuthorStyle / getPlatformStyle', () => {
    it('should find author style by name', async () => {
      await saveAuthorStyles([{ name: 'Classic', description: 'Classic style' }]);
      const desc = await getAuthorStyle('Classic');
      expect(desc).toBe('Classic style');
    });

    it('should return empty for missing style', async () => {
      const desc = await getAuthorStyle('Missing');
      expect(desc).toBe('');
    });

    it('should find platform style by name', async () => {
      await savePlatformStyles([{ name: 'Web', description: 'Web style' }]);
      const desc = await getPlatformStyle('Web');
      expect(desc).toBe('Web style');
    });
  });

  describe('buildReviewDimensionsText', () => {
    it('should build formatted text', async () => {
      await saveReviewDimensions([{ name: 'Style', description: 'Check {{style}}' }]);
      const text = await buildReviewDimensionsText('platform');
      expect(text).toContain('Style');
      expect(text).toContain('Check platform');
    });

    it('should fill default dimensions when user clears them', async () => {
      await saveSettings({ reviewDimensions: [], reviewPreset: '33' });
      const text = await buildReviewDimensionsText();
      // applyPreset auto-fills defaults, so text is not empty
      expect(text.length).toBeGreaterThan(0);
    });
  });

  // ==================== Model Config ====================
  describe('getModelConfig / saveModelConfig', () => {
    it('should encrypt apiKey on save and decrypt on get', async () => {
      process.env.ENCRYPTION_KEY = 'a'.repeat(32);
      await saveModelConfig({
        defaultProvider: 'openai',
        providers: { openai: { apiKey: 'sk-secret123', baseURL: 'https://api.openai.com' } },
      });

      const cfg = await getModelConfig();
      expect(cfg.providers.openai.apiKey).toBe('sk-secret123');
    });

    it('should return default config when none saved', async () => {
      const cfg = await getModelConfig();
      expect(cfg.defaultProvider).toBeDefined();
    });
  });

  describe('getRoleModelConfig', () => {
    it('should return default role config', async () => {
      const cfg = await getRoleModelConfig('writer');
      expect(cfg.provider).toBeDefined();
      expect(cfg.model).toBeDefined();
      expect(typeof cfg.temperature).toBe('number');
    });

    it('should use roleDefaults when available', async () => {
      await saveModelConfig({
        defaultProvider: 'openai',
        roleDefaults: {
          editor: { provider: 'custom', model: 'gpt-4', temperature: 0.5 },
        },
      });
      const cfg = await getRoleModelConfig('editor');
      expect(cfg.provider).toBe('custom');
      expect(cfg.model).toBe('gpt-4');
      expect(cfg.temperature).toBe(0.5);
    });
  });

  describe('resolveRoleModelConfig', () => {
    it('should return base config without override', async () => {
      const cfg = await resolveRoleModelConfig('writer');
      expect(cfg.model).toBeDefined();
    });

    it('should override model by string', async () => {
      const cfg = await resolveRoleModelConfig('writer', 'custom-model');
      expect(cfg.model).toBe('custom-model');
    });

    it('should override by object', async () => {
      const cfg = await resolveRoleModelConfig('writer', { model: 'm2', temperature: 0.3 });
      expect(cfg.model).toBe('m2');
      expect(cfg.temperature).toBe(0.3);
    });
  });

  describe('resolveWriterModel', () => {
    it('should use rotation when enabled', async () => {
      await saveModelConfig({
        defaultProvider: 'openai',
        writerRotation: {
          enabled: true,
          models: [
            { model: 'm1' },
            { model: 'm2' },
          ],
        },
      });
      const cfg1 = await resolveWriterModel(1);
      const cfg2 = await resolveWriterModel(2);
      expect(cfg1.model).toBe('m1');
      expect(cfg2.model).toBe('m2');
      const cfg3 = await resolveWriterModel(3);
      expect(cfg3.model).toBe('m1'); // cycles back
    });

    it('should fallback to role config when no rotation', async () => {
      await saveModelConfig({ defaultProvider: 'openai' });
      const cfg = await resolveWriterModel(1);
      expect(cfg.model).toBeDefined();
    });
  });

  // ==================== Chapter Config ====================
  describe('getChapterConfig / saveChapterConfig', () => {
    it('should save and retrieve chapter config', async () => {
      await saveChapterConfig({ targetWords: 3000 });
      const cfg = await getChapterConfig();
      expect(cfg.targetWords).toBe(3000);
    });

    it('should merge with existing config', async () => {
      await saveChapterConfig({ targetWords: 2500, minWords: 2200 });
      await saveChapterConfig({ maxWords: 2800 });
      const cfg = await getChapterConfig();
      expect(cfg.targetWords).toBe(2500);
      expect(cfg.minWords).toBe(2200);
      expect(cfg.maxWords).toBe(2800);
    });
  });

  // ==================== Writing Mode ====================
  describe('getWritingMode / saveWritingMode', () => {
    it('should save and retrieve writing mode', async () => {
      await saveWritingMode('free');
      const mode = await getWritingMode();
      expect(mode).toBe('free');
    });

    it('should normalize invalid mode to industrial', async () => {
      await saveWritingMode('invalid');
      const mode = await getWritingMode();
      expect(mode).toBe('industrial');
    });

    it('should prefer work-specific mode when workId given', async () => {
      await Work.create({ workId: 'w-mode', topic: 'Test', writingMode: 'free' });
      await saveWritingMode('industrial');

      const mode = await getWritingMode('w-mode');
      expect(mode).toBe('free');
    });

    it('should fallback to global mode when work has no mode', async () => {
      await Work.create({ workId: 'w-no-mode', topic: 'Test' });
      await saveWritingMode('industrial');

      const mode = await getWritingMode('w-no-mode');
      expect(mode).toBe('industrial');
    });
  });
});
