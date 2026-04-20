/**
 * 角色专属记忆服务（Episodic Memory  per Character）
 *
 * 核心职责：
 * 1. extractEpisodesFromSummary(workId, chapterNumber, summaryText) — 从摘要提取角色经历
 * 2. appendEpisode(workId, charName, chapterNumber, episode) — 追加角色经历到数据库
 * 3. getCharacterMemoryPrompt(workId, charNames, chapterNumber) — 生成角色记忆注入文本
 * 4. buildCharacterMemoryFile(workId, charName) — 生成/更新角色专属记忆文件
 *
 * 经历类型：
 * - event: 重大事件参与
 * - dialogue: 标志性对话
 * - relationship_change: 关系变化
 * - emotional_turn: 情感转折
 * - goal_progress: 目标推进/变化
 * - knowledge_gain: 获得新信息/秘密
 */

const { CharacterMemory, Character, CharacterRelation } = require('../models');
const { Op } = require('sequelize');
const fileStore = require('./file-store');

// ============ 核心 API ============

/**
 * 从章节摘要中提取所有角色的经历片段
 */
async function extractEpisodesFromSummary(workId, chapterNumber, summaryText) {
  // 1. 获取作品所有已登记角色
  const characters = await Character.findAll({ where: { workId } });
  const charNames = characters.map((c) => c.name);

  const episodes = [];

  for (const char of characters) {
    const name = char.name;
    // 简单启发式：摘要中提及该角色名字，认为有经历
    if (!summaryText.includes(name)) continue;

    // 提取提及该角色名字附近的句子作为候选片段
    const sentences = summaryText.split(/[。！？\n]+/).filter((s) => s.trim());
    const relevant = sentences.filter((s) => s.includes(name));

    if (relevant.length === 0) continue;

    // 分类经历类型（简化版，基于关键词匹配）
    const content = relevant.join('；').substring(0, 500);
    const episodeType = classifyEpisode(content);

    episodes.push({
      workId,
      charName: name,
      chapterNumber,
      episodeType,
      content,
      importance: estimateImportance(content),
      tags: extractTags(content),
      sourceText: relevant[0]?.substring(0, 200) || '',
    });
  }

  // 批量写入
  for (const ep of episodes) {
    await CharacterMemory.create(ep);
  }

  return episodes;
}

/**
 * 获取指定角色的记忆注入文本（用于 Writer Prompt）
 */
async function getCharacterMemoryPrompt(workId, charNames = [], chapterNumber, options = {}) {
  const { maxEventsPerChar = 5, maxCharsPerEvent = 120, includeRelationships = true } = options;

  const where = { workId };
  if (charNames.length > 0) where.charName = charNames;

  // 只取最近章节之前的记忆（避免泄漏当前章）
  if (chapterNumber) {
    where.chapterNumber = { [Op.lt]: chapterNumber };
  }

  const memories = await CharacterMemory.findAll({
    where,
    order: [['chapterNumber', 'DESC'], ['importance', 'DESC']],
  });

  if (memories.length === 0) return '';

  // 按角色分组，取最近 N 条
  const byChar = {};
  for (const m of memories) {
    if (!byChar[m.charName]) byChar[m.charName] = [];
    if (byChar[m.charName].length < maxEventsPerChar) {
      byChar[m.charName].push(m);
    }
  }

  const lines = ['## 角色经历记忆（近期关键事件）', ''];

  for (const [charName, events] of Object.entries(byChar)) {
    lines.push(`### ${charName}`);
    for (const ev of events) {
      const tag = translateEpisodeType(ev.episodeType);
      const text = ev.content.substring(0, maxCharsPerEvent);
      lines.push(`- [第${ev.chapterNumber}章·${tag}] ${text}`);
    }
    lines.push('');
  }

  // 可选：注入关系变化
  if (includeRelationships && charNames.length > 0) {
    const relations = await CharacterRelation.findAll({
      where: { workId },
      include: [
        { model: Character, as: 'fromChar', attributes: ['name'] },
        { model: Character, as: 'toChar', attributes: ['name'] },
      ],
    });
    // 简化：如果有关联角色，注入关系提示
    const relevantRelations = relations.filter((r) =>
      charNames.includes(r.fromChar?.name) || charNames.includes(r.toChar?.name)
    );
    if (relevantRelations.length > 0) {
      lines.push('### 当前关系状态');
      for (const r of relevantRelations.slice(0, 8)) {
        const from = r.fromChar?.name || '?';
        const to = r.toChar?.name || '?';
        lines.push(`- ${from} → ${to}：${r.relationType}${r.strength ? `（强度${r.strength}）` : ''}`);
      }
      lines.push('');
    }
  }

  lines.push('> 写作时请确保角色的行为、对话和情感反应与其经历记忆保持一致。');
  return lines.join('\n');
}

