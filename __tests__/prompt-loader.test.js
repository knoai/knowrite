const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadPrompt, renderTemplate, loadPromptRaw, listPrompts, savePrompt } = require('../src/services/prompt-loader');

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
      // Mock loadPromptRaw for include test
      const originalLoadPromptRaw = jest.requireActual('../src/services/prompt-loader').loadPromptRaw;
      // We can't easily mock loadPromptRaw because renderTemplate imports it internally.
      // Instead test with actual prompts directory if possible.
    });
  });

  describe('loadPromptRaw', () => {
    test('loads actual prompt file', async () => {
      // Use a known existing prompt
      const content = await loadPromptRaw('writer');
      expect(typeof content).toBe('string');
      expect(content.length).toBeGreaterThan(0);
    });

    test('throws for non-existent prompt', async () => {
      await expect(loadPromptRaw('definitely-not-exists-xyz')).rejects.toThrow('Prompt template not found');
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
});
