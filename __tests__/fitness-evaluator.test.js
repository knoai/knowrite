/**
 * fitness-evaluator 测试
 */
const fs = require('fs');
const path = require('path');
const { getWorkDir } = require('../src/core/paths');
const {
  evaluateChapterFitness,
  saveFitness,
  loadFitness,
} = require('../src/services/fitness-evaluator');

jest.mock('../src/services/settings-store', () => ({
  getChapterConfig: jest.fn().mockResolvedValue({ targetWords: 2000 }),
  getWritingMode: jest.fn().mockResolvedValue('industrial'),
  resolveRoleModelConfig: jest.fn().mockResolvedValue({ model: 'gpt-4' }),
}));

jest.mock('../src/services/novel-engine', () => ({
  detectOutlineDeviation: jest.fn().mockResolvedValue({ severity: 'low' }),
}));

jest.mock('../src/services/file-store', () => ({
  readFile: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
}));

const fileStore = require('../src/services/file-store');

describe('fitness-evaluator', () => {
  const workId = 'fit-test-1';
  let workDir;

  beforeAll(() => {
    workDir = getWorkDir(workId);
    fs.mkdirSync(workDir, { recursive: true });
  });

  afterAll(() => {
    // cleanup
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {}
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // clear any leftover files in work dir
    try {
      for (const f of fs.readdirSync(workDir)) {
        fs.rmSync(path.join(workDir, f), { recursive: true, force: true });
      }
    } catch {}
  });

  describe('evaluateChapterFitness', () => {
    it('should compute basic fitness with no external data', async () => {
      fileStore.readFile.mockResolvedValue(null);

      const result = await evaluateChapterFitness(workId, 1, 2000);

      expect(result.score).toBeGreaterThan(0);
      expect(result.score).toBeLessThanOrEqual(1);
      expect(result.breakdown.wordScore).toBeCloseTo(1, 2);
      expect(result.breakdown.repScore).toBe(1);
      expect(result.breakdown.reviewScore).toBe(0.5);
      expect(result.breakdown.readerScore).toBe(0.5);
      expect(result.sources.repetition).toBe(false);
      expect(result.sources.review).toBe(false);
      expect(result.sources.reader).toBe(false);
    });

    it('should penalize low word count', async () => {
      fileStore.readFile.mockResolvedValue(null);

      const low = await evaluateChapterFitness(workId, 1, 500);
      const high = await evaluateChapterFitness(workId, 2, 2000);

      expect(low.breakdown.wordScore).toBeLessThan(high.breakdown.wordScore);
    });

    it('should factor in repetition result', async () => {
      fileStore.readFile.mockImplementation((wid, fname) => {
        if (fname === 'chapter_1_repetition.json') {
          return JSON.stringify({ repetitive: true, severity: 'high' });
        }
        return null;
      });

      const result = await evaluateChapterFitness(workId, 1, 2000);

      expect(result.breakdown.repScore).toBe(0);
      expect(result.sources.repetition).toBe(true);
    });

    it('should factor in review result (passed)', async () => {
      // Create review dir with a passed round file
      const reviewDir = path.join(workDir, 'review_chapter_1');
      fs.mkdirSync(reviewDir, { recursive: true });
      fs.writeFileSync(
        path.join(reviewDir, 'round_1.json'),
        JSON.stringify({ passed: true, reviews: [{ parsed: { scores: { style: { score: 8 } } } }] }),
        'utf-8'
      );
      fileStore.readFile.mockResolvedValue(null);

      const result = await evaluateChapterFitness(workId, 1, 2000);

      expect(result.sources.review).toBe(true);
      expect(result.breakdown.reviewScore).toBeGreaterThan(0.5);
    });

    it('should factor in review result (failed)', async () => {
      const reviewDir = path.join(workDir, 'review_chapter_2');
      fs.mkdirSync(reviewDir, { recursive: true });
      fs.writeFileSync(
        path.join(reviewDir, 'round_1.json'),
        JSON.stringify({ passed: false, reviews: [] }),
        'utf-8'
      );
      fileStore.readFile.mockResolvedValue(null);

      const result = await evaluateChapterFitness(workId, 2, 2000);

      expect(result.breakdown.reviewScore).toBe(0.3);
    });

    it('should factor in reader feedback', async () => {
      fileStore.readFile.mockImplementation((wid, fname) => {
        if (fname === 'chapter_1_feedback.json') {
          return JSON.stringify({
            readability: { score: 8 },
            anticipation: { score: 9 },
            pain_points: '无',
          });
        }
        return null;
      });

      const result = await evaluateChapterFitness(workId, 1, 2000);

      expect(result.sources.reader).toBe(true);
      expect(result.breakdown.readerScore).toBeCloseTo(0.85, 2);
    });

    it('should apply pain penalty in reader feedback', async () => {
      fileStore.readFile.mockImplementation((wid, fname) => {
        if (fname === 'chapter_1_feedback.json') {
          return JSON.stringify({
            readability: { score: 5 },
            anticipation: { score: 5 },
            pain_points: '节奏拖沓',
          });
        }
        return null;
      });

      const result = await evaluateChapterFitness(workId, 1, 2000);
      expect(result.breakdown.readerScore).toBeLessThan(0.5);
    });

    it('should use free mode weights when writing mode is free', async () => {
      const { getWritingMode } = require('../src/services/settings-store');
      getWritingMode.mockResolvedValue('free');
      fileStore.readFile.mockResolvedValue(null);

      const result = await evaluateChapterFitness(workId, 1, 2000);
      // free mode has lower wordCount weight (0.05 vs 0.15)
      // word score at target is ~1, so lower weight should give slightly different score
      expect(result.score).toBeGreaterThan(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });

    it('should fallback on coherence detection error', async () => {
      const { detectOutlineDeviation } = require('../src/services/novel-engine');
      detectOutlineDeviation.mockRejectedValue(new Error('LLM timeout'));
      fileStore.readFile.mockImplementation((wid, fname) => {
        if (fname === 'chapter_1_final.txt') return 'chapter content';
        return null;
      });

      const result = await evaluateChapterFitness(workId, 1, 2000);
      expect(result.score).toBeGreaterThan(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });

    it('should run coherence detection when chapter text exists', async () => {
      const { detectOutlineDeviation } = require('../src/services/novel-engine');
      detectOutlineDeviation.mockResolvedValue({ severity: 'medium' });
      fileStore.readFile.mockImplementation((wid, fname) => {
        if (fname === 'chapter_1_final.txt') return 'chapter content';
        return null;
      });

      const result = await evaluateChapterFitness(workId, 1, 2000);
      expect(result.breakdown.coherenceScore).toBe(0.6);
    });

    it('should handle malformed repetition JSON gracefully', async () => {
      fileStore.readFile.mockImplementation((wid, fname) => {
        if (fname === 'chapter_1_repetition.json') return 'invalid json';
        return null;
      });

      const result = await evaluateChapterFitness(workId, 1, 2000);
      expect(result.breakdown.repScore).toBe(1);
      expect(result.sources.repetition).toBe(false);
    });

    it('should handle malformed reader feedback JSON gracefully', async () => {
      fileStore.readFile.mockImplementation((wid, fname) => {
        if (fname === 'chapter_1_feedback.json') return 'not-json';
        return null;
      });

      const result = await evaluateChapterFitness(workId, 1, 2000);
      expect(result.breakdown.readerScore).toBe(0.5);
      expect(result.sources.reader).toBe(false);
    });

    it('should handle malformed review JSON gracefully', async () => {
      const reviewDir = path.join(workDir, 'review_chapter_3');
      fs.mkdirSync(reviewDir, { recursive: true });
      fs.writeFileSync(path.join(reviewDir, 'round_1.json'), 'invalid json', 'utf-8');
      fileStore.readFile.mockResolvedValue(null);

      const result = await evaluateChapterFitness(workId, 3, 2000);
      expect(result.breakdown.reviewScore).toBe(0.5);
      expect(result.sources.review).toBe(false);
    });
  });

  describe('saveFitness / loadFitness', () => {
    it('should save and load fitness round-trip', async () => {
      const fitness = {
        score: 0.85,
        breakdown: { wordScore: 0.9, repScore: 1, reviewScore: 0.8, readerScore: 0.7, coherenceScore: 0.9 },
        sources: { repetition: false, review: true, reader: false },
      };

      await saveFitness(workId, 3, fitness);

      expect(fileStore.writeFile).toHaveBeenCalledWith(
        workId,
        'chapter_3_fitness.json',
        expect.stringContaining('0.85')
      );

      const localPath = path.join(workDir, 'chapter_3_fitness.json');
      expect(fs.existsSync(localPath)).toBe(true);
      const saved = JSON.parse(fs.readFileSync(localPath, 'utf-8'));
      expect(saved.score).toBe(0.85);
      expect(saved.evaluatedAt).toBeTruthy();
    });

    it('should load previously saved fitness', async () => {
      const data = { score: 0.75, evaluatedAt: new Date().toISOString() };
      fileStore.readFile.mockResolvedValue(JSON.stringify(data));

      const loaded = await loadFitness(workId, 4);
      expect(loaded.score).toBe(0.75);
    });

    it('should return null if fitness file missing', async () => {
      fileStore.readFile.mockResolvedValue(null);
      const loaded = await loadFitness(workId, 99);
      expect(loaded).toBeNull();
    });

    it('should return null on parse error', async () => {
      fileStore.readFile.mockResolvedValue('not-json{{');
      const loaded = await loadFitness(workId, 5);
      expect(loaded).toBeNull();
    });
  });
});
