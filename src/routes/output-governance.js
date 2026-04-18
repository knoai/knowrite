const express = require('express');
const router = express.Router();
const outputGov = require('../services/output-governance');
const { OutputQueue, OutputValidationRule } = require('../models');
const { validateBody } = require('../middleware/validator');
const { humanReviewSchema, createRuleSchema, updateRuleSchema } = require('../schemas/routes');

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
router.post('/review/:queueId', validateBody(humanReviewSchema), async (req, res) => {
  try {
    const { decision, notes } = req.validatedBody;
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
router.post('/rules', validateBody(createRuleSchema), async (req, res) => {
  try {
    const rule = await OutputValidationRule.create(req.body);
    res.json({ success: true, rule });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/output/rules/:ruleId
router.put('/rules/:ruleId', validateBody(updateRuleSchema), async (req, res) => {
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
