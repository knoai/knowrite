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
  tryCreateOutline: jest.fn(),
  tryCreateDetailedOutline: jest.fn(),
  tryCreateChapters: jest.fn(),
  tryContinue: jest.fn(),
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
  getModelConfig: jest.fn().mockResolvedValue({
    provider: 'openai',
    model: 'gpt-4',
    providers: {
      openai: { enabled: true, alias: 'OpenAI', apiKey: 'sk-test', baseURL: 'https://api.openai.com', models: ['gpt-4', 'gpt-3.5'] },
      kimi: { enabled: true, alias: 'Kimi', apiKey: 'key', baseURL: 'https://api.moonshot.cn', models: ['kimi-k2'] },
    },
  }),
  saveModelConfig: jest.fn().mockResolvedValue(undefined),
  switchProvider: jest.fn().mockResolvedValue({ switched: true, provider: 'kimi', rolesUpdated: 20 }),
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

    it('POST /switch-provider should switch all roles', async () => {
      const store = require('../../src/services/settings-store');
      const res = await request(app)
        .post('/api/novel/switch-provider')
        .send({ provider: 'kimi' });
      expect(res.status).toBe(200);
      expect(res.body.switched).toBe(true);
      expect(store.switchProvider).toHaveBeenCalledWith('kimi', {});
    });

    it('POST /switch-provider should switch with uniform model', async () => {
      const store = require('../../src/services/settings-store');
      const res = await request(app)
        .post('/api/novel/switch-provider')
        .send({ provider: 'kimi', mode: 'uniform', uniformModel: 'kimi-k2', roles: ['writer', 'editor'] });
      expect(res.status).toBe(200);
      expect(res.body.switched).toBe(true);
      expect(store.switchProvider).toHaveBeenCalledWith('kimi', { mode: 'uniform', uniformModel: 'kimi-k2', roles: ['writer', 'editor'] });
    });

    it('POST /switch-provider should switch with custom map', async () => {
      const store = require('../../src/services/settings-store');
      const res = await request(app)
        .post('/api/novel/switch-provider')
        .send({ provider: 'kimi', mode: 'custom', customMap: { writer: 'kimi-k2', editor: 'kimi-k1' } });
      expect(res.status).toBe(200);
      expect(res.body.switched).toBe(true);
      expect(store.switchProvider).toHaveBeenCalledWith('kimi', { mode: 'custom', customMap: { writer: 'kimi-k2', editor: 'kimi-k1' } });
    });

    it('POST /switch-provider should reject missing provider', async () => {
      const res = await request(app)
        .post('/api/novel/switch-provider')
        .send({});
      expect(res.status).toBe(400);
    });

    it('POST /test-provider should validate a provider', async () => {
      const chat = require('../../src/core/chat');
      const res = await request(app)
        .post('/api/novel/test-provider')
        .send({ provider: 'openai' });
      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.response).toBe('response');
      expect(chat.runStreamChat).toHaveBeenCalledWith(
        [{ role: 'user', content: '你好，请只回复"成功"两个字。' }],
        { provider: 'openai', model: 'gpt-4', temperature: 0.7 }
      );
    });

    it('POST /test-provider should reject missing provider', async () => {
      const res = await request(app)
        .post('/api/novel/test-provider')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/缺少 provider/);
    });

    it('POST /test-provider should reject unknown provider', async () => {
      const res = await request(app)
        .post('/api/novel/test-provider')
        .send({ provider: 'unknown' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/未找到 Provider/);
    });

    it('POST /test-provider should reject provider without models', async () => {
      const store = require('../../src/services/settings-store');
      store.getModelConfig.mockResolvedValueOnce({
        providers: { empty: { enabled: true, alias: 'Empty', apiKey: '', baseURL: '', models: [] } },
      });
      const res = await request(app)
        .post('/api/novel/test-provider')
        .send({ provider: 'empty' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/没有配置可用模型/);
    });

    it('POST /test-provider should return invalid on chat error', async () => {
      const chat = require('../../src/core/chat');
      chat.runStreamChat.mockRejectedValueOnce(new Error('Network timeout'));
      const res = await request(app)
        .post('/api/novel/test-provider')
        .send({ provider: 'openai' });
      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(false);
      expect(res.body.error).toBe('Network timeout');
    });

    it('POST /test-models should test all models', async () => {
      const chat = require('../../src/core/chat');
      const res = await request(app)
        .post('/api/novel/test-models')
        .send({ provider: 'openai' });
      expect(res.status).toBe(200);
      expect(res.body.provider).toBe('openai');
      expect(res.body.results).toHaveLength(2);
      expect(res.body.results[0]).toMatchObject({ model: 'gpt-4', valid: true, response: 'response' });
      expect(res.body.results[1]).toMatchObject({ model: 'gpt-3.5', valid: true, response: 'response' });
      expect(chat.runStreamChat).toHaveBeenCalledTimes(2);
    });

    it('POST /test-models should reject missing provider', async () => {
      const res = await request(app)
        .post('/api/novel/test-models')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/缺少 provider/);
    });

    it('POST /test-models should reject unknown provider', async () => {
      const res = await request(app)
        .post('/api/novel/test-models')
        .send({ provider: 'unknown' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/未找到 Provider/);
    });

    it('POST /test-models should reject provider without models', async () => {
      const store = require('../../src/services/settings-store');
      store.getModelConfig.mockResolvedValueOnce({
        providers: { empty: { enabled: true, alias: 'Empty', apiKey: '', baseURL: '', models: [] } },
      });
      const res = await request(app)
        .post('/api/novel/test-models')
        .send({ provider: 'empty' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/没有配置可用模型/);
    });

    it('POST /test-models should handle partial failures', async () => {
      const chat = require('../../src/core/chat');
      chat.runStreamChat.mockImplementation((_messages, config) => {
        if (config.model === 'gpt-4') return Promise.resolve({ content: 'ok1', chars: 3, durationMs: 100 });
        return Promise.reject(new Error('quota exceeded'));
      });
      const res = await request(app)
        .post('/api/novel/test-models')
        .send({ provider: 'openai' });
      chat.runStreamChat.mockRestore?.();
      // restore default mock for subsequent tests
      chat.runStreamChat.mockResolvedValue({ content: 'response', chars: 100, durationMs: 500 });
      expect(res.status).toBe(200);
      expect(res.body.results).toHaveLength(2);
      expect(res.body.results[0]).toMatchObject({ model: 'gpt-4', valid: true, response: 'ok1' });
      expect(res.body.results[1]).toMatchObject({ model: 'gpt-3.5', valid: false, error: 'quota exceeded' });
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

  // ===== 尝试创作（渐进式流程） =====
  describe('try-create endpoints', () => {
    beforeEach(() => {
      const engine = require('../../src/services/novel-engine');
      engine.tryCreateOutline.mockImplementation(async (_topic, _style, _strategy, _customModels, callbacks) => {
        if (callbacks?.onDone) callbacks.onDone({ workId: 'try1', outlineTheme: 'theme' });
      });
      engine.tryCreateDetailedOutline.mockImplementation(async (_workId, _customModels, callbacks) => {
        if (callbacks?.onDone) callbacks.onDone({ workId: 'try1', outlineDetailed: 'detailed' });
      });
      engine.tryCreateChapters.mockImplementation(async (_workId, _customModels, callbacks) => {
        if (callbacks?.onDone) callbacks.onDone({ workId: 'try1', chapters: [{ number: 1 }] });
      });
      engine.tryContinue.mockImplementation(async (_workId, _customModels, callbacks) => {
        if (callbacks?.onDone) callbacks.onDone({ workId: 'try1', chapters: [{ number: 1 }, { number: 2 }] });
      });
    });

    it('POST /try/outline should start try creation', async () => {
      const engine = require('../../src/services/novel-engine');
      const res = await request(app)
        .post('/api/novel/try/outline')
        .send({ topic: 'Test', platformStyle: '番茄', authorStyle: '热血', strategy: 'pipeline' });
      expect(res.status).toBe(200);
      expect(engine.tryCreateOutline).toHaveBeenCalled();
    });

    it('POST /try/outline should reject missing topic', async () => {
      const res = await request(app).post('/api/novel/try/outline').send({});
      expect(res.status).toBe(400);
    });

    it('POST /try/detailed-outline should generate detailed outline', async () => {
      const engine = require('../../src/services/novel-engine');
      const res = await request(app)
        .post('/api/novel/try/detailed-outline')
        .send({ workId: 'try1' });
      expect(res.status).toBe(200);
      expect(engine.tryCreateDetailedOutline).toHaveBeenCalledWith('try1', {}, expect.any(Object));
    });

    it('POST /try/detailed-outline should reject missing workId', async () => {
      const res = await request(app).post('/api/novel/try/detailed-outline').send({});
      expect(res.status).toBe(400);
    });

    it('POST /try/chapters should generate first chapters', async () => {
      const engine = require('../../src/services/novel-engine');
      const res = await request(app)
        .post('/api/novel/try/chapters')
        .send({ workId: 'try1', count: 3 });
      expect(res.status).toBe(200);
      expect(engine.tryCreateChapters).toHaveBeenCalledWith('try1', {}, expect.any(Object), 3);
    });

    it('POST /try/chapters should reject missing workId', async () => {
      const res = await request(app).post('/api/novel/try/chapters').send({});
      expect(res.status).toBe(400);
    });

    it('POST /try/continue should continue novel', async () => {
      const engine = require('../../src/services/novel-engine');
      const res = await request(app)
        .post('/api/novel/try/continue')
        .send({ workId: 'try1' });
      expect(res.status).toBe(200);
      expect(engine.tryContinue).toHaveBeenCalledWith('try1', {}, expect.any(Object));
    });

    it('POST /try/continue should reject missing workId', async () => {
      const res = await request(app).post('/api/novel/try/continue').send({});
      expect(res.status).toBe(400);
    });
  });
});
