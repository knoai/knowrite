/**
 * 统一文件存储服务
 * 将作品相关文件内容持久化到 SQLite（通过 Sequelize），替代直接 fs 读写
 * 附带轻量级内存缓存，减少重复查询
 */

const { initDb, WorkFile } = require('../models');

// 简单 LRU + TTL 缓存
const CACHE_MAX_SIZE = 200;
const CACHE_TTL_MS = 30_000;
const cache = new Map();

function cacheKey(workId, filename) {
  return `${workId}::${filename}`;
}

function getCached(workId, filename) {
  const key = cacheKey(workId, filename);
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function setCached(workId, filename, value) {
  const key = cacheKey(workId, filename);
  if (cache.size >= CACHE_MAX_SIZE && !cache.has(key)) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(key, { value, ts: Date.now() });
}

function invalidateCache(workId, filename) {
  cache.delete(cacheKey(workId, filename));
}

function invalidateWorkCache(workId) {
  const prefix = `${workId}::`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

async function writeFile(workId, filename, content) {
  await initDb();
  const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  await WorkFile.upsert({ workId, filename, content: text });
  setCached(workId, filename, text);
}

async function readFile(workId, filename) {
  await initDb();
  const cached = getCached(workId, filename);
  if (cached !== undefined) return cached;
  const row = await WorkFile.findOne({ where: { workId, filename } });
  const value = row ? row.content : '';
  setCached(workId, filename, value);
  return value;
}

async function readFiles(workId, filenames) {
  await initDb();
  const result = {};
  const missing = [];
  for (const fn of filenames) {
    const cached = getCached(workId, fn);
    if (cached !== undefined) {
      result[fn] = cached;
    } else {
      missing.push(fn);
    }
  }
  if (missing.length) {
    const rows = await WorkFile.findAll({ where: { workId, filename: missing } });
    for (const row of rows) {
      result[row.filename] = row.content;
      setCached(workId, row.filename, row.content);
    }
    for (const fn of missing) {
      if (!(fn in result)) {
        result[fn] = '';
        setCached(workId, fn, '');
      }
    }
  }
  return result;
}

async function readAllWorkFiles(workId) {
  await initDb();
  const rows = await WorkFile.findAll({ where: { workId } });
  const map = {};
  for (const row of rows) {
    map[row.filename] = row.content;
    setCached(workId, row.filename, row.content);
  }
  return map;
}

async function appendToFile(workId, filename, content) {
  await initDb();
  const existing = await readFile(workId, filename);
  const updated = existing + content;
  await WorkFile.upsert({ workId, filename, content: updated });
  setCached(workId, filename, updated);
}

async function deleteFile(workId, filename) {
  await initDb();
  await WorkFile.destroy({ where: { workId, filename } });
  invalidateCache(workId, filename);
}

async function listFiles(workId, prefix) {
  await initDb();
  const rows = await WorkFile.findAll({
    where: { workId },
    attributes: ['filename'],
  });
  const names = rows.map(r => r.filename);
  if (prefix) return names.filter(n => n.startsWith(prefix));
  return names;
}

async function fileExists(workId, filename) {
  await initDb();
  const cached = getCached(workId, filename);
  if (cached !== undefined) return cached !== '';
  const count = await WorkFile.count({ where: { workId, filename } });
  return count > 0;
}

module.exports = {
  writeFile,
  readFile,
  readFiles,
  readAllWorkFiles,
  appendToFile,
  deleteFile,
  listFiles,
  fileExists,
  invalidateCache,
  invalidateWorkCache,
};
