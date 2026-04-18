const path = require('path');
const fs = require('fs');

const WORKS_DIR = path.join(__dirname, '../../works');
const SAFE_ID_REGEX = /^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$/;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function sanitizeWorkId(workId) {
  if (!workId || typeof workId !== 'string') return null;
  const sanitized = workId.replace(/\.{2,}/g, '').replace(/[\\/]/g, '_');
  if (!SAFE_ID_REGEX.test(sanitized)) return null;
  return sanitized;
}

function getWorkDir(workId) {
  const safe = sanitizeWorkId(workId);
  if (!safe) throw new Error(`Invalid workId: ${workId}`);
  return path.join(WORKS_DIR, safe);
}

module.exports = {
  WORKS_DIR,
  ensureDir,
  getWorkDir,
  sanitizeWorkId,
};
