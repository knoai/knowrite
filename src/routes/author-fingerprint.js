const express = require('express');
const router = express.Router();
const styleService = require('../services/author-fingerprint');
const { AuthorFingerprint, WorkStyleLink } = require('../models');
const { validateBody } = require('../middleware/validator');
const { analyzeFingerprintSchema, importStyleSchema, validateStyleSchema } = require('../schemas/routes');

// POST /api/style/analyze
router.post('/analyze', validateBody(analyzeFingerprintSchema), async (req, res) => {
  try {
    const { text, name, description } = req.validatedBody;
    const fingerprint = await styleService.analyzeFullFingerprint(text, name, description);
    res.json({ success: true, fingerprint });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/style/fingerprints
router.get('/fingerprints', async (req, res) => {
  try {
    const fingerprints = await AuthorFingerprint.findAll({ order: [['createdAt', 'DESC']] });
    res.json({ success: true, fingerprints });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/style/import/:workId
router.post('/import/:workId', validateBody(importStyleSchema), async (req, res) => {
  try {
    const { fingerprintId, priority } = req.body;
    const link = await styleService.importStyle(fingerprintId, req.params.workId, priority);
    res.json({ success: true, link });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/style/work/:workId
router.get('/work/:workId', async (req, res) => {
  try {
    const fingerprints = await styleService.getActiveFingerprints(req.params.workId);
    res.json({ success: true, fingerprints });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/style/work/:workId/:fingerprintId
router.delete('/work/:workId/:fingerprintId', async (req, res) => {
  try {
    await WorkStyleLink.update(
      { isActive: false },
      { where: { workId: req.params.workId, fingerprintId: req.params.fingerprintId } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/style/validate/:workId
router.post('/validate/:workId', validateBody(validateStyleSchema), async (req, res) => {
  try {
    const { chapterText, fingerprintId } = req.body;
    const result = await styleService.validateAgainstFingerprint(req.params.workId, chapterText, fingerprintId);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
