const express = require('express');
const router = express.Router();
const chatAgent = require('../services/chat-agent');

// SSE helper
function sse(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  let ended = false;
  return {
    send: (data) => {
      if (ended) return;
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        if (res.flush) res.flush();
      } catch (writeErr) {
        console.error('[sse] write error:', writeErr.message);
        ended = true;
      }
    },
    end: () => {
      if (ended) return;
      ended = true;
      try { res.end(); } catch (e) { /* ignore */ }
    },
  };
}

// POST /api/chat-agent/works/:workId
// 对话式创作：续写、修改、查询
router.post('/works/:workId', async (req, res) => {
  const { messages = [], model } = req.body || {};
  const { workId } = req.params;

  if (!messages.length) {
    return res.status(400).json({ error: 'messages 不能为空' });
  }

  const stream = sse(res);

  try {
    const result = await chatAgent.chat(workId, messages, {
      model,
      callbacks: {
        onStepStart: (step) => {
          stream.send({ type: 'stepStart', ...step });
        },
        onChunk: (step, chunk) => {
          stream.send({ type: 'chunk', step, chunk });
        },
        onStepEnd: (step, meta) => {
          stream.send({ type: 'stepEnd', step, ...meta });
        },
      },
    });

    stream.send({
      type: 'done',
      content: result.content,
      actions: result.actions,
      chars: result.chars,
      durationMs: result.durationMs,
    });
    stream.end();
  } catch (err) {
    console.error('[chat-agent] 对话失败:', err.message);
    stream.send({ type: 'error', message: err.message });
    stream.end();
  }
});

// POST /api/chat-agent/works/:workId/continue
// 快捷续写下一章
router.post('/works/:workId/continue', async (req, res) => {
  const { model } = req.body || {};
  const { workId } = req.params;

  const stream = sse(res);

  try {
    const result = await chatAgent.continueNextChapter(workId, {
      model,
      callbacks: {
        onStepStart: (step) => stream.send({ type: 'stepStart', ...step }),
        onChunk: (step, chunk) => stream.send({ type: 'chunk', step, chunk }),
        onStepEnd: (step, meta) => stream.send({ type: 'stepEnd', step, ...meta }),
      },
    });

    stream.send({
      type: 'done',
      content: result.content,
      actions: result.actions,
      chars: result.chars,
      durationMs: result.durationMs,
    });
    stream.end();
  } catch (err) {
    console.error('[chat-agent] 续写失败:', err.message);
    stream.send({ type: 'error', message: err.message });
    stream.end();
  }
});

// POST /api/chat-agent/works/:workId/edit-chapter/:chapterNumber
// 快捷修改指定章节
router.post('/works/:workId/edit-chapter/:chapterNumber', async (req, res) => {
  const { instruction, model } = req.body || {};
  const { workId, chapterNumber } = req.params;

  if (!instruction) {
    return res.status(400).json({ error: '缺少 instruction（修改指令）' });
  }

  const stream = sse(res);

  try {
    const result = await chatAgent.editChapter(workId, parseInt(chapterNumber, 10), instruction, {
      model,
      callbacks: {
        onStepStart: (step) => stream.send({ type: 'stepStart', ...step }),
        onChunk: (step, chunk) => stream.send({ type: 'chunk', step, chunk }),
        onStepEnd: (step, meta) => stream.send({ type: 'stepEnd', step, ...meta }),
      },
    });

    stream.send({
      type: 'done',
      content: result.content,
      actions: result.actions,
      chars: result.chars,
      durationMs: result.durationMs,
    });
    stream.end();
  } catch (err) {
    console.error('[chat-agent] 修改失败:', err.message);
    stream.send({ type: 'error', message: err.message });
    stream.end();
  }
});

module.exports = router;
