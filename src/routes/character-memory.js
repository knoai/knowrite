const express = require('express');
const router = express.Router({ mergeParams: true });
const characterMemory = require('../services/character-memory');

// GET /api/novel/works/:workId/character-memories
router.get('/', async (req, res) => {
  try {
    const prompt = await characterMemory.getCharacterMemoryPrompt(req.params.workId, [], null);
    res.json({ success: true, prompt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/novel/works/:workId/character-memories/extract
router.post('/extract', async (req, res) => {
  try {
    const { chapterNumber, summaryText } = req.body;
    const results = await characterMemory.extractEpisodesFromSummary(
      req.params.workId,
      chapterNumber,
      summaryText
    );
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/novel/works/:workId/character-memories/:charName/file
router.get('/:charName/file', async (req, res) => {
  try {
    const content = await characterMemory.buildCharacterMemoryFile(
      req.params.workId,
      req.params.charName
    );
    res.json({ success: true, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
