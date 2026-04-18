/**
 * 大纲生成模块
 * 负责主题大纲、详细纲章、多卷大纲、分卷大纲的生成
 */

const { loadPrompt } = require('../prompt-loader');
const { runStreamChat } = require('../../core/chat');
const { getWorldContextForPrompt } = require('../world-context');
const { resolveRoleModelConfig } = require('../settings-store');
const { readFile } = require('../novel-engine');

async function getChapterWordVariables() {
  return { targetWords: 3000, minWords: 2500, maxWords: 3500 };
}

async function expandStyle(platformStyle, authorStyle) {
  if (!platformStyle && !authorStyle) return '';
  const parts = [];
  if (platformStyle) parts.push(`平台：${platformStyle}`);
  if (authorStyle) parts.push(`作者：${authorStyle}`);
  return parts.join('，');
}

function isMultivolumeStrategy(strategy) {
  return strategy && (strategy.includes('multivolume') || strategy === 'mv');
}

async function getCurrentVolumeOutline(workId, meta) {
  if (!isMultivolumeStrategy(meta.strategy)) return meta.outlineDetailed || '';
  const currentVolume = meta.currentVolume || 1;
  const volOutline = await readFile(workId, `volume_${currentVolume}_outline.txt`);
  if (volOutline) return volOutline;
  return meta.outlineDetailed || '';
}

async function generateOutline(topic, style, model, callbacks, workId = null) {
  const wordVars = await getChapterWordVariables();
  let prompt = await loadPrompt('outline-theme', { topic, style: await expandStyle(style), ...wordVars });
  if (workId) {
    const worldCtx = await getWorldContextForPrompt(workId);
    if (worldCtx) prompt += '\n\n【世界观上下文】\n' + worldCtx;
  }
  return runStreamChat([{ role: 'user', content: prompt }], await resolveRoleModelConfig('outline', model), callbacks || {});
}

async function generateDetailedOutline(topic, style, outlineTheme, model, callbacks, workId = null) {
  const wordVars = await getChapterWordVariables();
  let prompt = await loadPrompt('outline-detailed', { topic, style: await expandStyle(style), outlineTheme, ...wordVars });
  if (workId) {
    const worldCtx = await getWorldContextForPrompt(workId);
    if (worldCtx) prompt += '\n\n【世界观上下文】\n' + worldCtx;
  }
  return runStreamChat([{ role: 'user', content: prompt }], await resolveRoleModelConfig('outline', model), callbacks || {});
}

async function generateMultivolumeOutline(topic, style, outlineDetailed, totalVolumes, model, callbacks, workId = null) {
  const wordVars = await getChapterWordVariables();
  let prompt = await loadPrompt('outline-multivolume', {
    topic,
    style: await expandStyle(style),
    outlineDetailed,
    totalVolumes,
    ...wordVars,
  });
  if (workId) {
    const worldCtx = await getWorldContextForPrompt(workId);
    if (worldCtx) prompt += '\n\n【世界观上下文】\n' + worldCtx;
  }
  return runStreamChat([{ role: 'user', content: prompt }], await resolveRoleModelConfig('outline', model), callbacks || {});
}

async function generateVolumeOutline(topic, style, outlineMultivolume, volumeNumber, model, callbacks, workId = null) {
  const wordVars = await getChapterWordVariables();
  let prompt = await loadPrompt('volume-outline', {
    topic,
    style: await expandStyle(style),
    ...wordVars,
    outlineMultivolume,
    volumeNumber,
  });
  if (workId) {
    const worldCtx = await getWorldContextForPrompt(workId);
    if (worldCtx) prompt += '\n\n【世界观上下文】\n' + worldCtx;
  }
  return runStreamChat([{ role: 'user', content: prompt }], await resolveRoleModelConfig('outline', model), callbacks || {});
}

module.exports = {
  isMultivolumeStrategy,
  getCurrentVolumeOutline,
  generateOutline,
  generateDetailedOutline,
  generateMultivolumeOutline,
  generateVolumeOutline,
};
