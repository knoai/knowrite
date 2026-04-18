/**
 * author-fingerprint routes 集成测试
 */
const request = require('supertest');
const express = require('express');
const { AuthorFingerprint, WorkStyleLink } = require('../../src/models');

jest.mock('../../src/services/author-fingerprint', () => ({
  analyzeFullFingerprint: jest.fn(),
  importStyle: jest.fn(),
  getActiveFingerprints: jest.fn(),
  validateAgainstFingerprint: jest.fn(),
}));

const styleService = require('../../src/services/author-fingerprint');
const router = require('../../src/routes/author-fingerprint');

describe('author-fingerprint routes', () => {
  let app;

  beforeEach(async () => {
    const { initDb, sequelize } = require('../../src/models');
    await initDb();
    for (const t of ['author_fingerprints', 'work_style_links']) {
      await sequelize.query(`DELETE FROM ${t}`);
    }

    app = express();
    app.use(express.json());
    app.use('/api/style', router);
    jest.clearAllMocks();
  });

  describe('POST /api/style/analyze', () => {
    it('should analyze text and return fingerprint', async () => {
      styleService.analyzeFullFingerprint.mockResolvedValue({ id: 1, name: 'Test Style' });

      const res = await request(app)
        .post('/api/style/analyze')
        .send({ text: 'sample text', name: 'My Style' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.fingerprint.name).toBe('Test Style');
    });

    it('should reject missing text', async () => {
      const res = await request(app)
        .post('/api/style/analyze')
        .send({ name: 'My Style' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ValidationError');
    });

    it('should reject text too long', async () => {
      const res = await request(app)
        .post('/api/style/analyze')
        .send({ text: 'x'.repeat(100_001), name: 'My Style' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ValidationError');
    });
  });

  describe('GET /api/style/fingerprints', () => {
    it('should return all fingerprints ordered by createdAt', async () => {
      await AuthorFingerprint.create({ name: 'FP1', narrativeLayer: {} });
      await AuthorFingerprint.create({ name: 'FP2', narrativeLayer: {} });

      const res = await request(app).get('/api/style/fingerprints');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.fingerprints).toHaveLength(2);
    });

    it('should return empty array when no fingerprints', async () => {
      const res = await request(app).get('/api/style/fingerprints');
      expect(res.status).toBe(200);
      expect(res.body.fingerprints).toEqual([]);
    });
  });

  describe('POST /api/style/import/:workId', () => {
    it('should import style with priority', async () => {
      styleService.importStyle.mockResolvedValue({ id: 1, workId: 'w1', isActive: true });

      const res = await request(app)
        .post('/api/style/import/w1')
        .send({ fingerprintId: 1, priority: 3 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.link.isActive).toBe(true);
    });

    it('should reject invalid fingerprintId', async () => {
      const res = await request(app)
        .post('/api/style/import/w1')
        .send({ fingerprintId: -1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ValidationError');
    });
  });

  describe('GET /api/style/work/:workId', () => {
    it('should return active fingerprints for work', async () => {
      styleService.getActiveFingerprints.mockResolvedValue([{ id: 1, name: 'Active' }]);

      const res = await request(app).get('/api/style/work/w1');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.fingerprints).toHaveLength(1);
    });
  });

  describe('DELETE /api/style/work/:workId/:fingerprintId', () => {
    it('should deactivate style link', async () => {
      const fp = await AuthorFingerprint.create({ name: 'ToRemove' });
      await WorkStyleLink.create({ workId: 'w1', fingerprintId: fp.id, isActive: true });

      const res = await request(app).delete(`/api/style/work/w1/${fp.id}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const link = await WorkStyleLink.findOne({ where: { workId: 'w1', fingerprintId: fp.id } });
      expect(link.isActive).toBe(false);
    });
  });

  describe('POST /api/style/validate/:workId', () => {
    it('should validate chapter against fingerprint', async () => {
      styleService.validateAgainstFingerprint.mockResolvedValue({ passed: true, deviations: [] });

      const res = await request(app)
        .post('/api/style/validate/w1')
        .send({ chapterText: 'chapter content', fingerprintId: 1 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.result.passed).toBe(true);
    });

    it('should reject missing chapterText', async () => {
      const res = await request(app)
        .post('/api/style/validate/w1')
        .send({ fingerprintId: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ValidationError');
    });
  });
});
