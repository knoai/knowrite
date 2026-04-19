/**
 * 大纲偏离检测模块
 * 从 novel-engine.js 提取，避免循环依赖
 */

const { runStreamChat } = require('../core/chat');
const { resolveRoleModelConfig } = require('./settings-store');
const outlineGenerator = require('./novel/outline-generator');
const engineCfg = require('../../config/engine.json');

const { initDb, Work, Volume, Chapter } = require('../models');

async function loadMeta(workId) {
  await initDb();
  const work = await Work.findByPk(workId, {
    include: [
      { model: Volume, as: 'volumes' },
      { model: Chapter, as: 'chapters' },
    ],
  });
  if (!work) return null;
  const plain = work.toJSON();
  return {
    ...plain,
    volumes: (plain.volumes || []).sort((a, b) => a.number - b.number),
    chapters: (plain.chapters || []).sort((a, b) => a.number - b.number),
  };
}

async function detectOutlineDeviation(workId, chapterNumber, text, model) {
  const meta = await loadMeta(workId);
  if (!meta) throw new Error('作品不存在');
  const outline = await outlineGenerator.getCurrentVolumeOutline(workId, meta);
  const prompt = `你是一位资深编辑，请判断以下第${chapterNumber}章正文是否偏离了给定大纲。\n\n大纲：\n${outline}\n\n正文：\n${text.substring(0, engineCfg.truncation.deviationCheckText)}\n\n请输出 JSON：\n{"severity": "low/medium/high", "reason": "...", "suggestions": ["..."]}`;
  const result = await runStreamChat([{ role: 'user', content: prompt }], await resolveRoleModelConfig('deviationCheck', model), {});
  let json = null;
  try {
    json = JSON.parse(result.content.replace(/```json\s*/i, '').replace(/```\s*$/m, '').trim());
  } catch {
    try {
      const m = result.content.match(/\{[\s\S]*\}/);
      if (m) json = JSON.parse(m[0]);
    } catch (err) {
      console.error('[outline-deviation] 偏离检测结果解析失败:', err.message);
    }
  }
  if (!json) {
    json = { severity: 'low', reason: '无法判断', suggestions: [] };
  }
  return json;
}

module.exports = {
  detectOutlineDeviation,
};