/**
 * 为指定角色生成专属记忆文件（完整版）
 */
async function buildCharacterMemoryFile(workId, charName) {
  const char = await Character.findOne({ where: { workId, name: charName } });
  if (!char) return null;

  const memories = await CharacterMemory.findAll({
    where: { workId, charName },
    order: [['chapterNumber', 'ASC']],
  });

  const lines = [`# ${charName} 专属记忆档案`, ''];

  lines.push('## 基础设定');
  lines.push(`- 角色类型: ${char.roleType || '配角'}`);
  lines.push(`- 状态: ${char.status || '存活'}`);
  if (char.appearance) lines.push(`- 外貌: ${char.appearance}`);
  if (char.personality) lines.push(`- 性格: ${char.personality}`);
  if (char.goals) lines.push(`- 目标: ${char.goals}`);
  if (char.background) lines.push(`- 背景: ${char.background}`);
  lines.push('');

  if (memories.length) {
    lines.push('## 经历时间线');
    for (const m of memories) {
      lines.push(`### 第${m.chapterNumber}章 [${translateEpisodeType(m.episodeType)}]`);
      lines.push(m.content);
      if (m.tags?.length) lines.push(`标签: ${m.tags.join(', ')}`);
      lines.push('');
    }
  }

  const content = lines.join('\n');
  await fileStore.writeFile(workId, `memory_${charName}.md`, content);
  return content;
}

/**
 * 批量为作品中所有主要角色生成记忆文件
 */
async function buildAllCharacterMemoryFiles(workId) {
  const characters = await Character.findAll({
    where: { workId, roleType: ['主角', '反派'] },
  });
  for (const c of characters) {
    await buildCharacterMemoryFile(workId, c.name);
  }
}

// ============ 分类与评估 ============

function classifyEpisode(text) {
  if (/[表白告白分手决裂反目]/.test(text)) return 'relationship_change';
  if (/[发现得知真相秘密]/.test(text)) return 'knowledge_gain';
  if (/[突破晋升完成任务达成]/.test(text)) return 'goal_progress';
  if (/[悲痛愤怒狂喜绝望震惊]/.test(text)) return 'emotional_turn';
  if (/[说问道回答叫骂]/.test(text)) return 'dialogue';
  return 'event';
}

function estimateImportance(text) {
  let score = 3;
  if (/[死杀亡陨落毁灭]/.test(text)) score += 2;
  if (/[突破晋升顿悟觉醒]/.test(text)) score += 2;
  if (/[真相秘密揭露暴露]/.test(text)) score += 1;
  if (/[背叛反目决裂]/.test(text)) score += 1;
  return Math.min(5, score);
}

function extractTags(text) {
  const tags = [];
  if (/[战斗厮杀对决]/.test(text)) tags.push('战斗');
  if (/[对话谈判争吵]/.test(text)) tags.push('对话');
  if (/[修炼突破晋升]/.test(text)) tags.push('修炼');
  if (/[秘密真相阴谋]/.test(text)) tags.push('悬疑');
  if (/[情感爱情亲情友情]/.test(text)) tags.push('情感');
  return tags;
}

function translateEpisodeType(type) {
  const map = {
    event: '事件',
    dialogue: '对话',
    relationship_change: '关系变化',
    emotional_turn: '情感转折',
    goal_progress: '目标推进',
    knowledge_gain: '信息获取',
  };
  return map[type] || type;
}

module.exports = {
  extractEpisodesFromSummary,
  getCharacterMemoryPrompt,
  buildCharacterMemoryFile,
  buildAllCharacterMemoryFiles,
};
