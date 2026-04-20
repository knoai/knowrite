const express = require('express');
const router = express.Router();
const skillExtractor = require('../services/skill-extractor');

// GET /api/skills
router.get('/', async (req, res) => {
  try {
    const skills = await skillExtractor.getMatchingSkills(req.query.workId);
    res.json({ success: true, skills });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/skills/extract/:workId
router.post('/extract/:workId', async (req, res) => {
  try {
    const { minFitness, minConsecutive, model } = req.body;
    const result = await skillExtractor.triggerSkillExtraction(req.params.workId, {
      minFitness,
      minConsecutive,
      model,
    });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/skills/injection/:workId
router.get('/injection/:workId', async (req, res) => {
  try {
    const injection = await skillExtractor.buildSkillInjection(req.params.workId);
    res.json({ success: true, injection });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
