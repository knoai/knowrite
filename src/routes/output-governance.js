const express = require('express');
const router = express.Router();
const outputGov = require('../services/output-governance');
const { OutputQueue, OutputValidationRule } = require('../models');

// GET /api/output/queue/:workId
router.get('/queue/:workId', async (req, res) => {
  try {
    const items = await outputGov.getQueueForWork(req.params.workId);
    res.json({ success: true, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/output/review/:queueId
router.post('/review/:queueId', async (req, res) => {
  try {
    const { decision, notes } = req.body;
    if (!['approve', 'reject', 'revise'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be approve/reject/revise' });
    }
    const item = await outputGov.submitHumanReview(req.params.queueId, decision, notes);
    res.json({ success: true, item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/output/rules
router.get('/rules', async (req, res) => {
  try {
    const rules = await OutputValidationRule.findAll({ order: [['level', 'ASC']] });
    res.json({ success: true, rules });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/output/rules
router.post('/rules', async (req, res) => {
  try {
    const rule = await OutputValidationRule.create(req.body);
    res.json({ success: true, rule });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/output/rules/:ruleId
router.put('/rules/:ruleId', async (req, res) => {
  try {
    await OutputValidationRule.update(req.body, { where: { id: req.params.ruleId } });
    const rule = await OutputValidationRule.findByPk(req.params.ruleId);
    res.json({ success: true, rule });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/output/rules/:ruleId
router.delete('/rules/:ruleId', async (req, res) => {
  try {
    await OutputValidationRule.destroy({ where: { id: req.params.ruleId } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
