/**
 * 向量存储服务
 * 基于 SQLite 存储文本嵌入向量，支持余弦相似度检索
 * 零外部向量数据库依赖，纯 JS 实现
 */

const { Embedding, initDb } = require('../models');
const ProviderFactory = require('../providers/factory');
const { getModelConfig } = require('./settings-store');

const DEFAULT_EMBED_MODEL = 'text-embedding-3-small';

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return -1;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function getEmbedModel() {
  try {
    const cfg = await getModelConfig();
    return cfg.embedder?.model || DEFAULT_EMBED_MODEL;
  } catch {
    return DEFAULT_EMBED_MODEL;
  }
}

async function getEmbedProvider() {
  try {
    const cfg = await getModelConfig();
    const providerName = cfg.embedder?.provider || cfg.provider || 'openai';
    const providerCfg = cfg.providers?.[providerName] || {};
    return ProviderFactory.create(providerName, providerCfg);
  } catch {
    return ProviderFactory.create('openai', {});
  }
}

async function generateEmbedding(texts, model) {
  const provider = await getEmbedProvider();
  const embedModel = model || await getEmbedModel();
  const result = await provider.embed(Array.isArray(texts) ? texts : [texts], { model: embedModel });
  return Array.isArray(texts) ? result : result[0];
}

async function saveEmbedding(workId, chapterNumber, sourceType, sourceId, content, embedding, model) {
  await initDb();
  const [record] = await Embedding.upsert({
    workId,
    chapterNumber: chapterNumber || null,
    sourceType,
    sourceId: sourceId || '',
    content: content || '',
    embedding: JSON.stringify(embedding),
    model: model || '',
  }, { conflictFields: ['workId', 'sourceType', 'sourceId'] });
  return record;
}

async function searchSimilar(workId, queryEmbedding, options = {}) {
  const { topK = 5, sourceTypes = null, beforeChapter = null, minScore = 0.7 } = options;
  await initDb();

  const where = { workId };
  if (sourceTypes) where.sourceType = sourceTypes;
  if (beforeChapter) {
    // Sequelize 不支持原生条件混合，这里用简单过滤
  }

  const rows = await Embedding.findAll({ where });
  const scored = [];
  for (const row of rows) {
    if (beforeChapter && row.chapterNumber && row.chapterNumber >= beforeChapter) continue;
    const vec = JSON.parse(row.embedding);
    const score = cosineSimilarity(queryEmbedding, vec);
    if (score >= minScore) {
      scored.push({ ...row.toJSON(), score: parseFloat(score.toFixed(4)) });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

async function deleteEmbeddingsByWorkId(workId) {
  await initDb();
  await Embedding.destroy({ where: { workId } });
}

async function listEmbeddings(workId, sourceType) {
  await initDb();
  const where = { workId };
  if (sourceType) where.sourceType = sourceType;
  return Embedding.findAll({ where, order: [['chapterNumber', 'ASC']] });
}

module.exports = {
  generateEmbedding,
  saveEmbedding,
  searchSimilar,
  deleteEmbeddingsByWorkId,
  listEmbeddings,
  cosineSimilarity,
};
