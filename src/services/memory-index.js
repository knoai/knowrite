/**
 * 智能检索索引模块
 * 维护长篇小说的人物、设定、情节线索引，避免续写时内容重复
 */

const path = require('path');
const fs = require('fs');
const { getWorkDir } = require('../core/paths');
const { runStreamChat } = require('../core/chat');
const fileStore = require('./file-store');
const { resolveRoleModelConfig, getChapterConfig } = require('./settings-store');

const INDEX_FILE = 'memory_index.json';

function getIndexPath(workId) {
  return path.join(getWorkDir(workId), INDEX_FILE);
}

async function loadIndex(workId) {
  const content = await fileStore.readFile(workId, INDEX_FILE);
  if (!content) {
    return { entities: {}, plot_threads: {}, rules: {}, lastUpdated: new Date().toISOString() };
  }
  try {
    return JSON.parse(content);
  } catch (err) {
    console.error('[memory-index] 索引解析失败:', err.message);
    return { entities: {}, plot_threads: {}, rules: {}, lastUpdated: new Date().toISOString() };
  }
}

async function saveIndex(workId, index) {
  index.lastUpdated = new Date().toISOString();
  await fileStore.writeFile(workId, INDEX_FILE, JSON.stringify(index, null, 2));
  // 保留本地备份
  const p = getIndexPath(workId);
  await fs.promises.writeFile(p, JSON.stringify(index, null, 2), 'utf-8');
}

/**
 * 让 AI 从章节摘要中提取实体、情节线、规则
 */
async function extractIndexFromSummary(chapterNumber, summaryText, style, model, callbacks) {
  const prompt = `你是一位资深编辑，擅长从小说章节摘要中提取关键信息用于构建记忆索引。

第${chapterNumber}章摘要：
${summaryText}

请从摘要中提取以下三类信息（如果某类没有，返回空对象）：
1. entities（实体）：人物、组织、关键道具、地点等
2. plot_threads（情节线）：本章推进或涉及的情节主线/支线
3. rules（规则）：世界观规则、修炼体系、制度等

输出格式为严格 JSON（不要加 markdown 代码块）：
{
  "entities": ["主角名字", "关键道具", "地点"],
  "plot_threads": ["复仇线", "身世之谜"],
  "rules": ["修炼境界划分", "宗门规矩"]
}`;

  const result = await runStreamChat([{ role: 'user', content: prompt }], await resolveRoleModelConfig('summarizer', model), callbacks || {});
  let json = null;
  try {
    const cleaned = result.content.replace(/```json\s*/i, '').replace(/```\s*$/m, '').trim();
    json = JSON.parse(cleaned);
  } catch (e) {
    try {
      const match = result.content.match(/\{[\s\S]*\}/);
      if (match) json = JSON.parse(match[0]);
    } catch (err) { console.error("[memory-index] error:", err.message); }
  }

  if (!json) {
    json = { entities: [], plot_threads: [], rules: [] };
  }
  return {
    entities: json.entities || [],
    plot_threads: json.plot_threads || [],
    rules: json.rules || [],
  };
}

/**
 * 将新章节的提取结果追加到索引
 */
async function appendChapterToIndex(workId, chapterNumber, summaryText, style, model, callbacks) {
  const index = await loadIndex(workId);
  const extracted = await extractIndexFromSummary(chapterNumber, summaryText, style, model, callbacks);

  for (const key of ['entities', 'plot_threads', 'rules']) {
    if (!index[key]) index[key] = {};
    for (const item of extracted[key]) {
      const normalized = item.trim();
      if (!normalized) continue;
      if (!index[key][normalized]) {
        index[key][normalized] = [];
      }
      // 避免重复添加同一章节
      if (!index[key][normalized].includes(chapterNumber)) {
        index[key][normalized].push(chapterNumber);
        // 保持升序
        index[key][normalized].sort((a, b) => a - b);
      }
    }
  }

  await saveIndex(workId, index);
  return index;
}

/**
 * 构建防重复提醒文本
 * 查找当前卷纲章中涉及的关键词，如果这些关键词在较远的章节已有详细交代，则生成提醒
 */
