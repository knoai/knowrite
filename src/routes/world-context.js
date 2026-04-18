const express = require('express');
const {
  WorldLore,
  Character,
  CharacterRelation,
  PlotLine,
  PlotNode,
  MapRegion,
  MapConnection,
  WorkTemplateLink,
  StoryTemplate,
} = require('../models');
const { buildWorldContext } = require('../services/world-context');

const router = express.Router({ mergeParams: true });

// Helper: validate workId param
function getWorkId(req) {
  return req.params.workId;
}

// ===================== 世界观记忆库 =====================
router.get('/world-lore', async (req, res) => {
  try {
    const items = await WorldLore.findAll({
      where: { workId: getWorkId(req) },
      order: [['importance', 'DESC'], ['updatedAt', 'DESC']],
    });
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/world-lore', async (req, res) => {
  try {
    const item = await WorldLore.create({ ...req.body, workId: getWorkId(req) });
    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/world-lore/:id', async (req, res) => {
  try {
    const [count] = await WorldLore.update(req.body, {
      where: { id: req.params.id, workId: getWorkId(req) },
    });
    if (!count) return res.status(404).json({ error: '条目不存在' });
    const item = await WorldLore.findByPk(req.params.id);
    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/world-lore/:id', async (req, res) => {
  try {
    const count = await WorldLore.destroy({
      where: { id: req.params.id, workId: getWorkId(req) },
    });
    if (!count) return res.status(404).json({ error: '条目不存在' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== 人物 =====================
router.get('/characters', async (req, res) => {
  try {
    const items = await Character.findAll({
      where: { workId: getWorkId(req) },
      order: [['roleType', 'ASC'], ['name', 'ASC']],
    });
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/characters', async (req, res) => {
  try {
    const item = await Character.create({ ...req.body, workId: getWorkId(req) });
    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/characters/:id', async (req, res) => {
  try {
    const [count] = await Character.update(req.body, {
      where: { id: req.params.id, workId: getWorkId(req) },
    });
    if (!count) return res.status(404).json({ error: '人物不存在' });
    const item = await Character.findByPk(req.params.id);
    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/characters/:id', async (req, res) => {
  try {
    const workId = getWorkId(req);
    const charId = parseInt(req.params.id, 10);
    // 先删除关联关系
    await CharacterRelation.destroy({
      where: { workId, [require('sequelize').Op.or]: [{ fromCharId: charId }, { toCharId: charId }] },
    });
    const count = await Character.destroy({
      where: { id: charId, workId },
    });
    if (!count) return res.status(404).json({ error: '人物不存在' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== 人物关系 =====================
router.get('/character-relations', async (req, res) => {
  try {
    const items = await CharacterRelation.findAll({
      where: { workId: getWorkId(req) },
    });
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/character-relations', async (req, res) => {
  try {
    const item = await CharacterRelation.create({ ...req.body, workId: getWorkId(req) });
    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/character-relations/:id', async (req, res) => {
  try {
    const [count] = await CharacterRelation.update(req.body, {
      where: { id: req.params.id, workId: getWorkId(req) },
    });
    if (!count) return res.status(404).json({ error: '关系不存在' });
    const item = await CharacterRelation.findByPk(req.params.id);
    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/character-relations/:id', async (req, res) => {
  try {
    const count = await CharacterRelation.destroy({
      where: { id: req.params.id, workId: getWorkId(req) },
    });
    if (!count) return res.status(404).json({ error: '关系不存在' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== 剧情线 =====================
router.get('/plot-lines', async (req, res) => {
  try {
    const items = await PlotLine.findAll({
      where: { workId: getWorkId(req) },
      order: [['createdAt', 'ASC']],
      include: [{ model: PlotNode, as: 'nodes', order: [['position', 'ASC']] }],
    });
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/plot-lines', async (req, res) => {
  try {
    const item = await PlotLine.create({ ...req.body, workId: getWorkId(req) });
    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/plot-lines/:id', async (req, res) => {
  try {
    const [count] = await PlotLine.update(req.body, {
      where: { id: req.params.id, workId: getWorkId(req) },
    });
    if (!count) return res.status(404).json({ error: '剧情线不存在' });
    const item = await PlotLine.findByPk(req.params.id);
    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/plot-lines/:id', async (req, res) => {
  try {
    const workId = getWorkId(req);
    const lineId = parseInt(req.params.id, 10);
    await PlotNode.destroy({ where: { plotLineId: lineId, workId } });
    const count = await PlotLine.destroy({ where: { id: lineId, workId } });
    if (!count) return res.status(404).json({ error: '剧情线不存在' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== 剧情节点 =====================
router.get('/plot-lines/:lineId/nodes', async (req, res) => {
  try {
    const items = await PlotNode.findAll({
      where: { plotLineId: req.params.lineId, workId: getWorkId(req) },
      order: [['position', 'ASC']],
    });
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/plot-lines/:lineId/nodes', async (req, res) => {
  try {
    const item = await PlotNode.create({
      ...req.body,
      plotLineId: req.params.lineId,
      workId: getWorkId(req),
    });
    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/plot-lines/:lineId/nodes/:id', async (req, res) => {
  try {
    const [count] = await PlotNode.update(req.body, {
      where: { id: req.params.id, plotLineId: req.params.lineId, workId: getWorkId(req) },
    });
    if (!count) return res.status(404).json({ error: '节点不存在' });
    const item = await PlotNode.findByPk(req.params.id);
    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/plot-lines/:lineId/nodes/:id', async (req, res) => {
  try {
    const count = await PlotNode.destroy({
      where: { id: req.params.id, plotLineId: req.params.lineId, workId: getWorkId(req) },
    });
    if (!count) return res.status(404).json({ error: '节点不存在' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== 地图区域 =====================
router.get('/map-regions', async (req, res) => {
  try {
    const items = await MapRegion.findAll({
      where: { workId: getWorkId(req) },
      order: [['name', 'ASC']],
    });
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/map-regions', async (req, res) => {
  try {
    const item = await MapRegion.create({ ...req.body, workId: getWorkId(req) });
    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/map-regions/:id', async (req, res) => {
  try {
    const [count] = await MapRegion.update(req.body, {
      where: { id: req.params.id, workId: getWorkId(req) },
    });
    if (!count) return res.status(404).json({ error: '区域不存在' });
    const item = await MapRegion.findByPk(req.params.id);
    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/map-regions/:id', async (req, res) => {
  try {
    const workId = getWorkId(req);
    const regionId = parseInt(req.params.id, 10);
    // 先清理子区域的 parentId
    await MapRegion.update({ parentId: null }, { where: { parentId: regionId, workId } });
    // 删除关联连接
    await MapConnection.destroy({
      where: { workId, [require('sequelize').Op.or]: [{ fromRegionId: regionId }, { toRegionId: regionId }] },
    });
    const count = await MapRegion.destroy({ where: { id: regionId, workId } });
    if (!count) return res.status(404).json({ error: '区域不存在' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== 区域连接 =====================
router.get('/map-connections', async (req, res) => {
  try {
    const items = await MapConnection.findAll({
      where: { workId: getWorkId(req) },
    });
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/map-connections', async (req, res) => {
  try {
    const item = await MapConnection.create({ ...req.body, workId: getWorkId(req) });
    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/map-connections/:id', async (req, res) => {
  try {
    const [count] = await MapConnection.update(req.body, {
      where: { id: req.params.id, workId: getWorkId(req) },
    });
    if (!count) return res.status(404).json({ error: '连接不存在' });
    const item = await MapConnection.findByPk(req.params.id);
    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/map-connections/:id', async (req, res) => {
  try {
    const count = await MapConnection.destroy({
      where: { id: req.params.id, workId: getWorkId(req) },
    });
    if (!count) return res.status(404).json({ error: '连接不存在' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== 上下文聚合 =====================
router.get('/context', async (req, res) => {
  try {
    const { chapterNumber } = req.query;
    const text = await buildWorldContext(getWorkId(req), {
      chapterNumber: chapterNumber ? parseInt(chapterNumber, 10) : null,
    });
    res.json({ context: text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== 套路模版关联 =====================
router.get('/templates', async (req, res) => {
  try {
    const workId = getWorkId(req);
    const links = await WorkTemplateLink.findAll({ where: { workId } });
    const templateIds = links.map(l => l.templateId);
    const templates = templateIds.length ? await StoryTemplate.findAll({ where: { id: templateIds } }) : [];
    res.json({ items: templates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/apply-template/:templateId', async (req, res) => {
  try {
    const workId = getWorkId(req);
    const templateId = parseInt(req.params.templateId, 10);
    const template = await StoryTemplate.findByPk(templateId);
    if (!template) return res.status(404).json({ error: '模版不存在' });
    const [link] = await WorkTemplateLink.findOrCreate({
      where: { workId, templateId },
      defaults: { workId, templateId },
    });
    res.json({ success: true, template });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/remove-template/:templateId', async (req, res) => {
  try {
    const workId = getWorkId(req);
    const templateId = parseInt(req.params.templateId, 10);
    await WorkTemplateLink.destroy({ where: { workId, templateId } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
