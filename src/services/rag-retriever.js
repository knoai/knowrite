/**
 * RAG 检索服务
 * 基于向量相似度，为创作流程注入最相关的历史上下文
 */

const { generateEmbedding, searchSimilar } = require('./vector-store');
const { initDb, Character, WorldLore } = require('../models');

const RAG_CONFIG = {
  topKSummaries: 3,
  topKCharacters: 2,
  topKLore: 2,
  minScoreSummary: 0.65,
  minScoreCharacter: 0.7,
  minScoreLore: 0.7,
  maxCharsPerResult: 800,
};

function truncate(text, maxChars) {
  if (!text) return '';
  return text.length > maxChars ? text.substring(0, maxChars) + '…' : text;
}

/**
 * 为当前章节检索最相关的历史章节摘要
 */
async function retrieveRelevantSummaries(workId, outlineText, chapterNumber) {
  if (!outlineText) return [];
  try {
    const queryVec = await generateEmbedding(outlineText.substring(0, 1500));
    const results = await searchSimilar(workId, queryVec, {
      topK: RAG_CONFIG.topKSummaries,
      sourceTypes: ['summary'],
      beforeChapter: chapterNumber,
      minScore: RAG_CONFIG.minScoreSummary,
    });
    return results.map(r => ({
      type: 'summary',
      chapter: r.chapterNumber,
      content: truncate(r.content, RAG_CONFIG.maxCharsPerResult),
      score: r.score,
    }));
  } catch (err) {
    console.error('[rag] 摘要检索失败:', err.message);
    return [];
  }
}

/**
 * 检索与当前大纲相关的角色设定
 */
async function retrieveRelevantCharacters(workId, outlineText) {
  if (!outlineText) return [];
  try {
    await initDb();
    const chars = await Character.findAll({ where: { workId } });
    if (chars.length === 0) return [];

    const queryVec = await generateEmbedding(outlineText.substring(0, 1500));
    const scored = [];
    for (const ch of chars) {
      const text = `${ch.name} ${ch.alias} ${ch.personality} ${ch.background} ${ch.goals}`;
      const charVec = await generateEmbedding(text.substring(0, 1500));
      const score = require('./vector-store').cosineSimilarity(queryVec, charVec);
      if (score >= RAG_CONFIG.minScoreCharacter) {
        scored.push({
          type: 'character',
          name: ch.name,
          content: truncate(`${ch.personality} ${ch.background}`, RAG_CONFIG.maxCharsPerResult),
          score: parseFloat(score.toFixed(4)),
        });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, RAG_CONFIG.topKCharacters);
  } catch (err) {
    console.error('[rag] 角色检索失败:', err.message);
    return [];
  }
}

/**
 * 检索与当前大纲相关的世界观设定
 */
async function retrieveRelevantLore(workId, outlineText) {
  if (!outlineText) return [];
  try {
    await initDb();
    const lores = await WorldLore.findAll({ where: { workId } });
    if (lores.length === 0) return [];

    const queryVec = await generateEmbedding(outlineText.substring(0, 1500));
    const scored = [];
    for (const lore of lores) {
      const text = `${lore.title} ${lore.content}`;
      const loreVec = await generateEmbedding(text.substring(0, 1500));
      const score = require('./vector-store').cosineSimilarity(queryVec, loreVec);
      if (score >= RAG_CONFIG.minScoreLore) {
        scored.push({
          type: 'lore',
          title: lore.title,
          content: truncate(lore.content, RAG_CONFIG.maxCharsPerResult),
          score: parseFloat(score.toFixed(4)),
        });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, RAG_CONFIG.topKLore);
  } catch (err) {
    console.error('[rag] 设定检索失败:', err.message);
    return [];
  }
}

/**
 * 构建 RAG 上下文文本块
 */
async function buildRagContext(workId, outlineText, chapterNumber) {
  const [summaries, characters, lores] = await Promise.all([
    retrieveRelevantSummaries(workId, outlineText, chapterNumber),
    retrieveRelevantCharacters(workId, outlineText),
    retrieveRelevantLore(workId, outlineText),
  ]);

  const parts = [];

  if (summaries.length > 0) {
    parts.push('【相关历史章节（按与当前大纲相关度排序）】');
    for (const s of summaries) {
      parts.push(`- 第${s.chapter}章（相关度 ${Math.round(s.score * 100)}%）：${s.content}`);
    }
  }

  if (characters.length > 0) {
    parts.push('\n【相关角色提醒】');
    for (const c of characters) {
      parts.push(`- ${c.name}（相关度 ${Math.round(c.score * 100)}%）：${c.content}`);
    }
  }

  if (lores.length > 0) {
    parts.push('\n【相关世界观设定】');
    for (const l of lores) {
      parts.push(`- ${l.title}（相关度 ${Math.round(l.score * 100)}%）：${l.content}`);
    }
  }

  if (parts.length === 0) return '';
  return '\n\n========== RAG 检索上下文 ==========\n' + parts.join('\n') + '\n========== RAG 上下文结束 ==========\n';
}

/**
 * 为章节摘要生成并保存 embedding
 */
async function indexChapterSummary(workId, chapterNumber, summaryText, model) {
  if (!summaryText) return;
  try {
    const { saveEmbedding } = require('./vector-store');
    const embedding = await generateEmbedding(summaryText.substring(0, 2000), model);
    await saveEmbedding(workId, chapterNumber, 'summary', `chapter_${chapterNumber}`, summaryText.substring(0, 2000), embedding, model);
    console.log(`[rag] 第${chapterNumber}章摘要已建立向量索引`);
  } catch (err) {
    console.error(`[rag] 摘要索引失败 chapter_${chapterNumber}:`, err.message);
  }
}

/**
 * 为角色设定生成并保存 embedding
 */
async function indexCharacter(workId, character) {
  if (!character) return;
  try {
    const text = `${character.name} ${character.alias || ''} ${character.personality || ''} ${character.background || ''} ${character.goals || ''}`;
    const { saveEmbedding } = require('./vector-store');
    const embedding = await generateEmbedding(text.substring(0, 2000));
    await saveEmbedding(workId, null, 'character', character.name, text.substring(0, 2000), embedding);
    console.log(`[rag] 角色 "${character.name}" 已建立向量索引`);
  } catch (err) {
    console.error(`[rag] 角色索引失败 ${character.name}:`, err.message);
  }
}

/**
 * 为世界观设定生成并保存 embedding
 */
async function indexWorldLore(workId, lore) {
  if (!lore) return;
  try {
    const text = `${lore.title || ''} ${lore.content || ''}`;
    const { saveEmbedding } = require('./vector-store');
    const embedding = await generateEmbedding(text.substring(0, 2000));
    await saveEmbedding(workId, lore.chapterNumber || null, 'lore', lore.title || String(lore.id), text.substring(0, 2000), embedding);
    console.log(`[rag] 设定 "${lore.title}" 已建立向量索引`);
  } catch (err) {
    console.error(`[rag] 设定索引失败 ${lore.title}:`, err.message);
  }
}

module.exports = {
  buildRagContext,
  indexChapterSummary,
  indexCharacter,
  indexWorldLore,
  retrieveRelevantSummaries,
  retrieveRelevantCharacters,
  retrieveRelevantLore,
};
