/**
 * temporal-truth routes 集成测试
 */
const request = require('supertest');
const express = require('express');
const { TruthHook, TruthResource, TruthState } = require('../../src/models');

jest.mock('../../src/services/truth-manager', () => ({
  getCurrentState: jest.fn(),
  initializeTruthFiles: jest.fn(),
  analyzeTrends: jest.fn(),
  detectAnomalies: jest.fn(),
  traceChanges: jest.fn(),
}));

const truthManager = require('../../src/services/truth-manager');
const router = require('../../src/routes/temporal-truth');

describe('temporal-truth routes', () => {
  let app;

  beforeEach(async () => {
    const { initDb, sequelize } = require('../../src/models');
    await initDb();
    for (const t of ['truth_hooks', 'truth_resources', 'truth_states']) {
      await sequelize.query(`DELETE FROM ${t}`);
    }

    app = express();
    app.use(express.json());
    app.use('/api/truth', router);
    jest.clearAllMocks();
  });

  describe('GET /api/truth/state/:workId', () => {
    it('should return current state', async () => {
      truthManager.getCurrentState.mockResolvedValue({ characters: {}, world: {} });

      const res = await request(app).get('/api/truth/state/w1');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.state).toEqual({ characters: {}, world: {} });
    });

    it('should handle errors', async () => {
      truthManager.getCurrentState.mockRejectedValue(new Error('fail'));

      const res = await request(app).get('/api/truth/state/w1');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('fail');
    });
  });

  describe('GET /api/truth/state/:workId/:chapterNumber', () => {
    it('should return state for chapter', async () => {
      await TruthState.create({
        workId: 'w1',
        chapterNumber: 5,
        characterStates: { 主角: { location: '北京' } },
        worldState: {},
      });

      const res = await request(app).get('/api/truth/state/w1/5');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.state.chapterNumber).toBe(5);
    });
  });

  describe('GET /api/truth/hooks/:workId', () => {
    it('should return hooks for work', async () => {
      await TruthHook.create({ workId: 'w1', hookId: 'h1', description: 'Hook 1', status: 'open' });
      await TruthHook.create({ workId: 'w1', hookId: 'h2', description: 'Hook 2', status: 'resolved' });

      const res = await request(app).get('/api/truth/hooks/w1');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.hooks).toHaveLength(2);
    });
  });

  describe('POST /api/truth/hooks/:workId', () => {
    it('should create a hook', async () => {
      const res = await request(app)
        .post('/api/truth/hooks/w1')
        .send({ description: 'New hook', importance: 8 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.hook.description).toBe('New hook');
      expect(res.body.hook.status).toBe('open');
      expect(res.body.hook.hookId).toBeDefined();
    });

    it('should reject empty description', async () => {
      const res = await request(app)
        .post('/api/truth/hooks/w1')
        .send({ description: '' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ValidationError');
    });
  });

  describe('PUT /api/truth/hooks/:workId/:hookId', () => {
    it('should update a hook', async () => {
      await TruthHook.create({ workId: 'w1', hookId: 'h1', description: 'Old', status: 'open' });

      const res = await request(app)
        .put('/api/truth/hooks/w1/h1')
        .send({ description: 'Updated', status: 'resolved' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.hook.description).toBe('Updated');
      expect(res.body.hook.status).toBe('resolved');
    });
  });

  describe('GET /api/truth/resources/:workId', () => {
    it('should return resources', async () => {
      await TruthResource.create({ workId: 'w1', name: 'Sword', quantity: 1 });

      const res = await request(app).get('/api/truth/resources/w1');
      expect(res.status).toBe(200);
      expect(res.body.resources).toHaveLength(1);
      expect(res.body.resources[0].name).toBe('Sword');
    });
  });

  describe('POST /api/truth/resources/:workId', () => {
    it('should create a resource', async () => {
      const res = await request(app)
        .post('/api/truth/resources/w1')
        .send({ name: 'Shield', quantity: 2 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.resource.name).toBe('Shield');
      expect(res.body.resource.status).toBe('active');
    });

    it('should reject empty name', async () => {
      const res = await request(app)
        .post('/api/truth/resources/w1')
        .send({ name: '' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ValidationError');
    });
  });

  describe('PUT /api/truth/resources/:workId/:resourceId', () => {
    it('should update a resource', async () => {
      const r = await TruthResource.create({ workId: 'w1', name: 'Potion', quantity: 1 });

      const res = await request(app)
        .put(`/api/truth/resources/w1/${r.id}`)
        .send({ quantity: 5, status: 'consumed' });

      expect(res.status).toBe(200);
      expect(res.body.resource.quantity).toBe(5);
      expect(res.body.resource.status).toBe('consumed');
    });
  });

  describe('POST /api/truth/initialize/:workId', () => {
    it('should initialize truth files', async () => {
      truthManager.initializeTruthFiles.mockResolvedValue({ created: true });

      const res = await request(app).post('/api/truth/initialize/w1');
      expect(res.status).toBe(200);
      expect(res.body.result.created).toBe(true);
    });
  });

  describe('GET /api/truth/trends/:workId/:metric', () => {
    it('should return trends', async () => {
      truthManager.analyzeTrends.mockResolvedValue([{ chapter: 1, value: 10 }]);

      const res = await request(app).get('/api/truth/trends/w1/health');
      expect(res.status).toBe(200);
      expect(res.body.trends).toHaveLength(1);
    });

    it('should pass query params', async () => {
      truthManager.analyzeTrends.mockResolvedValue([]);

      const res = await request(app).get('/api/truth/trends/w1/health?from=5&to=10');
      expect(res.status).toBe(200);
      expect(truthManager.analyzeTrends).toHaveBeenCalledWith('w1', 'health', { fromChapter: 5, toChapter: 10 });
    });
  });

  describe('GET /api/truth/anomalies/:workId', () => {
    it('should return anomalies', async () => {
      truthManager.detectAnomalies.mockResolvedValue([{ type: 'jump' }]);

      const res = await request(app).get('/api/truth/anomalies/w1');
      expect(res.status).toBe(200);
      expect(res.body.anomalies).toHaveLength(1);
    });
  });

  describe('GET /api/truth/trace/:workId', () => {
    it('should trace changes', async () => {
      truthManager.traceChanges.mockResolvedValue([{ event: 'move' }]);

      const res = await request(app).get('/api/truth/trace/w1?subjectType=char&subjectId=1&from=1&to=10');
      expect(res.status).toBe(200);
      expect(res.body.changes).toHaveLength(1);
      expect(truthManager.traceChanges).toHaveBeenCalledWith('w1', 'char', '1', 1, 10);
    });
  });
});
