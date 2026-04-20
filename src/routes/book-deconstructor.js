const express = require('express');
const router = express.Router();
const { deconstruct, createArtifacts } = require('../services/book-deconstructor');
const { validateBody } = require('../middleware/validator');
const { z } = require('zod');

const deconstructSchema = z.object({
  text: z.string().min(100, '文本太短，至少需要100字'),
  title: z.string().optional(),
  author: z.string().optional(),
  model: z.string().optional(),
  maxSampleChars: z.number().optional(),
});

const createArtifactsSchema = z.object({
  analysis: z.object({}),
  model: z.string().optional(),
});

// POST /api/book-deconstruct
router.post('/', validateBody(deconstructSchema), async (req, res) => {
  try {
    const { text, title, author, model, maxSampleChars } = req.body;
    const result = await deconstruct(text, {
      title,
      author,
      model,
      maxSampleChars,
    });
    res.json({ success: true, result });
  } catch (err) {
    console.error('[book-deconstruct] 拆书失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/book-deconstruct/artifacts
router.post('/artifacts', validateBody(createArtifactsSchema), async (req, res) => {
  try {
    const { analysis, model } = req.body;
    const artifacts = await createArtifacts(analysis, { model });
    res.json({ success: true, artifacts });
  } catch (err) {
    console.error('[book-deconstruct] 创建产物失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
