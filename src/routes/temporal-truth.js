const express = require('express');
const router = express.Router();
const truthManager = require('../services/truth-manager');
const { TruthState, TruthHook, TruthResource } = require('../models');
const { validateBody } = require('../middleware/validator');
const { createHookSchema, updateHookSchema, createResourceSchema, updateResourceSchema } = require('../schemas/routes');

// GET /api/truth/state/:workId
router.get('/state/:workId', async (req, res) => {
  try {
    const state = await truthManager.getCurrentState(req.params.workId);
    res.json({ success: true, state });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/truth/state/:workId/:chapterNumber
router.get('/state/:workId/:chapterNumber', async (req, res) => {
  try {
    const state = await TruthState.findOne({
      where: { workId: req.params.workId, chapterNumber: parseInt(req.params.chapterNumber) },
    });
    res.json({ success: true, state });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/truth/hooks/:workId
router.get('/hooks/:workId', async (req, res) => {
  try {
    const hooks = await TruthHook.findAll({
      where: { workId: req.params.workId },
      order: [['status', 'ASC'], ['importance', 'DESC']],
    });
    res.json({ success: true, hooks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/truth/hooks/:workId
router.post('/hooks/:workId', validateBody(createHookSchema), async (req, res) => {
  try {
    const hook = await TruthHook.create({
      workId: req.params.workId,
      hookId: `hook_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      ...req.body,
      status: 'open',
    });
    res.json({ success: true, hook });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/truth/hooks/:workId/:hookId
router.put('/hooks/:workId/:hookId', validateBody(updateHookSchema), async (req, res) => {
  try {
    await TruthHook.update(req.body, { where: { workId: req.params.workId, hookId: req.params.hookId } });
    const hook = await TruthHook.findOne({ where: { hookId: req.params.hookId } });
    res.json({ success: true, hook });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/truth/resources/:workId
router.get('/resources/:workId', async (req, res) => {
  try {
    const resources = await TruthResource.findAll({
      where: { workId: req.params.workId },
      order: [['status', 'ASC'], ['name', 'ASC']],
    });
    res.json({ success: true, resources });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/truth/resources/:workId
router.post('/resources/:workId', validateBody(createResourceSchema), async (req, res) => {
  try {
    const resource = await TruthResource.create({
      workId: req.params.workId,
      ...req.body,
      status: 'active',
    });
    res.json({ success: true, resource });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/truth/resources/:workId/:resourceId
router.put('/resources/:workId/:resourceId', validateBody(updateResourceSchema), async (req, res) => {
  try {
    await TruthResource.update(req.body, { where: { id: req.params.resourceId } });
    const resource = await TruthResource.findByPk(req.params.resourceId);
    res.json({ success: true, resource });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/truth/initialize/:workId
router.post('/initialize/:workId', async (req, res) => {
  try {
    const result = await truthManager.initializeTruthFiles(req.params.workId);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/truth/trends/:workId/:metric
router.get('/trends/:workId/:metric', async (req, res) => {
  try {
    const { metric } = req.params;
    const options = {
      fromChapter: parseInt(req.query.from) || 1,
      toChapter: parseInt(req.query.to) || undefined,
    };
    const trends = await truthManager.analyzeTrends(req.params.workId, metric, options);
    res.json({ success: true, trends });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/truth/anomalies/:workId
router.get('/anomalies/:workId', async (req, res) => {
  try {
    const anomalies = await truthManager.detectAnomalies(req.params.workId);
    res.json({ success: true, anomalies });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/truth/trace/:workId
router.get('/trace/:workId', async (req, res) => {
  try {
    const { subjectType, subjectId, from, to } = req.query;
    const changes = await truthManager.traceChanges(
      req.params.workId,
      subjectType,
      subjectId,
      parseInt(from) || 1,
      parseInt(to) || 9999
    );
    res.json({ success: true, changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
