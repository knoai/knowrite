/**
 * 输入治理路由：plan + compose API
 */

const express = require('express');
const inputGovernance = require('../services/input-governance');
const { AuthorIntent, CurrentFocus, ChapterIntent } = require('../models');
const { validateBody } = require('../middleware/validator');
const { authorIntentSchema, currentFocusSchema, updateFocusSchema, chapterIntentSchema } = require('../schemas/routes');

const router = express.Router();

// ===== AuthorIntent CRUD =====

// GET /api/input-governance/author-intent/:workId
router.get('/author-intent/:workId', async (req, res) => {
  try {
    const intent = await AuthorIntent.findOne({ where: { workId: req.params.workId } });
    if (!intent) return res.status(404).json({ error: 'Not found' });
    res.json(intent.toJSON());
  } catch (err) {
    console.error('GET author-intent error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/input-governance/author-intent/:workId
router.put('/author-intent/:workId', validateBody(authorIntentSchema), async (req, res) => {
  try {
    const data = {
      workId: req.params.workId,
      ...req.body,
      updatedAt: new Date(),
    };
    const [instance, created] = await AuthorIntent.upsert(data);
    res.json({ ...instance.toJSON(), created });
  } catch (err) {
    console.error('PUT author-intent error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===== CurrentFocus CRUD =====

// GET /api/input-governance/current-focus/:workId
router.get('/current-focus/:workId', async (req, res) => {
  try {
    const focuses = await CurrentFocus.findAll({
      where: { workId: req.params.workId },
      order: [['priority', 'DESC'], ['createdAt', 'DESC']],
    });
    res.json(focuses.map((f) => f.toJSON()));
  } catch (err) {
    console.error('GET current-focus error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/input-governance/current-focus/:workId
router.post('/current-focus/:workId', validateBody(currentFocusSchema), async (req, res) => {
  try {
    const focus = await CurrentFocus.create({
      workId: req.params.workId,
      ...req.body,
    });
    res.json(focus.toJSON());
  } catch (err) {
    console.error('POST current-focus error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/input-governance/current-focus/:focusId
router.put('/current-focus/:focusId', validateBody(updateFocusSchema), async (req, res) => {
  try {
    const focus = await CurrentFocus.findByPk(req.params.focusId);
    if (!focus) return res.status(404).json({ error: 'Not found' });
    await focus.update(req.body);
    res.json(focus.toJSON());
  } catch (err) {
    console.error('PUT current-focus error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/input-governance/current-focus/:focusId
router.delete('/current-focus/:focusId', async (req, res) => {
  try {
    const focus = await CurrentFocus.findByPk(req.params.focusId);
    if (!focus) return res.status(404).json({ error: 'Not found' });
    await focus.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE current-focus error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===== ChapterIntent =====

// GET /api/input-governance/chapter-intent/:workId/:chapterNumber
router.get('/chapter-intent/:workId/:chapterNumber', async (req, res) => {
  try {
    const intent = await ChapterIntent.findOne({
      where: { workId: req.params.workId, chapterNumber: parseInt(req.params.chapterNumber, 10) },
    });
    if (!intent) return res.status(404).json({ error: 'Not found' });
    res.json(intent.toJSON());
  } catch (err) {
    console.error('GET chapter-intent error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/input-governance/chapter-intent/:workId/:chapterNumber
router.put('/chapter-intent/:workId/:chapterNumber', validateBody(chapterIntentSchema), async (req, res) => {
  try {
    const data = {
      workId: req.params.workId,
      chapterNumber: parseInt(req.params.chapterNumber, 10),
      ...req.body,
    };
    const [instance, created] = await ChapterIntent.upsert(data);
    res.json({ ...instance.toJSON(), created });
  } catch (err) {
    console.error('PUT chapter-intent error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===== Plan + Compose Actions =====

// POST /api/input-governance/plan/:workId/:chapterNumber
router.post('/plan/:workId/:chapterNumber', async (req, res) => {
  try {
    const intent = await inputGovernance.planChapter(
      req.params.workId,
      parseInt(req.params.chapterNumber, 10)
    );
    res.json(intent);
  } catch (err) {
    console.error('POST plan error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/input-governance/compose/:workId/:chapterNumber
router.post('/compose/:workId/:chapterNumber', async (req, res) => {
  try {
    const composed = await inputGovernance.composeChapter(
      req.params.workId,
      parseInt(req.params.chapterNumber, 10)
    );
    res.json(composed);
  } catch (err) {
    console.error('POST compose error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/input-governance/governance-variables/:workId/:chapterNumber
router.get('/governance-variables/:workId/:chapterNumber', async (req, res) => {
  try {
    const vars = await inputGovernance.getGovernanceVariables(
      req.params.workId,
      parseInt(req.params.chapterNumber, 10)
    );
    res.json(vars);
  } catch (err) {
    console.error('GET governance-variables error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
