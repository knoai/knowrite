/**
 * Chapter Planner — 章节节拍规划
 *
 * 在 Writer 生成初稿前，先由 Planner Agent 生成本章的叙事节拍规划，
 * 作者确认后再执行完整写作流水线。
 */

const { runStreamChat } = require('../../core/chat');
const { loadPrompt } = require('../prompt-loader');
const { resolveRoleModelConfig, getConfig, expandStyle } = require('../settings-store');
const { getCurrentVolumeOutline } = require('./outline-generator');
const fileStore = require('../file-store');
const inputGovernance = require('../input-governance');

async function readPreviousSummary(workId, chapterNumber) {
  if (chapterNumber <= 1) return '';
  const summaries = [];
  for (let i = Math.max(1, chapterNumber - 3); i < chapterNumber; i++) {
    const s = await fileStore.readFile(workId, `chapter_${i}_summary.txt`);
    if (s) summaries.push(`第${i}章摘要：${s}`);
  }
  return summaries.join('\n');
}

async function getChapterTargetWords(workId) {
  const chapterCfg = await getConfig('engine').then(c => c.generation?.chapterWords);
  return chapterCfg || 2000;
}

function parsePlanOutput(content) {
  // 尝试提取 JSON 代码块
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : content;
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && Array.isArray(parsed.beats)) {
      return parsed;
    }
  } catch {
    // 回退：正则提取 beats
  }
  // 回退：返回简单结构
  return {
    beats: [{ type: 'auto', description: content.substring(0, 200) }],
    overallTone: '',
    riskFlags: [],
  };
}

async function planChapterBeats(workId, meta, chapterNumber, models, callbacks) {
  const engineCfg = await getConfig('engine');
  if (!engineCfg.pipeline?.plan?.enabled) {
    return null;
  }

  const outline = await getCurrentVolumeOutline(workId, meta);
  const prevSummary = await readPreviousSummary(workId, chapterNumber);
  const governanceVars = await inputGovernance.getGovernanceVariables(workId, chapterNumber);
  const style = meta.platformStyle + (meta.authorStyle ? '·' + meta.authorStyle : '');
  const targetWords = await getChapterTargetWords(workId);

  const prompt = await loadPrompt('chapter-plan', {
    outline,
    prevSummary,
    governanceVars,
    targetWords,
    style: await expandStyle(style),
    chapterNumber,
  });

  if (callbacks?.onStepStart) {
    callbacks.onStepStart({ key: `plan_${chapterNumber}`, name: `第${chapterNumber}章 节拍规划`, model: models.planner });
  }

  const result = await runStreamChat(
    [{ role: 'user', content: prompt }],
    await resolveRoleModelConfig('planner', models.planner),
    {
      onChunk: (chunk) => {
        if (callbacks?.onChunk) callbacks.onChunk(`plan_${chapterNumber}`, chunk);
      },
    },
    { workId, agentType: 'planner', promptTemplate: 'chapter-plan.md' }
  );

  if (callbacks?.onStepEnd) {
    callbacks.onStepEnd(`plan_${chapterNumber}`, result);
  }

  const plan = parsePlanOutput(result.content);
  // 保存规划到文件
  await fileStore.writeFile(workId, `chapter_${chapterNumber}_plan.json`, JSON.stringify(plan, null, 2));
  return plan;
}

module.exports = {
  planChapterBeats,
  parsePlanOutput,
};
