/**
 * Context Builder — 智能上下文构建
 *
 * 从 novel-engine.js 提取，负责：
 * - 滚动上下文（Rolling Context）：近史保留、远史压缩
 * - 智能上下文（Smart Context）：RAG + 反重复 + 时间窗口
 */

const { readFile, writeFile } = require('../file-store');
const { loadPrompt } = require('../prompt-loader');
const { runStreamChat } = require('../../core/chat');
const { resolveRoleModelConfig } = require('../settings-store');
const { buildAntiRepetitionReminder } = require('../memory-index');
const { buildRagContext } = require('../rag-retriever');
const { getWorldContextForPrompt } = require('../world-context');

const engineCfg = require('../../../config/engine.json');
const SUMMARY_WINDOW_SIZE = engineCfg.context.summaryWindowSize;
const FULL_TEXT_THRESHOLD = engineCfg.context.fullTextThreshold;

/**
 * 压缩单章文本为摘要（带缓存）
 */
async function compressChapterText(workId, chapterNumber, text, model, callbacks) {
  const cacheFile = `chapter_${chapterNumber}_compressed.txt`;
  const cached = await readFile(workId, cacheFile);
  if (cached) return cached;

  const prompt = await loadPrompt('compress-chapter', { text });
  const result = await runStreamChat(
    [{ role: 'user', content: prompt }],
    await resolveRoleModelConfig('summarizer', model),
    callbacks || {}
  );
  await writeFile(workId, cacheFile, result.content);
  return result.content;
}

/**
 * 压缩远史摘要（带缓存）
 */
async function compressDistantSummaries(workId, start, end, model, callbacks) {
  const cacheFile = `context_distant_summary_${start}_${end}.txt`;
  const cached = await readFile(workId, cacheFile);
  if (cached) return cached;

  const summaries = [];
  for (let i = start; i <= end; i++) {
    const s = await readFile(workId, `chapter_${i}_summary.txt`);
    if (s) summaries.push(`第${i}章：${s}`);
  }
  if (summaries.length === 0) return '';

  const prompt = await loadPrompt('compress-distant', {
    start,
    end,
    summaries: summaries.join('\n'),
  });
  const result = await runStreamChat(
    [{ role: 'user', content: prompt }],
    await resolveRoleModelConfig('summarizer', model),
    callbacks || {}
  );
  await writeFile(workId, cacheFile, result.content);
  return result.content;
}

/**
 * 构建滚动上下文：近史保留全文/摘要，远史压缩
 */
async function buildRollingContext(workId, meta, nextNumber, models, callbacks) {
  const contextParts = [];
  const isMultiAgent = meta.strategy === 'knowrite';
  const prevFile = isMultiAgent
    ? `chapter_${nextNumber - 1}_final.txt`
    : `chapter_${nextNumber - 1}_polish.txt`;
  const compressModel = models?.summarizer || models?.writer || 'deepseek-v3';

  // 1. 前1章：前 FULL_TEXT_THRESHOLD 章保留全文，之后压缩
  if (nextNumber > 1) {
    const prevFull = await readFile(workId, prevFile);
    if (prevFull) {
      if (nextNumber - 1 <= FULL_TEXT_THRESHOLD) {
        contextParts.push(`【第${nextNumber - 1}章 全文】\n${prevFull}`);
      } else {
        const compressed = await compressChapterText(
          workId,
          nextNumber - 1,
          prevFull,
          compressModel,
          {
            onChunk: (chunk) => {
              if (callbacks?.onChunk) callbacks.onChunk(`compress_${nextNumber - 1}`, chunk);
            },
          }
        );
        contextParts.push(`【第${nextNumber - 1}章 压缩提要】\n${compressed}`);
      }
    }
  }

  // 2. 近史摘要：保留最近 SUMMARY_WINDOW_SIZE 章
  const nearStart = Math.max(1, nextNumber - 1 - SUMMARY_WINDOW_SIZE);
  for (let i = nearStart; i < nextNumber - 1; i++) {
    const summary = await readFile(workId, `chapter_${i}_summary.txt`);
    if (summary) {
      contextParts.push(`【第${i}章 摘要】\n${summary}`);
    }
  }

  // 3. 远史摘要：更早的章节合并压缩
  if (nearStart > 1) {
    const distant = await compressDistantSummaries(
      workId,
      1,
      nearStart - 1,
      compressModel,
      {
        onChunk: (chunk) => {
          if (callbacks?.onChunk) callbacks.onChunk('distant_summary', chunk);
        },
      }
    );
    if (distant) {
      contextParts.unshift(`【远史提要 第1-${nearStart - 1}章】\n${distant}`);
    }
  }

  return contextParts.join('\n\n');
}

/**
 * 构建智能上下文：时间窗口 + 反重复 + RAG
 */
async function buildSmartContext(workId, meta, nextNumber, models, callbacks) {
  const timeWindow = await buildRollingContext(workId, meta, nextNumber, models, callbacks);

  // 读取当前卷纲章
  const currentVolume = meta.currentVolume || 1;
  let volumeOutline = await readFile(workId, `volume_${currentVolume}_outline.txt`);

  const windowStart = Math.max(1, nextNumber - 1 - SUMMARY_WINDOW_SIZE);
  const windowEnd = nextNumber - 1;

  const antiRepeat = await buildAntiRepetitionReminder(
    workId,
    volumeOutline,
    windowStart,
    windowEnd
  );

  // RAG 检索：基于当前卷纲章检索最相关的历史上下文
  let ragContext = '';
  try {
    ragContext = await buildRagContext(
      workId,
      volumeOutline || meta.outlineDetailed || '',
      nextNumber
    );
  } catch (err) {
    console.error('[context-builder] RAG 检索失败:', err.message);
  }

  return {
    timeWindow,
    antiRepeat,
    ragContext,
    fullContext: timeWindow + antiRepeat + ragContext,
  };
}

module.exports = {
  compressChapterText,
  compressDistantSummaries,
  buildRollingContext,
  buildSmartContext,
};
