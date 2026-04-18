/**
 * novel routes 集成测试（非 SSE 端点）
 */
const request = require('supertest');
const express = require('express');
const fs = require('fs');
const path = require('path');

jest.mock('../../src/services/novel-engine', () => ({
  listWorks: jest.fn().mockResolvedValue([{ workId: 'w1', topic: 'Test' }]),
  getWorkDir: jest.fn().mockReturnValue('/tmp/works/test'),
  loadMeta: jest.fn().mockResolvedValue({
    workId: 'w1',
    topic: 'Test',
    chapters: [
      { number: 1, polishFile: 'chapter_1_polish.txt' },
      { number: 2, finalFile: 'chapter_2_final.txt' },
    ],
  }),
  detectOutlineDeviation: jest.fn().mockResolvedValue({ severity: 'low', issues: [] }),
  correctOutlineDeviation: jest.fn(),
  correctStyle: jest.fn(),
  importNovel: jest.fn(),
  importOutline: jest.fn(),
  startNovel: jest.fn(),
  continueNovel: jest.fn(),
}));

jest.mock('../../src/services/novel/novel-utils', () => ({
  expandStyle: jest.fn().mockResolvedValue('expanded style'),
}));

jest.mock('../../src/services/prompt-loader', () => ({
  loadPrompt: jest.fn().mockResolvedValue('loaded prompt'),
  listPrompts: jest.fn().mockResolvedValue(['prompt1', 'prompt2']),
}));

jest.mock('../../src/services/memory-index', () => ({
  checkContentRepetition: jest.fn().mockResolvedValue({ repetitive: false, severity: 'low' }),
  repairContentRepetition: jest.fn(),
}));

jest.mock('../../src/services/fitness-evaluator', () => ({
  loadFitness: jest.fn().mockResolvedValue({ score: 0.8 }),
}));

jest.mock('../../src/services/prompt-evolver', () => ({
  evolvePrompt: jest.fn().mockResolvedValue({ winner: 'variant1', fitness: 0.9 }),
  applyCandidate: jest.fn().mockReturnValue({ applied: true }),
}));

jest.mock('../../src/services/settings-store', () => ({
  getSettings: jest.fn().mockResolvedValue({ skill: 'expert', reviewPreset: 'strict' }),
  saveSettings: jest.fn().mockResolvedValue(undefined),
  getAuthorStyles: jest.fn().mockResolvedValue(['style1']),
  saveAuthorStyles: jest.fn().mockResolvedValue(undefined),
  getPlatformStyles: jest.fn().mockResolvedValue(['platform1']),
  savePlatformStyles: jest.fn().mockResolvedValue(undefined),
  getReviewDimensions: jest.fn().mockResolvedValue([{ name: 'style' }]),
  saveReviewDimensions: jest.fn().mockResolvedValue(undefined),
  getReviewPreset: jest.fn().mockResolvedValue('standard'),
  setReviewPreset: jest.fn().mockResolvedValue(undefined),
  getModelConfig: jest.fn().mockResolvedValue({ provider: 'openai', model: 'gpt-4' }),
  saveModelConfig: jest.fn().mockResolvedValue(undefined),
  getChapterConfig: jest.fn().mockResolvedValue({ targetWords: 2000 }),
  saveChapterConfig: jest.fn().mockResolvedValue(undefined),
  getWritingMode: jest.fn().mockResolvedValue('industrial'),
  saveWritingMode: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/file-store', () => ({
  readFile: jest.fn().mockResolvedValue('chapter content'),
  readAllWorkFiles: jest.fn().mockResolvedValue({ 'full.txt': 'full text', 'chapter_1_polish.txt': 'ch1' }),
}));

jest.mock('../../src/core/chat', () => ({
  runStreamChat: jest.fn().mockResolvedValue({ content: 'response', chars: 100, durationMs: 500 }),
}));

const router = require('../../src/routes/novel');