async function buildAntiRepetitionReminder(workId, currentVolumeOutline, windowStart, windowEnd) {
  const index = await loadIndex(workId);
  if (!index.entities && !index.plot_threads && !index.rules) {
    return '';
  }

  const reminders = [];
  const allTerms = { ...index.entities, ...index.plot_threads, ...index.rules };

  // 从卷纲章中粗略提取关键词：简单匹配索引中已有的条目
  const outlineLower = (currentVolumeOutline || '').toLowerCase();
  for (const [term, chapters] of Object.entries(allTerms)) {
    if (!outlineLower.includes(term.toLowerCase())) continue;
    if (chapters.length === 0) continue;

    const lastMention = chapters[chapters.length - 1];
    const firstMention = chapters[0];

    // 如果最近一次提及不在当前窗口内，且该词条已出现过≥2次，说明是已知信息
    if (lastMention < windowStart && chapters.length >= 2) {
      reminders.push(`- ${term}（首次出现于第${firstMention}章，最近在第${lastMention}章已有交代）`);
    }
  }

  if (reminders.length === 0) return '';

  return `\n\n【防重复提醒】\n以下内容已在前文多次详细交代，本章禁止再次长篇解释，只需在需要时一句话带过或自然引用：\n${reminders.join('\n')}\n\n请专注于推进当前章节的新情节，而非复述已知信息。`;
}

/**
 * 对新写章节进行内容重复检索
 * 比对 memory_index 中已多次出现的信息，判断本章是否存在冗余复述
 */
async function checkContentRepetition(workId, chapterNumber, chapterText, style, model, callbacks) {
  const index = await loadIndex(workId);
  const knownItems = [];

  for (const [category, data] of Object.entries({ entities: index.entities, plot_threads: index.plot_threads, rules: index.rules })) {
    for (const [term, chapters] of Object.entries(data || {})) {
      if (chapters.length >= 2 && chapters[chapters.length - 1] < chapterNumber) {
        knownItems.push({ category, term, first: chapters[0], last: chapters[chapters.length - 1] });
      }
    }
  }

  if (knownItems.length === 0) {
    return { repetitive: false, severity: 'low', issues: [], suggestions: [] };
  }

  const prompt = `你是一位资深编辑，擅长检查长篇小说章节是否存在内容重复问题。

请基于以下"已知信息索引"，判断第${chapterNumber}章稿件是否对前文中已多次详细交代的内容进行了不必要的重复解释或复述。

已知信息索引（这些条目已在前文出现≥2次，且最近出现不在本章）：
${knownItems.slice(0, 40).map(item => `- [${item.category}] ${item.term}（首次第${item.first}章，最近第${item.last}章）`).join('\n')}

第${chapterNumber}章稿件（前4000字）：
${chapterText.substring(0, 4000)}

请分析本章是否存在以下问题：
1. 对已出场人物/设定/规则进行长篇再解释；
2. 重复前卷或前文已闭环的情节模式；
3. 同一悬念在卷内反复拖沓、没有实质推进；
4. 新场景描写与旧场景高度雷同。

输出严格 JSON（不要加 markdown 代码块）：
{
  "repetitive": true/false,
  "severity": "low/medium/high",
  "issues": ["问题描述1", "问题描述2"],
  "suggestions": ["修改建议1", "修改建议2"]
}`;

  if (callbacks?.onStepStart) {
    callbacks.onStepStart({ key: `repetition_${chapterNumber}`, name: `第${chapterNumber}章 重复检查`, model: model || '(未指定)' });
  }

  const result = await runStreamChat([{ role: 'user', content: prompt }], await resolveRoleModelConfig('repetitionRepair', model), {
    onChunk: (chunk) => { if (callbacks?.onChunk) callbacks.onChunk(`repetition_${chapterNumber}`, chunk); }
  });

  if (callbacks?.onStepEnd) {
    callbacks.onStepEnd(`repetition_${chapterNumber}`, { chars: result.chars, durationMs: result.durationMs });
  }

  let json = null;
  try {
    const cleaned = result.content.replace(/```json\s*/i, '').replace(/```\s*$/m, '').trim();
    json = JSON.parse(cleaned);
  } catch (e) {
    try {
      const match = result.content.match(/\{[\s\S]*\}/);
      if (match) json = JSON.parse(match[0]);
    } catch (err) { console.error("[memory-index] error:", err.message); }
  }

  if (!json) {
    json = { repetitive: false, severity: 'low', issues: [], suggestions: [] };
  }

  await fileStore.writeFile(workId, `chapter_${chapterNumber}_repetition.json`, JSON.stringify({
    repetitive: json.repetitive || false,
    severity: json.severity || 'low',
    issues: json.issues || [],
    suggestions: json.suggestions || [],
    checkedAt: new Date().toISOString()
  }, null, 2));

  return json;
}

