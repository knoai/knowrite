const outputGovernance = require('../src/services/output-governance');
const { OutputQueue, OutputValidationRule, Chapter, Work, initDb } = require('../src/models');

jest.mock('../src/services/file-store', () => ({
  readFile: jest.fn().mockResolvedValue('第1章\n\n测试章节内容，字数足够多。'),
}));

jest.mock('../src/services/author-fingerprint', () => ({
  getActiveFingerprints: jest.fn().mockResolvedValue([]),
  validateAgainstFingerprint: jest.fn().mockResolvedValue({ passed: true, overallScore: 0.9 }),
}));

jest.mock('../src/services/truth-manager', () => ({
  getCurrentState: jest.fn().mockResolvedValue({ characterStates: [] }),
  detectAnomalies: jest.fn().mockResolvedValue([]),
}));

describe('output-governance', () => {
  const workId = 'test-work-output';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await OutputQueue.destroy({ where: { workId } });
    await OutputValidationRule.destroy({ where: {} });
    await Chapter.destroy({ where: { workId } });
    // 重置规则缓存
    outputGovernance.rulesCache = null;
    outputGovernance.rulesCacheTime = 0;
  });

  describe('enqueueChapter', () => {
    test('creates queue item with priority based on fitness', async () => {
      const item = await outputGovernance.enqueueChapter(workId, 1, { fitnessScore: 0.85 });
      expect(item.workId).toBe(workId);
      expect(item.chapterNumber).toBe(1);
      expect(item.priority).toBe(9); // Math.round(0.85 * 10)
      expect(item.status).toBe('pending');
    });

    test('defaults priority to 5 when no fitness score', async () => {
      const item = await outputGovernance.enqueueChapter(workId, 1, {});
      expect(item.priority).toBe(5);
    });

    test('updates existing queue item instead of duplicating', async () => {
      await outputGovernance.enqueueChapter(workId, 1, { fitnessScore: 0.5 });
      const updated = await outputGovernance.enqueueChapter(workId, 1, { fitnessScore: 0.9 });
      expect(updated.priority).toBe(9);
      expect(updated.status).toBe('pending');

      const all = await OutputQueue.findAll({ where: { workId, chapterNumber: 1 } });
      expect(all.length).toBe(1);
    });
  });

  describe('submitHumanReview', () => {
    test('approves and releases chapter', async () => {
      const item = await OutputQueue.create({
        workId,
        chapterNumber: 1,
        status: 'human_reviewing',
        priority: 5,
      });

      const result = await outputGovernance.submitHumanReview(item.id, 'approve', 'looks good');
      expect(result.status).toBe('released');
      expect(result.releasedBy).toBe('human');
      expect(result.humanReview.decision).toBe('approve');
    });

    test('rejects chapter', async () => {
      const item = await OutputQueue.create({
        workId,
        chapterNumber: 1,
        status: 'human_reviewing',
        priority: 5,
      });

      const result = await outputGovernance.submitHumanReview(item.id, 'reject', 'needs work');
      expect(result.status).toBe('human_rejected');
      expect(result.humanReview.decision).toBe('reject');
    });

    test('revise returns to pending', async () => {
      const item = await OutputQueue.create({
        workId,
        chapterNumber: 1,
        status: 'human_reviewing',
        priority: 5,
      });

      const result = await outputGovernance.submitHumanReview(item.id, 'revise', 'fix plot hole');
      expect(result.status).toBe('pending');
      expect(result.humanReview.decision).toBe('revise');
    });

    test('throws if item not in human_reviewing state', async () => {
      const item = await OutputQueue.create({
        workId,
        chapterNumber: 1,
        status: 'pending',
        priority: 5,
      });

      await expect(
        outputGovernance.submitHumanReview(item.id, 'approve', '')
      ).rejects.toThrow('Queue item not found or not in human_reviewing state');
    });
  });

  describe('requiresHumanReview', () => {
    test('returns true for low fitness score', async () => {
      const item = { fitnessScore: 0.3, chapterNumber: 1, workId };
      const result = await outputGovernance.requiresHumanReview(item);
      expect(result).toBe(true);
    });

    test('returns true for every 10th chapter', async () => {
      const item = { fitnessScore: 0.8, chapterNumber: 10, workId };
      const result = await outputGovernance.requiresHumanReview(item);
      expect(result).toBe(true);
    });

    test('returns false for normal chapter', async () => {
      const item = { fitnessScore: 0.8, chapterNumber: 3, workId };
      const result = await outputGovernance.requiresHumanReview(item);
      expect(result).toBe(false);
    });
  });

  describe('releaseChapter', () => {
    test('updates status to released', async () => {
      const item = await OutputQueue.create({
        workId,
        chapterNumber: 1,
        status: 'human_reviewing',
        priority: 5,
      });

      await outputGovernance.releaseChapter(item, 'system');
      await item.reload();
      expect(item.status).toBe('released');
      expect(item.releasedBy).toBe('system');
      expect(item.releasedAt).toBeDefined();
    });
  });

  describe('getQueueForWork', () => {
    test('returns all queue items for work', async () => {
      await OutputQueue.create({ workId, chapterNumber: 1, status: 'pending', priority: 5 });
      await OutputQueue.create({ workId, chapterNumber: 2, status: 'released', priority: 8 });

      const queue = await outputGovernance.getQueueForWork(workId);
      expect(queue.length).toBe(2);
      expect(queue[0].chapterNumber).toBe(2); // DESC order
    });
  });

  describe('evaluateRule', () => {
    test('min_fitness_score rule passes when score high', async () => {
      const item = await OutputQueue.create({
        workId,
        chapterNumber: 1,
        status: 'pending',
        priority: 5,
        fitnessScore: 0.8,
      });

      const result = await outputGovernance.evaluateRule(
        { name: 'fitness', condition: { type: 'min_fitness_score', value: 0.7 } },
        item
      );
      expect(result.passed).toBe(true);
    });

    test('min_fitness_score rule fails when score low', async () => {
      const item = await OutputQueue.create({
        workId,
        chapterNumber: 1,
        status: 'pending',
        priority: 5,
        fitnessScore: 0.5,
      });

      const result = await outputGovernance.evaluateRule(
        { name: 'fitness', condition: { type: 'min_fitness_score', value: 0.7 } },
        item
      );
      expect(result.passed).toBe(false);
    });

    test('min_word_count evaluates text length', async () => {
      const { readFile } = require('../src/services/file-store');
      readFile.mockResolvedValueOnce('第1章\n\n这是一个非常长的章节内容，字数肯定超过了最低要求。');
      await Work.create({ workId, topic: 'test' });
      await Chapter.create({ workId, number: 1, rawFile: 'ch1.txt' });
      const item = await OutputQueue.create({ workId, chapterNumber: 1, status: 'pending', priority: 5 });

      const result = await outputGovernance.evaluateRule(
        { name: 'wordcount', condition: { type: 'min_word_count', value: 10 } },
        item
      );
      expect(result.passed).toBe(true);
      expect(result.actual).toBeGreaterThanOrEqual(10);
    });

    test('format_compliance checks chapter title', async () => {
      const { readFile } = require('../src/services/file-store');
      readFile.mockResolvedValueOnce('第1章\n\n内容');
      await Work.findOrCreate({ where: { workId }, defaults: { topic: 'test' } });
      await Chapter.create({ workId, number: 2, rawFile: 'ch2.txt' });
      const item = await OutputQueue.create({ workId, chapterNumber: 2, status: 'pending', priority: 5 });

      const result = await outputGovernance.evaluateRule(
        { name: 'format', condition: { type: 'format_compliance' } },
        item
      );
      expect(result.passed).toBe(true);
    });

    test('max_style_deviation passes when no fingerprints', async () => {
      const { readFile } = require('../src/services/file-store');
      readFile.mockResolvedValueOnce('text');
      const styleService = require('../src/services/author-fingerprint');
      styleService.getActiveFingerprints.mockResolvedValueOnce([]);

      const item = await OutputQueue.create({ workId, chapterNumber: 1, status: 'pending', priority: 5 });
      const result = await outputGovernance.evaluateRule(
        { name: 'style', condition: { type: 'max_style_deviation', value: 0.3 } },
        item
      );
      expect(result.passed).toBe(true);
    });

    test('unknown rule type returns passed with note', async () => {
      const item = await OutputQueue.create({
        workId,
        chapterNumber: 1,
        status: 'pending',
        priority: 5,
      });

      const result = await outputGovernance.evaluateRule(
        { name: 'unknown', condition: { type: 'magic' } },
        item
      );
      expect(result.passed).toBe(true);
      expect(result.note).toBe('Unknown rule type');
    });
  });

  describe('processQueue', () => {
    test('L1 block rule fails item', async () => {
      await OutputQueue.create({ workId, chapterNumber: 1, status: 'pending', priority: 5, fitnessScore: 0.3 });
      await OutputValidationRule.create({
        name: 'min_fitness', level: 'l1', isActive: true,
        condition: { type: 'min_fitness_score', value: 0.5 },
        action: 'block',
      });
      outputGovernance.rulesCache = null;

      await outputGovernance.processQueue();

      const item = await OutputQueue.findOne({ where: { workId, chapterNumber: 1 } });
      expect(item.status).toBe('l1_failed');
    });

    test('L2 validation fails when deviations are severe', async () => {
      const styleService = require('../src/services/author-fingerprint');
      styleService.getActiveFingerprints.mockResolvedValueOnce([{ id: 'fp1', name: 'author1' }]);
      styleService.validateAgainstFingerprint.mockResolvedValueOnce({ passed: false, overallScore: 0.3 });

      await OutputQueue.create({ workId, chapterNumber: 1, status: 'pending', priority: 5, fitnessScore: 0.8 });
      await OutputValidationRule.create({
        name: 'min_fitness', level: 'l1', isActive: true,
        condition: { type: 'min_fitness_score', value: 0.5 },
        action: 'block',
      });
      outputGovernance.rulesCache = null;

      await outputGovernance.processQueue();

      const item = await OutputQueue.findOne({ where: { workId, chapterNumber: 1 } });
      expect(item.status).toBe('l2_failed');
    });

    test('item goes to human_reviewing when required', async () => {
      await OutputQueue.create({ workId, chapterNumber: 10, status: 'pending', priority: 5, fitnessScore: 0.8 });
      outputGovernance.rulesCache = null;

      await outputGovernance.processQueue();

      const item = await OutputQueue.findOne({ where: { workId, chapterNumber: 10 } });
      expect(item.status).toBe('human_reviewing');
    });

    test('releases item when all validations pass', async () => {
      await OutputQueue.create({ workId, chapterNumber: 3, status: 'pending', priority: 5, fitnessScore: 0.8 });
      outputGovernance.rulesCache = null;

      await outputGovernance.processQueue();

      const item = await OutputQueue.findOne({ where: { workId, chapterNumber: 3 } });
      expect(item.status).toBe('released');
      expect(item.releasedBy).toBe('system');
    });
  });

  describe('loadChapterText', () => {
    test('returns empty string when chapter not found', async () => {
      const text = await outputGovernance.loadChapterText(workId, 999);
      expect(text).toBe('');
    });
  });
});
