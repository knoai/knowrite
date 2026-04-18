const fs = require('fs');
const path = require('path');
const promptEvolver = require('../src/services/prompt-evolver');

jest.mock('../src/core/chat', () => ({
  runStreamChat: jest.fn().mockResolvedValue({
    content: 'mock response',
    chars: 100,
    durationMs: 500,
    chunks: 1,
  }),
}));

jest.mock('../src/services/prompt-loader', () => ({
  loadPromptRaw: jest.fn().mockResolvedValue('Base prompt template with {{name}}'),
}));

jest.mock('../src/services/settings-store', () => ({
  resolveRoleModelConfig: jest.fn().mockResolvedValue({ provider: 'mock', model: 'mock' }),
}));

describe('prompt-evolver', () => {
  const evoDir = path.join(__dirname, '../evolution');

  beforeEach(() => {
    jest.clearAllMocks();
    // Clean up evolution dir files
    try {
      for (const f of fs.readdirSync(evoDir)) {
        if (f.startsWith('writer_')) fs.rmSync(path.join(evoDir, f));
      }
    } catch {}
  });

  afterAll(() => {
    try {
      for (const f of fs.readdirSync(evoDir)) {
        if (f.startsWith('writer_')) fs.rmSync(path.join(evoDir, f));
      }
    } catch {}
  });

  describe('analyzeFailures', () => {
    test('parses JSON diagnosis from LLM response', async () => {
      const { runStreamChat } = require('../src/core/chat');
      runStreamChat.mockResolvedValue({
        content: JSON.stringify({
          diagnosis: 'Weak hooks',
          directions: ['Add stronger hooks', 'Reduce filler'],
        }),
        chars: 100,
        durationMs: 500,
      });

      const samples = [
        { fitness: 0.3, breakdown: { wordScore: 0.5 }, trace: { inputPreview: 'test', outputPreview: 'test' } },
      ];
      const result = await promptEvolver.analyzeFailures('writer', samples, 'mock-model', {});
      expect(result.diagnosis).toBe('Weak hooks');
      expect(result.directions.length).toBe(2);
    });

    test('falls back to default diagnosis on parse failure', async () => {
      const { runStreamChat } = require('../src/core/chat');
      runStreamChat.mockResolvedValue({
        content: 'invalid json without braces',
        chars: 50,
        durationMs: 200,
      });

      const samples = [];
      const result = await promptEvolver.analyzeFailures('writer', samples, 'mock-model', {});
      expect(result.diagnosis).toBe('未能自动诊断，可能样本不足');
      expect(result.directions.length).toBeGreaterThan(0);
    });
  });

  describe('generateVariants', () => {
    test('extracts variants from <!-- variant:N --> markers', async () => {
      const { runStreamChat } = require('../src/core/chat');
      runStreamChat.mockResolvedValue({
        content: '<!-- variant:1 -->\nVariant A text\n<!-- variant:2 -->\nVariant B text',
        chars: 200,
        durationMs: 500,
      });

      const diagnosis = { diagnosis: 'test', directions: ['fix1'] };
      const variants = await promptEvolver.generateVariants('writer', diagnosis, 2, 'mock-model', {});
      expect(variants.length).toBe(2);
      expect(variants[0]).toContain('Variant A');
    });

    test('falls back to split by dashes when no markers', async () => {
      const { runStreamChat } = require('../src/core/chat');
      runStreamChat.mockResolvedValue({
        content: 'Part one\n---\nPart two which is long enough to be a variant',
        chars: 200,
        durationMs: 500,
      });

      const diagnosis = { diagnosis: 'test', directions: ['fix1'] };
      const variants = await promptEvolver.generateVariants('writer', diagnosis, 2, 'mock-model', {});
      expect(variants.length).toBeGreaterThan(0);
    });

    test('returns base template if LLM returns nothing useful', async () => {
      const { runStreamChat } = require('../src/core/chat');
      runStreamChat.mockResolvedValue({
        content: 'short',
        chars: 10,
        durationMs: 100,
      });

      const diagnosis = { diagnosis: 'test', directions: ['fix1'] };
      const variants = await promptEvolver.generateVariants('writer', diagnosis, 2, 'mock-model', {});
      expect(variants.length).toBe(1);
    });
  });

  describe('evaluateVariant', () => {
    test('returns average score from evaluations', async () => {
      const { runStreamChat } = require('../src/core/chat');
      runStreamChat.mockResolvedValue({
        content: JSON.stringify({
          evaluations: [
            { predictedFitness: 0.7, reasoning: 'good' },
            { predictedFitness: 0.8, reasoning: 'better' },
          ],
          summary: { avgPredictedFitness: 0.75 },
        }),
        chars: 200,
        durationMs: 500,
      });

      const dataset = [
        { fitness: 0.6, trace: { inputPreview: 'in1', outputPreview: 'out1' } },
        { fitness: 0.7, trace: { inputPreview: 'in2', outputPreview: 'out2' } },
      ];
      const result = await promptEvolver.evaluateVariant('template', dataset, 'mock-model', {});
      expect(result.avgFitness).toBeGreaterThan(0);
      expect(result.details.length).toBe(2);
    });

    test('falls back to 0.5 on parse failure', async () => {
      const { runStreamChat } = require('../src/core/chat');
      runStreamChat.mockResolvedValue({
        content: 'invalid',
        chars: 10,
        durationMs: 100,
      });

      const dataset = [];
      const result = await promptEvolver.evaluateVariant('template', dataset, 'mock-model', {});
      expect(result.avgFitness).toBe(0);
    });
  });

  describe('evolvePrompt', () => {
    test('returns failure when work has no fitness data', async () => {
      const result = await promptEvolver.evolvePrompt('writer', ['nonexistent-work-xyz']);
      expect(result.success).toBe(false);
      expect(result.reason).toContain('低分样本不足');
    });
  });

  describe('applyCandidate', () => {
    test('applies candidate and creates backup', async () => {
      const promptsDir = path.join(__dirname, '../prompts');
      const evoDir = path.join(__dirname, '../evolution');
      fs.mkdirSync(promptsDir, { recursive: true });
      fs.mkdirSync(evoDir, { recursive: true });

      fs.writeFileSync(path.join(promptsDir, 'writer.md'), 'original writer prompt', 'utf-8');
      fs.writeFileSync(path.join(evoDir, 'writer_candidate_test.md'), 'improved writer prompt', 'utf-8');

      const result = await promptEvolver.applyCandidate('writer', path.join(evoDir, 'writer_candidate_test.md'));

      expect(fs.readFileSync(result.originalPath, 'utf-8')).toBe('improved writer prompt');
      expect(fs.existsSync(result.backupPath)).toBe(true);

      // cleanup
      fs.writeFileSync(path.join(promptsDir, 'writer.md'), 'original writer prompt', 'utf-8');
      fs.rmSync(path.join(evoDir, 'writer_candidate_test.md'), { force: true });
    });

    test('throws when candidate file missing', async () => {
      await expect(promptEvolver.applyCandidate('writer', '/nonexistent/path.md')).rejects.toThrow('Candidate file not found');
    });
  });

  describe('gatherEvalDataset', () => {
    const workDir = path.join(__dirname, '../works', 'rag-eval-test');

    afterEach(() => {
      try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
    });

    test('returns empty when work dir missing', async () => {
      const ds = await promptEvolver.gatherEvalDataset('nonexistent-work-xyz', 'writer');
      expect(ds).toEqual([]);
    });

    test('gathers fitness and trace data', async () => {
      fs.mkdirSync(path.join(workDir, 'traces'), { recursive: true });
      fs.writeFileSync(
        path.join(workDir, 'chapter_1_fitness.json'),
        JSON.stringify({ score: 0.3, breakdown: { wordScore: 0.4 } }),
        'utf-8'
      );
      fs.writeFileSync(
        path.join(workDir, 'traces', 'writer.jsonl'),
        JSON.stringify({ inputPreview: 'in', outputPreview: 'out' }) + '\n',
        'utf-8'
      );

      const ds = await promptEvolver.gatherEvalDataset('rag-eval-test', 'writer');
      expect(ds.length).toBe(1);
      expect(ds[0].fitness).toBe(0.3);
      expect(ds[0].chapterNumber).toBe(1);
    });

    test('skips malformed fitness files', async () => {
      fs.mkdirSync(workDir, { recursive: true });
      fs.writeFileSync(path.join(workDir, 'chapter_1_fitness.json'), 'not-json', 'utf-8');

      const ds = await promptEvolver.gatherEvalDataset('rag-eval-test', 'writer');
      expect(ds).toEqual([]);
    });
  });
});
