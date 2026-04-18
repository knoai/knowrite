/**
 * output-governance routes 集成测试
 */
const request = require('supertest');
const express = require('express');
const { OutputValidationRule } = require('../../src/models');

jest.mock('../../src/services/output-governance', () => ({
  getQueueForWork: jest.fn(),
  submitHumanReview: jest.fn(),
}));

const outputGov = require('../../src/services/output-governance');
const router = require('../../src/routes/output-governance');

describe('output-governance routes', () => {
  let app;

  beforeEach(async () => {
    const { initDb, sequelize } = require('../../src/models');
    await initDb();
    await sequelize.query("DELETE FROM output_validation_rules");

    app = express();
    app.use(express.json());
    app.use('/api/output', router);
    jest.clearAllMocks();
  });

  describe('GET /api/output/queue/:workId', () => {
    it('should return queue items for work', async () => {
      outputGov.getQueueForWork.mockResolvedValue([{ id: 1, status: 'pending' }]);

      const res = await request(app).get('/api/output/queue/w1');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.items).toHaveLength(1);
    });

    it('should handle errors', async () => {
      outputGov.getQueueForWork.mockRejectedValue(new Error('db error'));

      const res = await request(app).get('/api/output/queue/w1');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('db error');
    });
  });

  describe('POST /api/output/review/:queueId', () => {
    it('should submit human review with valid body', async () => {
      outputGov.submitHumanReview.mockResolvedValue({ id: 1, decision: 'approve' });

      const res = await request(app)
        .post('/api/output/review/1')
        .send({ decision: 'approve', notes: 'good' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.item.decision).toBe('approve');
    });

    it('should reject invalid decision', async () => {
      const res = await request(app)
        .post('/api/output/review/1')
        .send({ decision: 'invalid', notes: '' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ValidationError');
    });

    it('should handle service errors', async () => {
      outputGov.submitHumanReview.mockRejectedValue(new Error('not found'));

      const res = await request(app)
        .post('/api/output/review/1')
        .send({ decision: 'reject' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('not found');
    });
  });

  describe('GET /api/output/rules', () => {
    it('should return all rules', async () => {
      await OutputValidationRule.create({
        name: 'Rule A',
        level: 'l1',
        category: 'format',
        condition: { type: 'min', value: 100 },
      });
      await OutputValidationRule.create({
        name: 'Rule B',
        level: 'l2',
        category: 'style',
        condition: { type: 'max', value: 50 },
      });

      const res = await request(app).get('/api/output/rules');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.rules).toHaveLength(2);
    });
  });

  describe('POST /api/output/rules', () => {
    it('should create a new rule', async () => {
      const res = await request(app)
        .post('/api/output/rules')
        .send({
          name: 'Min Words',
          level: 'l1',
          category: 'count',
          condition: { type: 'min_word_count', value: 2000 },
          action: 'block',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.rule.name).toBe('Min Words');
      expect(res.body.rule.action).toBe('block');
    });

    it('should reject invalid rule data', async () => {
      const res = await request(app)
        .post('/api/output/rules')
        .send({ name: '', level: 'l3' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ValidationError');
    });
  });

  describe('PUT /api/output/rules/:ruleId', () => {
    it('should update an existing rule', async () => {
      const rule = await OutputValidationRule.create({
        name: 'Old Name',
        level: 'l1',
        condition: { type: 'min', value: 100 },
      });

      const res = await request(app)
        .put(`/api/output/rules/${rule.id}`)
        .send({ name: 'New Name', level: 'l2' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.rule.name).toBe('New Name');
      expect(res.body.rule.level).toBe('l2');
    });

    it('should reject invalid update data', async () => {
      const res = await request(app)
        .put('/api/output/rules/1')
        .send({ level: 'invalid' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ValidationError');
    });
  });

  describe('DELETE /api/output/rules/:ruleId', () => {
    it('should delete a rule', async () => {
      const rule = await OutputValidationRule.create({
        name: 'To Delete',
        level: 'l1',
        condition: { type: 'min', value: 100 },
      });

      const res = await request(app).delete(`/api/output/rules/${rule.id}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const found = await OutputValidationRule.findByPk(rule.id);
      expect(found).toBeNull();
    });
  });
});