describe('novel routes (non-SSE)', () => {
  let app;

  const testWorkDir = '/tmp/works/test';

  beforeEach(() => {
    fs.mkdirSync(testWorkDir, { recursive: true });
    app = express();
    app.use(express.json());
    app.use('/api/novel', router);
    jest.clearAllMocks();
  });

  afterEach(() => {
    try { fs.rmSync(testWorkDir, { recursive: true, force: true }); } catch {}
  });

  // ===== Works =====
  describe('GET /api/novel/works', () => {
    it('should list works', async () => {
      const { listWorks } = require('../../src/services/novel-engine');
      const res = await request(app).get('/api/novel/works');
      expect(res.status).toBe(200);
      expect(res.body.works).toHaveLength(1);
      expect(listWorks).toHaveBeenCalled();
    });
  });

  describe('GET /api/novel/works/:workId', () => {
    it('should return work details', async () => {
      const res = await request(app).get('/api/novel/works/w1');
      expect(res.status).toBe(200);
      expect(res.body.workId).toBe('w1');
    });
  });

  // ===== Deviation =====
  describe('POST /api/novel/deviation-check', () => {
    it('should check deviation', async () => {
      const { detectOutlineDeviation } = require('../../src/services/novel-engine');
      const res = await request(app)
        .post('/api/novel/deviation-check')
        .send({ workId: 'w1', chapterNumber: 1, chapterText: 'text' });

      expect(res.status).toBe(200);
      expect(res.body.severity).toBe('low');
      expect(detectOutlineDeviation).toHaveBeenCalledWith('w1', 1, 'text', 'deepseek-r1');
    });

    it('should reject missing params', async () => {
      const res = await request(app)
        .post('/api/novel/deviation-check')
        .send({ workId: 'w1' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('缺少');
    });
  });

  // ===== Prompts & Evolution =====
  describe('GET /api/novel/prompts', () => {
    it('should list prompts', async () => {
      const res = await request(app).get('/api/novel/prompts');
      expect(res.status).toBe(200);
      expect(res.body.prompts).toEqual(['prompt1', 'prompt2']);
    });
  });

  describe('POST /api/novel/evolve', () => {
    it('should evolve prompt', async () => {
      const { evolvePrompt } = require('../../src/services/prompt-evolver');
      const res = await request(app)
        .post('/api/novel/evolve')
        .send({ templateName: 'writer', workIds: ['w1'] });

      expect(res.status).toBe(200);
      expect(res.body.winner).toBe('variant1');
      expect(evolvePrompt).toHaveBeenCalledWith('writer', ['w1'], expect.any(Object));
    });

    it('should reject missing templateName', async () => {
      const res = await request(app)
        .post('/api/novel/evolve')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/novel/evolve/apply', () => {
    it('should apply candidate', async () => {
      const { applyCandidate } = require('../../src/services/prompt-evolver');
      const res = await request(app)
        .post('/api/novel/evolve/apply')
        .send({ templateName: 'writer', candidatePath: '/path' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(applyCandidate).toHaveBeenCalledWith('writer', '/path');
    });

    it('should reject missing params', async () => {
      const res = await request(app)
        .post('/api/novel/evolve/apply')
        .send({ templateName: 'writer' });

      expect(res.status).toBe(400);
    });
  });

  // ===== Repetition =====
  describe('POST /api/novel/repetition-check', () => {
    it('should check repetition', async () => {
      const { checkContentRepetition } = require('../../src/services/memory-index');
      const res = await request(app)
        .post('/api/novel/repetition-check')
        .send({ workId: 'w1', chapterNumber: 1 });

      expect(res.status).toBe(200);
      expect(res.body.repetitive).toBe(false);
      expect(checkContentRepetition).toHaveBeenCalled();
    });

    it('should reject missing params', async () => {
      const res = await request(app)
        .post('/api/novel/repetition-check')
        .send({ workId: 'w1' });

      expect(res.status).toBe(400);
    });
  });

  // ===== Settings =====
  describe('settings endpoints', () => {
    const pairs = [
      { name: 'settings', get: 'getSettings', post: 'saveSettings', body: { key: 'val' } },
      { name: 'author-styles', get: 'getAuthorStyles', post: 'saveAuthorStyles', body: ['s1'] },
      { name: 'platform-styles', get: 'getPlatformStyles', post: 'savePlatformStyles', body: ['p1'] },
      { name: 'review-dimensions', get: 'getReviewDimensions', post: 'saveReviewDimensions', body: [{ name: 'n' }] },
      { name: 'model-config', get: 'getModelConfig', post: 'saveModelConfig', body: { provider: 'x' } },
      { name: 'chapter-config', get: 'getChapterConfig', post: 'saveChapterConfig', body: { targetWords: 2000 } },
    ];

    for (const { name, get, post, body } of pairs) {
      it(`GET /${name} should return data`, async () => {
        const store = require('../../src/services/settings-store');
        const res = await request(app).get(`/api/novel/${name}`);
        expect(res.status).toBe(200);
        expect(store[get]).toHaveBeenCalled();
      });

      it(`POST /${name} should save data`, async () => {
        const store = require('../../src/services/settings-store');
        const res = await request(app).post(`/api/novel/${name}`).send(body);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(store[post]).toHaveBeenCalled();
      });
    }

    it('GET /review-preset should return preset', async () => {
      const res = await request(app).get('/api/novel/review-preset');
      expect(res.status).toBe(200);
      expect(res.body.reviewPreset).toBe('standard');
    });

    it('POST /review-preset should set preset', async () => {
      const res = await request(app)
        .post('/api/novel/review-preset')
        .send({ preset: 'strict' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET /writing-mode should return mode', async () => {
      const res = await request(app).get('/api/novel/writing-mode');
      expect(res.status).toBe(200);
      expect(res.body.writingMode).toBe('industrial');
    });

    it('POST /writing-mode should save mode', async () => {
      const res = await request(app)
        .post('/api/novel/writing-mode')
        .send({ mode: 'free' });
      expect(res.status).toBe(200);
      expect(res.body.writingMode).toBe('free');
    });
  });
});
