const express = require('express');
const router = express.Router({ mergeParams: true });
const voiceFingerprint = require('../services/voice-fingerprint');

// GET /api/novel/works/:workId/voice-fingerprints
router.get('/', async (req, res) => {
  try {
    const prompt = await voiceFingerprint.getVoiceFingerprintPrompt(req.params.workId);
    res.json({ success: true, prompt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/novel/works/:workId/voice-fingerprints/extract
router.post('/extract', async (req, res) => {
  try {
    const { chapterNumber, chapterText } = req.body;
    const results = await voiceFingerprint.extractFromChapter(
      req.params.workId,
      chapterNumber,
      chapterText
    );
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
