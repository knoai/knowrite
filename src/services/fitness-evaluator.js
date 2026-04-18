/**
 * Fitness 评估器
 * 将章节的多维质量信号压缩为一个 0-1 的综合得分
 */

const fs = require('fs');
const path = require('path');
const { getWorkDir } = require('../core/paths');
const fileStore = require('./file-store');
const { getChapterConfig, getWritingMode, resolveRoleModelConfig } = require('./settings-store');
const fitnessCfg = require('../../config/fitness.json');

function gaussianScore(actual, target, sigma) {
  return Math.exp(-Math.pow(actual - target, 2) / (2 * Math.pow(sigma, 2)));
}

function averageReviewScore(reviews) {
  if (!reviews || reviews.length === 0) return 0.5;
  let total = 0;
  let count = 0;
  for (const r of reviews) {
    const scores = r.parsed?.scores || {};
    for (const dim of Object.values(scores)) {
      if (dim && typeof dim.score === 'number') {
        total += dim.score;
        count++;
      }
    }
  }
  if (count === 0) return 0.5;
  return total / count / 10; // normalize to 0-1
}

async function loadRepetitionResult(workId, chapterNumber) {
  const content = await fileStore.readFile(workId, `chapter_${chapterNumber}_repetition.json`);
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch (err) {
    console.error(`[fitness] 重复检查结果解析失败 chapter_${chapterNumber}:`, err.message);
    return null;
  }
}

async function loadReviewResult(workId, chapterNumber) {
  const reviewDir = path.join(getWorkDir(workId), `review_chapter_${chapterNumber}`);
  try {
    await fs.promises.access(reviewDir);
  } catch {
    return null;
  }
  const files = (await fs.promises.readdir(reviewDir)).filter(f => f.startsWith('round_') && f.endsWith('.json')).sort();
  if (files.length === 0) return null;
  try {
    const content = await fs.promises.readFile(path.join(reviewDir, files[files.length - 1]), 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`[fitness] 评审结果解析失败 chapter_${chapterNumber}:`, err.message);
    return null;
  }
}

async function loadReaderFeedback(workId, chapterNumber) {
  const content = await fileStore.readFile(workId, `chapter_${chapterNumber}_feedback.json`);
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch (err) {
    console.error(`[fitness] 读者反馈解析失败 chapter_${chapterNumber}:`, err.message);
    return null;
  }
}

/**
 * 计算单章 Fitness
 * @param {string} workId
 * @param {number} chapterNumber
 * @param {number} chars - 章节字数
 * @returns {{score: number, breakdown: Object}}
 */
async function evaluateChapterFitness(workId, chapterNumber, chars) {
  const isFree = (await getWritingMode(workId)) === 'free';
  const weights = isFree ? fitnessCfg.weights.free : fitnessCfg.weights.industrial;

  const chapterCfg = await getChapterConfig();
  const targetWords = chapterCfg.targetWords || 2000;
  const cfg = fitnessCfg.scoring;
  const sigma = isFree
    ? Math.max(cfg.wordCountSigmaMaxMin, Math.round(targetWords * cfg.wordCountSigmaMaxFactor))
    : Math.max(cfg.wordCountSigmaMin, Math.round(targetWords * cfg.wordCountSigmaFactor));
  const wordScore = gaussianScore(chars, targetWords, sigma);

  const repResult = await loadRepetitionResult(workId, chapterNumber);
  let repScore = 1;
  if (repResult) {
    const sevMap = fitnessCfg.scoring.repetitionSeverity;
    repScore = sevMap[repResult.severity] ?? sevMap.none;
    if (repResult.repetitive === false) repScore = sevMap.none;
  }

  const reviewResult = await loadReviewResult(workId, chapterNumber);
  let reviewScore = fitnessCfg.scoring.defaultReviewScore;
  if (reviewResult) {
    reviewScore = reviewResult.passed ? averageReviewScore(reviewResult.reviews) : 0.3;
  }

  const readerResult = await loadReaderFeedback(workId, chapterNumber);
  let readerScore = 0.5;
  if (readerResult) {
    const defaultSub = fitnessCfg.scoring.defaultReaderSubScore;
    const readability = readerResult.readability?.score || defaultSub;
    const anticipation = readerResult.anticipation?.score || defaultSub;
    const painPenalty = (readerResult.pain_points && readerResult.pain_points !== '无') ? fitnessCfg.scoring.painPenalty : 0;
    readerScore = ((readability + anticipation) / 20) - painPenalty;
    readerScore = Math.max(0, Math.min(1, readerScore));
  }

  // coherence：通过大纲偏离检测评估情节连贯性
  let coherenceScore = wordScore;
  try {
    const chapterText = await fileStore.readFile(workId, `chapter_${chapterNumber}_final.txt`)
      || await fileStore.readFile(workId, `chapter_${chapterNumber}_polish.txt`)
      || '';
    if (chapterText) {
      const { detectOutlineDeviation } = require('./novel-engine');
      const outlineModel = await resolveRoleModelConfig('outline');
      const devResult = await detectOutlineDeviation(workId, chapterNumber, chapterText, outlineModel.model);
      const sevMap = { low: 1.0, medium: 0.6, high: 0.3 };
      coherenceScore = sevMap[devResult.severity] ?? wordScore;
    }
  } catch (err) {
    console.error('[fitness] 偏离检测失败，回退到字数代理:', err.message);
  }

  const score =
    weights.wordCount * wordScore +
    weights.repetition * repScore +
    weights.review * reviewScore +
    weights.reader * readerScore +
    weights.coherence * coherenceScore;

  return {
    score: Math.max(0, Math.min(1, parseFloat(score.toFixed(4)))),
    breakdown: {
      wordScore: parseFloat(wordScore.toFixed(4)),
      repScore,
      reviewScore: parseFloat(reviewScore.toFixed(4)),
      readerScore: parseFloat(readerScore.toFixed(4)),
      coherenceScore: parseFloat(coherenceScore.toFixed(4)),
    },
    sources: {
      repetition: !!repResult,
      review: !!reviewResult,
      reader: !!readerResult,
    },
  };
}

async function saveFitness(workId, chapterNumber, fitness) {
  const data = JSON.stringify({ ...fitness, evaluatedAt: new Date().toISOString() }, null, 2);
  await fileStore.writeFile(workId, `chapter_${chapterNumber}_fitness.json`, data);
  // 保留本地备份
  const p = path.join(getWorkDir(workId), `chapter_${chapterNumber}_fitness.json`);
  await fs.promises.writeFile(p, data, 'utf-8');
}

async function loadFitness(workId, chapterNumber) {
  const content = await fileStore.readFile(workId, `chapter_${chapterNumber}_fitness.json`);
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch (err) {
    console.error(`[fitness] Fitness 数据解析失败 chapter_${chapterNumber}:`, err.message);
    return null;
  }
}

module.exports = {
  evaluateChapterFitness,
  saveFitness,
  loadFitness,
};
