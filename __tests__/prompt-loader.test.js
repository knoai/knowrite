const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadPrompt, renderTemplate, loadPromptRaw, listPrompts, savePrompt, getLangPromptsDir } = require('../src/services/prompt-loader');

jest.mock('../src/services/settings-store', () => ({
  getSettings: jest.fn(),
}));

describe('prompt-loader', () => {
  const testDir = path.join(os.tmpdir(), 'knowrite-prompts-test-' + Date.now());

  beforeAll(async () => {
    // Override prompts directory via module internals is hard;
    // instead we test renderTemplate directly and use actual prompts dir for loadPrompt
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'test.md'), 'Hello {{name}}!', 'utf-8');
    fs.writeFileSync(path.join(testDir, 'include-base.md'), 'Base content', 'utf-8');
    fs.writeFileSync(path.join(testDir, 'include-main.md'), '{{include:include-base}}', 'utf-8');
  });

  afterAll(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe('renderTemplate', () => {
    test('replaces simple variables', async () => {
      const result = await renderTemplate('Hello {{name}}!', { name: 'World' });
      expect(result).toBe('Hello World!');
    });

    test('replaces multiple variables', async () => {
      const result = await renderTemplate('{{greeting}} {{name}}!', { greeting: 'Hi', name: 'Kimi' });
      expect(result).toBe('Hi Kimi!');
    });

    test('leaves unknown variables unreplaced', async () => {
      const result = await renderTemplate('Hello {{name}}!', {});
      expect(result).toBe('Hello {{name}}!');
    });

    test('handles null/undefined variable values', async () => {
      const result = await renderTemplate('Value: {{v}}', { v: null });
      expect(result).toBe('Value: ');
    });

    test('includes other templates', async () => {
      const result = await renderTemplate('Start {{include:writer}} End', {});
      expect(result.startsWith('Start')).toBe(true);
      expect(result.endsWith('End')).toBe(true);
      expect(result.length).toBeGreaterThan(10);
    });
  });

  describe('loadPromptRaw', () => {
    test('loads actual prompt file', async () => {
      const content = await loadPromptRaw('writer');
      expect(typeof content).toBe('string');
      expect(content.length).toBeGreaterThan(0);
    });

    test('throws for non-existent prompt', async () => {
      await expect(loadPromptRaw('definitely-not-exists-xyz')).rejects.toThrow('Prompt template not found');
    });

    test('returns settings.skill when loading core-rules and settings has skill', async () => {
      const { getSettings } = require('../src/services/settings-store');
      getSettings.mockResolvedValueOnce({ skill: 'custom-skill-content' });
      const promptCfg = require('../config/prompts.json');
      const result = await loadPromptRaw(promptCfg.coreRulesName);
      expect(result).toBe('custom-skill-content');
    });

    test('falls back to root when lang prompt not found', async () => {
      const result = await loadPromptRaw('writer', 'xx-nonexistent');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    test('handles settings error gracefully', async () => {
      const { getSettings } = require('../src/services/settings-store');
      getSettings.mockRejectedValueOnce(new Error('db error'));
      const promptCfg = require('../config/prompts.json');
      const result = await loadPromptRaw(promptCfg.coreRulesName);
      expect(typeof result).toBe('string');
    });
  });

  describe('getLangPromptsDir', () => {
    const realPromptsDir = path.join(process.cwd(), 'prompts');
    const enDir = path.join(realPromptsDir, 'en');

    beforeAll(() => {
      fs.mkdirSync(enDir, { recursive: true });
    });

    afterAll(() => {
      try { fs.rmdirSync(enDir); } catch { /* ignore */ }
    });

    test('returns lang subdirectory when it exists', () => {
      const result = getLangPromptsDir('en');
      expect(result).toContain('en');
    });

    test('falls back to root when lang dir does not exist', () => {
      const result = getLangPromptsDir('xx-nonexistent');
      expect(result).not.toContain('xx-nonexistent');
    });
  });

  describe('loadPrompt', () => {
    test('loads and renders prompt with variables', async () => {
      const content = await loadPrompt('writer', { nextNumber: 1, style: 'test' });
      expect(typeof content).toBe('string');
      expect(content.length).toBeGreaterThan(0);
    });
  });

  describe('listPrompts', () => {
    test('returns array of prompt names', async () => {
      const prompts = await listPrompts();
      expect(Array.isArray(prompts)).toBe(true);
      expect(prompts.length).toBeGreaterThan(0);
      expect(prompts).toContain('writer');
      expect(prompts).toContain('editor');
    });
  });

  describe('savePrompt', () => {
    test('saves prompt to file', async () => {
      const testName = `test-save-${Date.now()}`;
      await savePrompt(testName, 'saved content');
      const content = await loadPromptRaw(testName);
      expect(content).toBe('saved content');
    });
  });
});
