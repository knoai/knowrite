/**
 * world-context routes 集成测试
 */
const request = require('supertest');
const express = require('express');
const {
  WorldLore, Character, CharacterRelation, PlotLine, PlotNode,
  MapRegion, MapConnection, StoryTemplate, WorkTemplateLink,
} = require('../../src/models');

const router = require('../../src/routes/world-context');

describe('world-context routes', () => {
  let app;
  const workId = 'wc-test-1';

  beforeEach(async () => {
    const { initDb, sequelize } = require('../../src/models');
    await initDb();
    const tables = [
      'world_lore', 'characters', 'character_relations', 'plot_lines',
      'plot_nodes', 'map_regions', 'map_connections', 'story_templates',
      'work_template_links',
    ];
    for (const t of tables) {
      await sequelize.query(`DELETE FROM ${t}`);
    }

    const parentApp = express();
    parentApp.use(express.json());
    parentApp.use(`/api/novel/works/:workId`, router);
    app = parentApp;
  });

  // ===================== WorldLore =====================
  describe('WorldLore CRUD', () => {
    it('should list lore items', async () => {
      await WorldLore.create({ workId, title: 'Lore A', content: '...', importance: 5 });
      await WorldLore.create({ workId, title: 'Lore B', content: '...', importance: 3 });

      const res = await request(app).get(`/api/novel/works/${workId}/world-lore`);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0].title).toBe('Lore A'); // higher importance first
    });

    it('should create lore', async () => {
      const res = await request(app)
        .post(`/api/novel/works/${workId}/world-lore`)
        .send({ title: 'New Lore', content: 'desc', category: '设定' });

      expect(res.status).toBe(200);
      expect(res.body.item.title).toBe('New Lore');
    });

    it('should update lore', async () => {
      const lore = await WorldLore.create({ workId, title: 'Old', content: 'x' });

      const res = await request(app)
        .put(`/api/novel/works/${workId}/world-lore/${lore.id}`)
        .send({ title: 'Updated' });

      expect(res.status).toBe(200);
      expect(res.body.item.title).toBe('Updated');
    });

    it('should return 404 for missing lore on update', async () => {
      const res = await request(app)
        .put(`/api/novel/works/${workId}/world-lore/999`)
        .send({ title: 'X' });

      expect(res.status).toBe(404);
    });

    it('should delete lore', async () => {
      const lore = await WorldLore.create({ workId, title: 'ToDelete', content: 'x' });

      const res = await request(app).delete(`/api/novel/works/${workId}/world-lore/${lore.id}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ===================== Character =====================
  describe('Character CRUD', () => {
    it('should list characters', async () => {
      await Character.create({ workId, name: 'Alice', roleType: '主角' });
      await Character.create({ workId, name: 'Bob', roleType: '配角' });

      const res = await request(app).get(`/api/novel/works/${workId}/characters`);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
    });

    it('should create character', async () => {
      const res = await request(app)
        .post(`/api/novel/works/${workId}/characters`)
        .send({ name: 'Charlie', roleType: '反派' });

      expect(res.status).toBe(200);
      expect(res.body.item.name).toBe('Charlie');
    });

    it('should update character', async () => {
      const char = await Character.create({ workId, name: 'OldName' });

      const res = await request(app)
        .put(`/api/novel/works/${workId}/characters/${char.id}`)
        .send({ name: 'NewName' });

      expect(res.status).toBe(200);
      expect(res.body.item.name).toBe('NewName');
    });

    it('should delete character and its relations', async () => {
      const char = await Character.create({ workId, name: 'ToDelete' });
      await CharacterRelation.create({ workId, fromCharId: char.id, toCharId: 999, relationType: '朋友' });

      const res = await request(app).delete(`/api/novel/works/${workId}/characters/${char.id}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const rels = await CharacterRelation.findAll({ where: { workId } });
      expect(rels).toHaveLength(0);
    });
  });

  // ===================== CharacterRelation =====================
  describe('CharacterRelation CRUD', () => {
    it('should list relations', async () => {
      await CharacterRelation.create({ workId, fromCharId: 1, toCharId: 2, relationType: '兄弟' });

      const res = await request(app).get(`/api/novel/works/${workId}/character-relations`);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
    });

    it('should create relation', async () => {
      const res = await request(app)
        .post(`/api/novel/works/${workId}/character-relations`)
        .send({ fromCharId: 1, toCharId: 2, relationType: '师徒', strength: 8 });

      expect(res.status).toBe(200);
      expect(res.body.item.relationType).toBe('师徒');
    });

    it('should update relation', async () => {
      const rel = await CharacterRelation.create({ workId, fromCharId: 1, toCharId: 2, relationType: '旧' });

      const res = await request(app)
        .put(`/api/novel/works/${workId}/character-relations/${rel.id}`)
        .send({ relationType: '新' });

      expect(res.status).toBe(200);
      expect(res.body.item.relationType).toBe('新');
    });

    it('should delete relation', async () => {
      const rel = await CharacterRelation.create({ workId, fromCharId: 1, toCharId: 2, relationType: 'X' });

      const res = await request(app).delete(`/api/novel/works/${workId}/character-relations/${rel.id}`);
      expect(res.status).toBe(200);
    });
  });

  // ===================== PlotLine =====================
  describe('PlotLine CRUD', () => {
    it('should list plot lines with nodes', async () => {
      const line = await PlotLine.create({ workId, name: '主线', type: '主线' });
      await PlotNode.create({ workId, plotLineId: line.id, title: '节点1', position: 1 });

      const res = await request(app).get(`/api/novel/works/${workId}/plot-lines`);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].nodes).toHaveLength(1);
    });

    it('should create plot line', async () => {
      const res = await request(app)
        .post(`/api/novel/works/${workId}/plot-lines`)
        .send({ name: '支线', type: '支线' });

      expect(res.status).toBe(200);
      expect(res.body.item.name).toBe('支线');
    });

    it('should delete plot line and its nodes', async () => {
      const line = await PlotLine.create({ workId, name: 'ToDelete' });
      await PlotNode.create({ workId, plotLineId: line.id, title: 'N1' });

      const res = await request(app).delete(`/api/novel/works/${workId}/plot-lines/${line.id}`);
      expect(res.status).toBe(200);

      const nodes = await PlotNode.findAll({ where: { plotLineId: line.id } });
      expect(nodes).toHaveLength(0);
    });
  });

  // ===================== PlotNode =====================
  describe('PlotNode CRUD', () => {
    it('should list nodes for line', async () => {
      const line = await PlotLine.create({ workId, name: 'L1' });
      await PlotNode.create({ workId, plotLineId: line.id, title: 'N1', position: 1 });
      await PlotNode.create({ workId, plotLineId: line.id, title: 'N2', position: 2 });

      const res = await request(app).get(`/api/novel/works/${workId}/plot-lines/${line.id}/nodes`);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
    });

    it('should create node', async () => {
      const line = await PlotLine.create({ workId, name: 'L1' });

      const res = await request(app)
        .post(`/api/novel/works/${workId}/plot-lines/${line.id}/nodes`)
        .send({ title: 'New Node', description: 'desc' });

      expect(res.status).toBe(200);
      expect(res.body.item.title).toBe('New Node');
    });
  });

  // ===================== MapRegion =====================
  describe('MapRegion CRUD', () => {
    it('should list regions', async () => {
      await MapRegion.create({ workId, name: '北京', regionType: '城市' });

      const res = await request(app).get(`/api/novel/works/${workId}/map-regions`);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
    });

    it('should create region', async () => {
      const res = await request(app)
        .post(`/api/novel/works/${workId}/map-regions`)
        .send({ name: '上海', regionType: '城市' });

      expect(res.status).toBe(200);
      expect(res.body.item.name).toBe('上海');
    });

    it('should delete region and cleanup connections', async () => {
      const region = await MapRegion.create({ workId, name: 'ToDelete' });
      await MapConnection.create({ workId, fromRegionId: region.id, toRegionId: 999 });

      const res = await request(app).delete(`/api/novel/works/${workId}/map-regions/${region.id}`);
      expect(res.status).toBe(200);

      const conns = await MapConnection.findAll({ where: { workId } });
      expect(conns).toHaveLength(0);
    });
  });

  // ===================== MapConnection =====================
  describe('MapConnection CRUD', () => {
    it('should list connections', async () => {
      await MapConnection.create({ workId, fromRegionId: 1, toRegionId: 2, connType: '道路' });

      const res = await request(app).get(`/api/novel/works/${workId}/map-connections`);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
    });

    it('should create connection', async () => {
      const res = await request(app)
        .post(`/api/novel/works/${workId}/map-connections`)
        .send({ fromRegionId: 1, toRegionId: 2, connType: '传送阵' });

      expect(res.status).toBe(200);
      expect(res.body.item.connType).toBe('传送阵');
    });
  });

  // ===================== Context =====================
  describe('GET /context', () => {
    it('should return world context', async () => {
      const res = await request(app).get(`/api/novel/works/${workId}/context`);
      expect(res.status).toBe(200);
      expect(res.body.context).toBeDefined();
    });

    it('should pass chapterNumber query', async () => {
      const res = await request(app).get(`/api/novel/works/${workId}/context?chapterNumber=5`);
      expect(res.status).toBe(200);
      expect(res.body.context).toBeDefined();
    });
  });

  // ===================== Templates =====================
  describe('Template management', () => {
    it('should list applied templates', async () => {
      const tpl = await StoryTemplate.create({ name: 'Hero Journey', category: '经典' });
      await WorkTemplateLink.create({ workId, templateId: tpl.id });

      const res = await request(app).get(`/api/novel/works/${workId}/templates`);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].name).toBe('Hero Journey');
    });

    it('should return empty when no templates', async () => {
      const res = await request(app).get(`/api/novel/works/${workId}/templates`);
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
    });

    it('should apply template', async () => {
      const tpl = await StoryTemplate.create({ name: 'Three Acts' });

      const res = await request(app).post(`/api/novel/works/${workId}/apply-template/${tpl.id}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.template.name).toBe('Three Acts');
    });

    it('should return 404 for missing template', async () => {
      const res = await request(app).post(`/api/novel/works/${workId}/apply-template/999`);
      expect(res.status).toBe(404);
    });

    it('should remove template link', async () => {
      const tpl = await StoryTemplate.create({ name: 'X' });
      await WorkTemplateLink.create({ workId, templateId: tpl.id });

      const res = await request(app).delete(`/api/novel/works/${workId}/remove-template/${tpl.id}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const links = await WorkTemplateLink.findAll({ where: { workId } });
      expect(links).toHaveLength(0);
    });
  });
});
