/**
 * Trace 查询服务
 * 从 fileStore 读取 JSONL 格式的 trace 记录，提供查询和统计接口
 */

const { listFiles, readFile } = require('./file-store');

const TRACE_PREFIX = 'traces/';
const TRACE_SUFFIX = '.jsonl';

async function getAllTraces(workId) {
  const files = await listFiles(workId, TRACE_PREFIX);
  const traces = [];
  for (const filename of files) {
    if (!filename.endsWith(TRACE_SUFFIX)) continue;
    const raw = await readFile(workId, filename);
    if (!raw) continue;
    const agentType = filename
      .replace(TRACE_PREFIX, '')
      .replace(TRACE_SUFFIX, '');
    const lines = raw.split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        record.agentType = record.agentType || agentType;
        traces.push(record);
      } catch (err) {
        // skip malformed line
      }
    }
  }
  // 按时间排序
  traces.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  return traces;
}

/**
 * 查询 trace 记录
 * @param {string} workId
 * @param {object} opts
 * @param {string} [opts.agentType]
 * @param {Date|null} [opts.timeRangeStart]
 * @param {Date|null} [opts.timeRangeEnd]
 * @param {number} [opts.limit=50]
 * @param {number} [opts.offset=0]
 */
async function queryTraces(workId, opts = {}) {
  const { agentType, timeRangeStart, timeRangeEnd, limit = 50, offset = 0 } = opts;
  let traces = await getAllTraces(workId);

  if (agentType) {
    traces = traces.filter(t => t.agentType === agentType);
  }
  if (timeRangeStart) {
    traces = traces.filter(t => new Date(t.timestamp) >= timeRangeStart);
  }
  if (timeRangeEnd) {
    traces = traces.filter(t => new Date(t.timestamp) <= timeRangeEnd);
  }

  const total = traces.length;
  const rows = traces.slice(offset, offset + limit);
  return { total, rows };
}

/**
 * 获取各 Agent 的调用统计
 */
async function getTraceStats(workId) {
  const traces = await getAllTraces(workId);
  const stats = {};
  for (const t of traces) {
    const type = t.agentType || 'unknown';
    if (!stats[type]) {
      stats[type] = { count: 0, totalChars: 0, totalDurationMs: 0, avgDurationMs: 0 };
    }
    const s = stats[type];
    s.count += 1;
    s.totalChars += t.chars || 0;
    s.totalDurationMs += t.durationMs || 0;
  }
  for (const type of Object.keys(stats)) {
    const s = stats[type];
    s.avgDurationMs = s.count > 0 ? Math.round(s.totalDurationMs / s.count) : 0;
  }
  return stats;
}

/**
 * 获取按时间排序的调用链
 * @param {string} workId
 * @param {number|null} chapterNumber — 目前 trace 中不含 chapterNumber，传 null 返回全部
 */
async function getTimeline(workId, chapterNumber = null) {
  const traces = await getAllTraces(workId);
  // 如果将来 trace 中有 chapterNumber 可以过滤，目前返回全部
  if (chapterNumber != null) {
    // agentType key 中可能包含章节号如 writer_5（但目前 trace 中不包含）
    // 暂时返回全部，前端可按需过滤
  }
  return traces.map((t, idx) => ({
    step: idx + 1,
    timestamp: t.timestamp,
    agentType: t.agentType,
    promptTemplate: t.promptTemplate,
    model: t.model,
    provider: t.provider,
    chars: t.chars,
    durationMs: t.durationMs,
  }));
}

/**
 * 获取单个 Agent 的 trace 列表
 */
async function getAgentTraces(workId, agentType, limit = 100) {
  const traces = await getAllTraces(workId);
  const filtered = traces.filter(t => t.agentType === agentType);
  return filtered.slice(-limit);
}

module.exports = {
  queryTraces,
  getTraceStats,
  getTimeline,
  getAgentTraces,
};
