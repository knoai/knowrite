/**
 * Trace 调试 API
 * 提供 LLM 调用历史的查询、统计、Timeline 接口
 */

const express = require('express');
const router = express.Router();
const { queryTraces, getTraceStats, getTimeline, getAgentTraces } = require('../services/trace-service');

// GET /api/traces/:workId
// Query: agentType, from, to, limit, offset
router.get('/:workId', async (req, res) => {
  try {
    const { workId } = req.params;
    const { agentType, from, to, limit = 50, offset = 0 } = req.query;
    const traces = await queryTraces(workId, {
      agentType,
      timeRangeStart: from ? new Date(from) : null,
      timeRangeEnd: to ? new Date(to) : null,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });
    res.json({ success: true, total: traces.total, data: traces.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/traces/:workId/stats
// 返回各 Agent 的调用统计
router.get('/:workId/stats', async (req, res) => {
  try {
    const stats = await getTraceStats(req.params.workId);
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/traces/:workId/timeline
// 返回按时间排序的调用链
router.get('/:workId/timeline', async (req, res) => {
  try {
    const { workId } = req.params;
    const { chapterNumber } = req.query;
    const timeline = await getTimeline(workId, chapterNumber ? parseInt(chapterNumber, 10) : null);
    res.json({ success: true, timeline });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/traces/:workId/agent/:agentType
// 返回单个 Agent 的 trace 列表
router.get('/:workId/agent/:agentType', async (req, res) => {
  try {
    const { workId, agentType } = req.params;
    const { limit = 100 } = req.query;
    const records = await getAgentTraces(workId, agentType, parseInt(limit, 10));
    res.json({ success: true, data: records });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
