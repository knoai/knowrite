/**
 * templates routes 集成测试
 */
const request = require('supertest');
const express = require('express');
const { StoryTemplate } = require('../../src/models');
const { router, seedDefaultTemplates } = require('../../src/routes/templates');

describe('templates routes', () => {
  let app;

  beforeEach(async () => {
    const { initDb, sequelize } = require('../../src/models');
    await initDb();
    await sequelize.query('DELETE FROM story_templates');

    app = express();
    app.use(express.json());
    app.use('/api/novel/story-templates', router);
  });

  describe('GET /api/novel/story-templates', () => {
    it('should list global templates by default', async () => {
      await StoryTemplate.create({ name: 'T1', scope: 'global', category: 'A' });
      await StoryTemplate.create({ name: 'T2', scope: 'global', category: 'B' });
      await StoryTemplate.create({ name: 'T3', scope: 'work', workId: 'w1' });

      const res = await request(app).get('/api/novel/story-templates');
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
    });

    it('should filter by scope', async () => {
      await StoryTemplate.create({ name: 'T1', scope: 'global' });
      await StoryTemplate.create({ name: 'T2', scope: 'work', workId: 'w1' });

      const res = await request(app).get('/api/novel/story-templates?scope=work&workId=w1');
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].name).toBe('T2');
    });
  });

  describe('POST /api/novel/story-templates', () => {
    it('should create a template', async () => {
      const res = await request(app)
        .post('/api/novel/story-templates')
        .send({
          name: 'New Template',
          category: 'Test',
          description: 'A test template',
          beatStructure: [{ beat: 'Start', chapters: 3, goal: 'Begin' }],
        });

      expect(res.status).toBe(200);
      expect(res.body.item.name).toBe('New Template');
    });
  });

  describe('PUT /api/novel/story-templates/:id', () => {
    it('should update a template', async () => {
      const tpl = await StoryTemplate.create({ name: 'Old', category: 'X' });

      const res = await request(app)
        .put(`/api/novel/story-templates/${tpl.id}`)
        .send({ name: 'Updated' });

      expect(res.status).toBe(200);
      expect(res.body.item.name).toBe('Updated');
    });

    it('should return 404 for missing template', async () => {
      const res = await request(app)
        .put('/api/novel/story-templates/999')
        .send({ name: 'X' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('模版不存在');
    });
  });

  describe('DELETE /api/novel/story-templates/:id', () => {
    it('should delete a template', async () => {
      const tpl = await StoryTemplate.create({ name: 'ToDelete' });

      const res = await request(app).delete(`/api/novel/story-templates/${tpl.id}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const found = await StoryTemplate.findByPk(tpl.id);
      expect(found).toBeNull();
    });

    it('should return 404 for missing template', async () => {
      const res = await request(app).delete('/api/novel/story-templates/999');
      expect(res.status).toBe(404);
    });
  });

  describe('seedDefaultTemplates', () => {
    it('should seed templates when table is empty', async () => {
      await seedDefaultTemplates();
      const count = await StoryTemplate.count({ where: { scope: 'global' } });
      expect(count).toBe(5);
    });

    it('should not duplicate when templates already exist', async () => {
      await StoryTemplate.create({ name: 'Existing', scope: 'global', category: 'X' });
      await seedDefaultTemplates();
      const count = await StoryTemplate.count({ where: { scope: 'global' } });
      expect(count).toBe(1); // only the existing one
    });
  });
});
