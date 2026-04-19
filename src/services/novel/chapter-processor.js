/**
 * Chapter Processor — 章节后处理
 *
 * 从 novel-engine.js 提取，负责：
 * - 生成章节摘要
 * - 读者反馈生成
 * - Fitness 评估
 * - Truth Delta 提取
 */

const { loadPrompt } = require('../prompt-loader');
const { runStreamChat } = require('../../core/chat');
const { resolveRoleModelConfig } = require('../settings-store');
const { expandStyle } = require('./novel-utils');

const engineCfg = require('../../../config/engine.json');

async function generateChapterSummary(chapterContent, style, model, callbacks) {
  const prompt = await loadPrompt('summary', {
    style: await expandStyle(style),
    chapterContent: chapterContent.substring(0, engineCfg.truncation.chapterContentPreview),
  });
  return runStreamChat(
    [{ role: 'user', content: prompt }],
    await resolveRoleModelConfig('summarizer', model),
    callbacks || {}
  );
}

async function runFitnessEvaluation(workId, chapterNumber, chars) {
  try {
    const { evaluateChapterFitness, saveFitness } = require('../fitness-evaluator');
    const { detectOutlineDeviation } = require('../outline-deviation');
    const fitness = await evaluateChapterFitness(workId, chapterNumber, chars, detectOutlineDeviation);
    await saveFitness(workId, chapterNumber, fitness);
    console.log(`[fitness] 第${chapterNumber}章 评估完成: ${fitness.score}`);
    return fitness;
  } catch (err) {
    console.error(`[fitness] 第${chapterNumber}章 评估失败:`, err.message);
    return null;
  }
}

async function generateReaderFeedback(chapterContent, style, model, callbacks) {
  const is10s = style.includes('10后');
  const extraDims = is10s
    ? `\n6. 中二燃度评分（1-10）及理由\n7. 梗密度是否合适（过多/过少/刚好）\n8. 是否希望立刻看到下一章（是/否）及原因`
    : '';
  const extraJson = is10s
    ? ', "chunibyo": {"score": 8, "reason": "..."}, "meme_density": "刚好", "immediate_next": {"want": true, "reason": "..."}'
    : '';

  const prompt = await loadPrompt('reader-feedback', {
    style: await expandStyle(style),
    chapterContent: chapterContent.substring(0, 3000),
    extraDims,
    extraJson,
  });

  return runStreamChat(
    [{ role: 'user', content: prompt }],
    await resolveRoleModelConfig('reader', model),
    callbacks || {}
  );
}

function extractTruthDeltaFromSummary(summaryContent, workId, chapterNumber) {
  // 尝试提取 JSON 代码块
  const jsonMatch = summaryContent.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    try {
      const delta = JSON.parse(jsonMatch[1]);
      if (
        delta &&
        (delta.characterChanges || delta.worldChanges || delta.newHooks || delta.newResources)
      ) {
        return delta;
      }
    } catch (err) {
      // JSON 解析失败，忽略
    }
  }

  // 尝试提取 summary 末尾的 JSON（无代码块格式）
  const lastBrace = summaryContent.lastIndexOf('}');
  const firstBrace = summaryContent.lastIndexOf('{', lastBrace);
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      const delta = JSON.parse(summaryContent.slice(firstBrace, lastBrace + 1));
      if (
        delta &&
        (delta.characterChanges || delta.worldChanges || delta.newHooks || delta.newResources)
      ) {
        return delta;
      }
    } catch (err) {
      // 忽略
    }
  }

  return null;
}

module.exports = {
  generateChapterSummary,
  runFitnessEvaluation,
  generateReaderFeedback,
  extractTruthDeltaFromSummary,
};
