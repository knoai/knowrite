/**
 * 向量存储服务
 * 基于 SQLite 存储文本嵌入向量，支持余弦相似度检索
 * 零外部向量数据库依赖，纯 JS 实现 + 可选 hnswlib-node 索引加速
 */

const { Embedding, initDb } = require('../models');
const ProviderFactory = require('../providers/factory');
const { getModelConfig } = require('./settings-store');

let HierarchicalNSW = null;
try {
  ({ HierarchicalNSW } = require('hnswlib-node'));
} catch {
  console.warn('[vector-store] hnswlib-node 未安装，将使用纯 JS 检索');
}

const DEFAULT_EMBED_MODEL = 'text-embedding-3-small';
const INDEX_THRESHOLD = 50; // embedding 数量超过此值时启用 hnswlib 索引
const HNSW_M = 16;
const HNSW_EF_CONSTRUCTION = 200;

// 每个 workId 的内存索引缓存
const indexCache = new Map();

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

// ==================== hnswlib 索引管理 ====================

async function buildHnswIndex(workId) {
  if (!HierarchicalNSW) return null;

  const rows = await Embedding.findAll({ where: { workId } });
  if (rows.length < INDEX_THRESHOLD) return null;

  const dim = JSON.parse(rows[0].embedding).length;
  const index = new HierarchicalNSW('l2', dim);
  index.initIndex(Math.max(rows.length * 2, 100), HNSW_M, HNSW_EF_CONSTRUCTION);

  const rowMap = new Map();
  for (const row of rows) {
    const vec = JSON.parse(row.embedding);
    index.addPoint(vec, row.id);
    rowMap.set(row.id, row);
  }

  return { index, rows: rowMap, dim, count: rows.length };
}

async function getOrBuildIndex(workId) {
  if (indexCache.has(workId)) {
    const cached = indexCache.get(workId);
    // 简单检查：如果数据库记录数变化超过 10%，重建索引
    const currentCount = await Embedding.count({ where: { workId } });
    if (Math.abs(currentCount - cached.count) <= Math.max(cached.count * 0.1, 5)) {
      return cached;
    }
    indexCache.delete(workId);
  }

  const built = await buildHnswIndex(workId);
  if (built) {
    indexCache.set(workId, built);
  }
  return built;
}

function invalidateIndex(workId) {
  indexCache.delete(workId);
}

async function searchWithIndex(workId, queryEmbedding, options) {
  const { topK = 5, sourceTypes = null, beforeChapter = null, minScore = 0.7 } = options;
  const cacheEntry = await getOrBuildIndex(workId);
  if (!cacheEntry) return null;

  const candidateCount = Math.min(topK * 5, cacheEntry.count);
  const result = cacheEntry.index.searchKnn(queryEmbedding, candidateCount);

  const scored = [];
  for (let i = 0; i < result.neighbors.length; i++) {
    const rowId = result.neighbors[i];
    const row = cacheEntry.rows.get(rowId);
    if (!row) continue;
    if (beforeChapter && row.chapterNumber && row.chapterNumber >= beforeChapter) continue;

    const vec = JSON.parse(row.embedding);
    const score = cosineSimilarity(queryEmbedding, vec);
    if (score >= minScore) {
      const json = row.toJSON();
      if (sourceTypes && !sourceTypes.includes(json.sourceType)) continue;
      scored.push({ ...json, score: parseFloat(score.toFixed(4)) });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

// ==================== 纯 JS 后备检索 ====================

async function fallbackSearchSimilar(workId, queryEmbedding, options = {}) {
  const { topK = 5, sourceTypes = null, beforeChapter = null, minScore = 0.7 } = options;
  await initDb();

  const where = { workId };
  if (sourceTypes) where.sourceType = sourceTypes;

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

// ==================== 对外 API ====================

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

  // 如果索引已缓存，更新索引
  const cacheEntry = indexCache.get(workId);
  if (cacheEntry && HierarchicalNSW) {
    const vec = JSON.parse(record.embedding);
    if (cacheEntry.rows.has(record.id)) {
      cacheEntry.index.markDelete(record.id);
    }
    cacheEntry.index.addPoint(vec, record.id);
    cacheEntry.rows.set(record.id, record);
    cacheEntry.count = cacheEntry.rows.size;
  }

  return record;
}

async function searchSimilar(workId, queryEmbedding, options = {}) {
  const indexedResult = await searchWithIndex(workId, queryEmbedding, options);
  if (indexedResult !== null) return indexedResult;
  return fallbackSearchSimilar(workId, queryEmbedding, options);
}

async function deleteEmbeddingsByWorkId(workId) {
  await initDb();
  await Embedding.destroy({ where: { workId } });
  invalidateIndex(workId);
}

async function listEmbeddings(workId, sourceType) {
  await initDb();
  const where = { workId };
  if (sourceType) where.sourceType = sourceType;
  return Embedding.findAll({ where, order: [['chapterNumber', 'ASC']] });
}

async function rebuildIndex(workId) {
  invalidateIndex(workId);
  return await getOrBuildIndex(workId);
}

module.exports = {
  generateEmbedding,
  saveEmbedding,
  searchSimilar,
  deleteEmbeddingsByWorkId,
  listEmbeddings,
  cosineSimilarity,
  rebuildIndex,
};
