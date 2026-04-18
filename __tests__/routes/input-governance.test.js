/**
 * input-governance routes 集成测试
 */
const request = require('supertest');
const express = require('express');
const { AuthorIntent, CurrentFocus, ChapterIntent, Work } = require('../../src/models');

jest.mock('../../src/services/truth-manager', () => ({
  selectFragmentsForChapter: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/services/world-context', () => ({
  buildWorldContext: jest.fn().mockResolvedValue(''),
}));

const router = require('../../src/routes/input-governance');

describe('input-governance routes', () => {
  let app;

  beforeEach(async () => {
    const { initDb, sequelize } = require('../../src/models');
    await initDb();
    for (const t of ['author_intents', 'current_focuses', 'chapter_intents', 'works']) {
      await sequelize.query(`DELETE FROM ${t}`);
    }

    app = express();
    app.use(express.json());
    app.use('/api/input-governance', router);
  });

  describe('GET /api/input-governance/author-intent/:workId', () => {
    it('should return author intent', async () => {
      await AuthorIntent.create({ workId: 'w1', longTermVision: 'vision', themes: ['t1'] });

      const res = await request(app).get('/api/input-governance/author-intent/w1');
      expect(res.status).toBe(200);
      expect(res.body.longTermVision).toBe('vision');
    });

    it('should return 404 when not found', async () => {
      const res = await request(app).get('/api/input-governance/author-intent/missing');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Not found');
    });
  });

  describe('PUT /api/input-governance/author-intent/:workId', () => {
    it('should create author intent', async () => {
      const res = await request(app)
        .put('/api/input-governance/author-intent/w1')
        .send({ longTermVision: 'Test vision', themes: ['a', 'b'] });

      expect(res.status).toBe(200);
      expect(res.body.longTermVision).toBe('Test vision');
      expect(res.body.workId).toBe('w1');
    });

    it('should update existing author intent', async () => {
      await AuthorIntent.create({ workId: 'w1', longTermVision: 'old' });

      const res = await request(app)
        .put('/api/input-governance/author-intent/w1')
        .send({ longTermVision: 'new' });

      expect(res.status).toBe(200);
      expect(res.body.longTermVision).toBe('new');
    });

    it('should reject too many themes', async () => {
      const res = await request(app)
        .put('/api/input-governance/author-intent/w1')
        .send({ themes: Array(21).fill('x') });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ValidationError');
    });
  });

  describe('GET /api/input-governance/current-focus/:workId', () => {
    it('should return focuses ordered by priority', async () => {
      await CurrentFocus.create({ workId: 'w1', focusText: 'Low', priority: 1, isActive: true });
      await CurrentFocus.create({ workId: 'w1', focusText: 'High', priority: 10, isActive: true });

      const res = await request(app).get('/api/input-governance/current-focus/w1');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].focusText).toBe('High');
    });
  });

  describe('POST /api/input-governance/current-focus/:workId', () => {
    it('should create a focus', async () => {
      const res = await request(app)
        .post('/api/input-governance/current-focus/w1')
        .send({ focusText: 'Focus A', targetChapters: 5, priority: 3 });

      expect(res.status).toBe(200);
      expect(res.body.focusText).toBe('Focus A');
      expect(res.body.targetChapters).toBe(5);
    });

    it('should reject empty focusText', async () => {
      const res = await request(app)
        .post('/api/input-governance/current-focus/w1')
        .send({ focusText: '' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ValidationError');
    });
  });

  describe('PUT /api/input-governance/current-focus/:focusId', () => {
    it('should update a focus', async () => {
      const f = await CurrentFocus.create({ workId: 'w1', focusText: 'Old', isActive: true });

      const res = await request(app)
        .put(`/api/input-governance/current-focus/${f.id}`)
        .send({ focusText: 'New', isActive: false });

      expect(res.status).toBe(200);
      expect(res.body.focusText).toBe('New');
      expect(res.body.isActive).toBe(false);
    });

    it('should return 404 for missing focus', async () => {
      const res = await request(app)
        .put('/api/input-governance/current-focus/999')
        .send({ focusText: 'X' });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/input-governance/current-focus/:focusId', () => {
    it('should delete a focus', async () => {
      const f = await CurrentFocus.create({ workId: 'w1', focusText: 'ToDelete', isActive: true });

      const res = await request(app).delete(`/api/input-governance/current-focus/${f.id}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const found = await CurrentFocus.findByPk(f.id);
      expect(found).toBeNull();
    });

    it('should return 404 for missing focus', async () => {
      const res = await request(app).delete('/api/input-governance/current-focus/999');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/input-governance/chapter-intent/:workId/:chapterNumber', () => {
    it('should return chapter intent', async () => {
      await ChapterIntent.create({ workId: 'w1', chapterNumber: 3, mustKeep: 'keep' });

      const res = await request(app).get('/api/input-governance/chapter-intent/w1/3');
      expect(res.status).toBe(200);
      expect(res.body.mustKeep).toBe('keep');
    });

    it('should return 404 when not found', async () => {
      const res = await request(app).get('/api/input-governance/chapter-intent/w1/99');
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/input-governance/chapter-intent/:workId/:chapterNumber', () => {
    it('should upsert chapter intent', async () => {
      const res = await request(app)
        .put('/api/input-governance/chapter-intent/w1/5')
        .send({ mustKeep: 'keep this', mustAvoid: 'avoid that' });

      expect(res.status).toBe(200);
      expect(res.body.mustKeep).toBe('keep this');
      expect(res.body.chapterNumber).toBe(5);
    });
  });

  describe('POST /api/input-governance/plan/:workId/:chapterNumber', () => {
    it('should plan a chapter', async () => {
      await Work.create({ workId: 'w1', topic: 'Test' });

      const res = await request(app).post('/api/input-governance/plan/w1/1');
      expect(res.status).toBe(200);
      expect(res.body.workId).toBe('w1');
      expect(res.body.chapterNumber).toBe(1);
      expect(res.body.ruleStack).toBeDefined();
    });
  });

  describe('POST /api/input-governance/compose/:workId/:chapterNumber', () => {
    it('should compose a chapter', async () => {
      await Work.create({ workId: 'w1', topic: 'Test' });
      await ChapterIntent.create({ workId: 'w1', chapterNumber: 2, mustKeep: 'x', ruleStack: [] });

      const res = await request(app).post('/api/input-governance/compose/w1/2');
      expect(res.status).toBe(200);
      expect(res.body.intent).toBeDefined();
      expect(res.body.ruleStackText).toBeDefined();
    });

    it('should fail when chapter intent missing', async () => {
      const res = await request(app).post('/api/input-governance/compose/w1/99');
      expect(res.status).toBe(500);
    });
  });

  describe('GET /api/input-governance/governance-variables/:workId/:chapterNumber', () => {
    it('should return governance variables', async () => {
      await AuthorIntent.create({ workId: 'w1', longTermVision: 'V', themes: ['t'] });
      await ChapterIntent.create({ workId: 'w1', chapterNumber: 1, mustKeep: 'k' });

      const res = await request(app).get('/api/input-governance/governance-variables/w1/1');
      expect(res.status).toBe(200);
      expect(res.body.governanceEnabled).toBe(true);
      expect(res.body.authorLongTermVision).toBe('V');
    });
  });
});