/**
 * 基于重复检查结果自动修复章节
 */
async function repairContentRepetition(workId, chapterNumber, chapterText, repetitionResult, style, model, callbacks) {
  const appendToFullTxt = async (wid, title, content) => {
    const header = title ? `\n\n========== ${title} ==========\n\n` : '\n';
    await fileStore.appendToFile(wid, 'full.txt', header + content);
  };
  const chapterCfg = await getChapterConfig();
  const targetWords = chapterCfg.targetWords || 2000;
  const minWords = chapterCfg.minWords || 1800;
  const maxWords = chapterCfg.maxWords || 2200;

  const issuesText = (repetitionResult.issues || []).map((issue, i) => `${i + 1}. ${issue}`).join('\n');
  const suggestionsText = (repetitionResult.suggestions || []).map((s, i) => `${i + 1}. ${s}`).join('\n');

  const prompt = `你是一位职业网络小说作家。当前第${chapterNumber}章存在内容重复问题，请根据以下诊断报告对章节进行修复重写。

诊断问题：
${issuesText || '（未提供具体问题）'}

修改建议：
${suggestionsText || '（未提供具体建议）'}

修复原则：
1. 删除对已出场人物、设定、规则的长篇再解释，改为一句话带过或自然引用；
2. 删除与旧场景高度雷同的描写，替换为新的视觉意象；
3. 保留本章的核心情节推进、人物冲突和有效对白；
4. 确保悬念有实质进展，不原地打转；
5. 保持"${style || '原有'}"风格，输出完整章节（约${targetWords}字，允许${minWords}-${maxWords}字）。

当前章节原文：
${chapterText}

请输出修复后的完整章节，并在文末附【修复说明】，列出你做的关键调整。`;

  if (callbacks?.onStepStart) {
    callbacks.onStepStart({ key: `repetition_repair_${chapterNumber}`, name: `第${chapterNumber}章 重复修复`, model: model || '(未指定)' });
  }

  const result = await runStreamChat([{ role: 'user', content: prompt }], await resolveRoleModelConfig('repetitionRepair', model), {
    onChunk: (chunk) => { if (callbacks?.onChunk) callbacks.onChunk(`repetition_repair_${chapterNumber}`, chunk); }
  });

  if (callbacks?.onStepEnd) {
    callbacks.onStepEnd(`repetition_repair_${chapterNumber}`, { chars: result.chars, durationMs: result.durationMs });
  }

  const repairedFile = `chapter_${chapterNumber}_repetition_repaired.txt`;
  await fileStore.writeFile(workId, repairedFile, result.content);
  // 保留本地备份
  const repPath = path.join(getWorkDir(workId), repairedFile);
  await fs.promises.writeFile(repPath, result.content, 'utf-8');
  await appendToFullTxt(workId, `第${chapterNumber}章（重复修复版）`, result.content);

  // 更新重复检查结果为已修复
  const repContent = await fileStore.readFile(workId, `chapter_${chapterNumber}_repetition.json`);
  if (repContent) {
    try {
      const data = JSON.parse(repContent);
      data.repaired = true;
      data.repairedAt = new Date().toISOString();
      await fileStore.writeFile(workId, `chapter_${chapterNumber}_repetition.json`, JSON.stringify(data, null, 2));
    } catch (err) { console.error("[memory-index] error:", err.message); }
  }

  return {
    content: result.content,
    filename: repairedFile,
    chars: result.chars,
    durationMs: result.durationMs,
  };
}

module.exports = {
  appendChapterToIndex,
  buildAntiRepetitionReminder,
  checkContentRepetition,
  repairContentRepetition,
};
