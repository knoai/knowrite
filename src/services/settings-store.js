const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { initDb, Setting } = require('../models');

function getEncryptionKey() {
  return process.env.ENCRYPTION_KEY || '';
}

function deriveKey() {
  const key = getEncryptionKey();
  if (key.length >= 32) {
    return Buffer.from(key.slice(0, 32));
  }
  // 如果密钥不足 32 字节，用 SHA-256 派生固定长度密钥
  return crypto.createHash('sha256').update(key || 'knowrite-default-key').digest();
}

/**
 * AES-256-GCM 加密
 * 格式: aes:<iv_hex>:<auth_tag_hex>:<ciphertext_hex>
 * 如果 ENCRYPTION_KEY 未设置，回退到 base64 编码（向后兼容）
 */
function encryptKey(key) {
  if (!key || typeof key !== 'string') return '';
  if (key.startsWith('aes:') || key.startsWith('enc:')) return key; // 已经是加密态

  if (!getEncryptionKey()) {
    // 向后兼容：未设置加密密钥时，回退到 base64 编码
    try {
      return 'enc:' + Buffer.from(key, 'utf-8').toString('base64');
    } catch {
      return key;
    }
  }

  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(), iv);
    let encrypted = cipher.update(key, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return 'aes:' + iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  } catch (err) {
    console.error('[settings-store] AES 加密失败:', err.message);
    return key;
  }
}

/**
 * AES-256-GCM 解密
 * 支持 aes:（新格式）和 enc:（旧格式 base64）
 */
function decryptKey(encKey) {
  if (!encKey || typeof encKey !== 'string') return '';
  if (!encKey.startsWith('aes:') && !encKey.startsWith('enc:')) return encKey; // 明文

  // 旧格式 base64 解码（向后兼容）
  if (encKey.startsWith('enc:')) {
    try {
      return Buffer.from(encKey.slice(4), 'base64').toString('utf-8');
    } catch {
      return encKey;
    }
  }

  // 新格式 AES-256-GCM 解密
  try {
    const parts = encKey.slice(4).split(':');
    if (parts.length !== 3) return encKey;
    const [ivHex, authTagHex, ciphertext] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('[settings-store] AES 解密失败:', err.message);
    return encKey;
  }
}

const CONFIG_DIR = path.join(__dirname, '../../config');
const SETTINGS_FILE = path.join(CONFIG_DIR, 'user-settings.json');
const SETTINGS_KEY = 'user-settings';

const {
  reviewDimensions8,
  reviewDimensions15,
  reviewDimensions33,
  skill8,
  skill15,
  skill33,
  defaultPresets,
  presetKeys,
  defaultModelConfig,
  seedSettings,
  minimalDefaults,
} = require('../../config/seed-data.json');

// 确保数据包含所有预设字段
function ensurePresetFields(data) {
  const d = { ...seedSettings, ...data };
  for (const [key, val] of Object.entries(seedSettings)) {
    if (d[key] === undefined) d[key] = val;
  }
  // 确保三套预设都有值
  for (const preset of ['8', '15', '33']) {
    const pk = presetKeys[preset];
    if (!d[pk.dim] || !d[pk.dim].length) {
      d[pk.dim] = defaultPresets[preset].dimensions;
    }
    if (!d[pk.skill]) {
      d[pk.skill] = defaultPresets[preset].skill;
    }
  }
  // 确保 modelConfig 存在
  if (!d.modelConfig) {
    d.modelConfig = JSON.parse(JSON.stringify(defaultModelConfig));
  } else {
    // 递归补全缺失字段
    const mergeModelCfg = (target, source) => {
      for (const [k, v] of Object.entries(source)) {
        if (target[k] === undefined) target[k] = (typeof v === 'object' && v !== null && !Array.isArray(v)) ? {} : v;
        if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
          mergeModelCfg(target[k], v);
        }
      }
    };
    mergeModelCfg(d.modelConfig, defaultModelConfig);
  }
  // 确保 writerRotation 存在
  if (!d.modelConfig.writerRotation) {
    d.modelConfig.writerRotation = JSON.parse(JSON.stringify(defaultModelConfig.writerRotation));
  }
  return d;
}

// 根据 preset 注入当前生效的 reviewDimensions 和 skill
function applyPreset(data) {
  const preset = data.reviewPreset || '33';
  const pk = presetKeys[preset];
  data.reviewPreset = preset;
  data.reviewDimensions = data[pk.dim] || defaultPresets[preset].dimensions;
  data.skill = data[pk.skill] || defaultPresets[preset].skill;
  return data;
}

async function initSettings() {
  await initDb();
  const existing = await Setting.findByPk(SETTINGS_KEY);
  if (existing) return; // 已初始化过，完全以数据库为准

  let merged = { ...seedSettings };
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const fileData = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      merged = { ...seedSettings, ...fileData };
    } catch (err) { console.error("[settings] read file error:", err.message); }
  }
  merged = ensurePresetFields(merged);
  merged = applyPreset(merged);

  await Setting.create({
    key: SETTINGS_KEY,
    value: JSON.stringify(merged),
  });

  // 同步备份本地文件
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf-8');
}

async function getSettings() {
  await initSettings();
  const row = await Setting.findByPk(SETTINGS_KEY);
  if (!row) return applyPreset({ ...minimalDefaults });
  try {
    const data = JSON.parse(row.value);
    return applyPreset(ensurePresetFields(data));
  } catch {
    return applyPreset({ ...minimalDefaults });
  }
}

async function saveSettings(settings) {
  await initSettings();
  const toSave = { ...settings };
  const preset = toSave.reviewPreset || '33';
  const pk = presetKeys[preset];

  // 同步当前生效值到对应 preset 字段
  toSave.reviewPreset = preset;
  if (toSave.reviewDimensions) {
    toSave[pk.dim] = toSave.reviewDimensions;
  }
  if (toSave.skill) {
    toSave[pk.skill] = toSave.skill;
  }

  const full = applyPreset(ensurePresetFields(toSave));

  await Setting.upsert({
    key: SETTINGS_KEY,
    value: JSON.stringify(full),
  });
  // 保留本地备份
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(full, null, 2), 'utf-8');
}

async function getAuthorStyles() {
  const settings = await getSettings();
  return settings.authorStyles || [];
}

async function saveAuthorStyles(authorStyles) {
  const settings = await getSettings();
  settings.authorStyles = authorStyles;
  await saveSettings(settings);
}

async function getPlatformStyles() {
  const settings = await getSettings();
  return settings.platformStyles || [];
}

async function savePlatformStyles(platformStyles) {
  const settings = await getSettings();
  settings.platformStyles = platformStyles;
  await saveSettings(settings);
}

async function getReviewDimensions() {
  const settings = await getSettings();
  return settings.reviewDimensions || [];
}

async function saveReviewDimensions(reviewDimensions) {
  const settings = await getSettings();
  settings.reviewDimensions = reviewDimensions;
  await saveSettings(settings);
}

async function getReviewPreset() {
  const settings = await getSettings();
  return settings.reviewPreset || '33';
}

async function setReviewPreset(preset) {
  if (!['8', '15', '33'].includes(preset)) {
    throw new Error('不支持的评审预设，仅支持 8 / 15 / 33');
  }
  const settings = await getSettings();
  settings.reviewPreset = preset;
  await saveSettings(settings);
}

async function getAuthorStyle(name) {
  const styles = await getAuthorStyles();
  const style = styles.find((s) => s.name === name);
  return style ? style.description : '';
}

async function getPlatformStyle(name) {
  const styles = await getPlatformStyles();
  const style = styles.find((s) => s.name === name);
  return style ? style.description : '';
}

async function getModelConfig() {
  const settings = await getSettings();
  const cfg = settings.modelConfig || JSON.parse(JSON.stringify(defaultModelConfig));
  // 解密 API Key（返回给调用方使用）
  if (cfg.providers) {
    for (const pk of Object.keys(cfg.providers)) {
      const p = cfg.providers[pk];
      if (p && p.apiKey) {
        p.apiKey = decryptKey(p.apiKey);
      }
    }
  }
  return cfg;
}

async function saveModelConfig(modelConfig) {
  const settings = await getSettings();
  // 加密 API Key（存储前处理）
  const toSave = JSON.parse(JSON.stringify(modelConfig));
  if (toSave.providers) {
    for (const pk of Object.keys(toSave.providers)) {
      const p = toSave.providers[pk];
      if (p && p.apiKey) {
        p.apiKey = encryptKey(p.apiKey);
      }
    }
  }
  settings.modelConfig = toSave;
  await saveSettings(settings);
}

async function getRoleModelConfig(role) {
  const cfg = await getModelConfig();
  const defaults = cfg.roleDefaults || {};
  const roleCfg = defaults[role] || { provider: cfg.defaultProvider || 'yuanbao', model: 'deepseek-v3', temperature: 0.7 };
  // 确保字段完整
  return {
    provider: roleCfg.provider || cfg.defaultProvider || 'yuanbao',
    model: roleCfg.model || 'deepseek-v3',
    temperature: typeof roleCfg.temperature === 'number' ? roleCfg.temperature : 0.7,
  };
}

async function resolveRoleModelConfig(role, override) {
  const base = await getRoleModelConfig(role);
  if (!override) return base;
  if (typeof override === 'string') {
    return { ...base, model: override };
  }
  if (typeof override === 'object') {
    return {
      provider: override.provider || base.provider,
      model: override.model || base.model,
      temperature: typeof override.temperature === 'number' ? override.temperature : base.temperature,
    };
  }
  return base;
}

const PROVIDER_ROLE_MAPS = {
  yuanbao: {
    writer: 'deepseek-v3', editor: 'deepseek-r1', humanizer: 'hunyuan', polish: 'hunyuan',
    proofreader: 'deepseek-v3', reader: 'deepseek-v3', summarizer: 'deepseek-v3', reviewer: 'deepseek-v3',
    planner: 'deepseek-r1', outline: 'deepseek-r1', product: 'deepseek-v3', tech: 'deepseek-r1',
    reviser: 'deepseek-v3', synthesis: 'deepseek-r1', repetitionRepair: 'deepseek-v3',
    deviationCheck: 'deepseek-r1', styleCorrect: 'deepseek-v3', expandStyle: 'deepseek-v3',
    promptEvolve: 'deepseek-r1', fitnessEvaluate: 'deepseek-v3',
  },
  doubao: {
    writer: 'doubao-1.5-pro', editor: 'doubao-1.5-thinking-pro', humanizer: 'doubao-1.5-pro', polish: 'doubao-1.5-pro',
    proofreader: 'doubao-1.5-pro', reader: 'doubao-1.5-pro', summarizer: 'doubao-1.5-pro', reviewer: 'doubao-1.5-pro',
    planner: 'doubao-1.5-thinking-pro', outline: 'doubao-1.5-thinking-pro', product: 'doubao-1.5-pro', tech: 'doubao-1.5-thinking-pro',
    reviser: 'doubao-1.5-pro', synthesis: 'doubao-1.5-thinking-pro', repetitionRepair: 'doubao-1.5-pro',
    deviationCheck: 'doubao-1.5-thinking-pro', styleCorrect: 'doubao-1.5-pro', expandStyle: 'doubao-1.5-pro',
    promptEvolve: 'doubao-1.5-thinking-pro', fitnessEvaluate: 'doubao-1.5-pro',
  },
  qwen: {
    writer: 'Qwen3-Max', editor: 'Qwen3-Max-Thinking', humanizer: 'Qwen3.5', polish: 'Qwen3.5',
    proofreader: 'Qwen3-Max', reader: 'Qwen3-Max', summarizer: 'Qwen3-Max', reviewer: 'Qwen3-Max',
    planner: 'Qwen3-Max-Thinking', outline: 'Qwen3-Max-Thinking', product: 'Qwen3-Max', tech: 'Qwen3-Max-Thinking',
    reviser: 'Qwen3-Max', synthesis: 'Qwen3-Max-Thinking', repetitionRepair: 'Qwen3-Max',
    deviationCheck: 'Qwen3-Max-Thinking', styleCorrect: 'Qwen3-Max', expandStyle: 'Qwen3-Max',
    promptEvolve: 'Qwen3-Max-Thinking', fitnessEvaluate: 'Qwen3-Max',
  },
  kimi: {
    writer: 'kimi-k2', editor: 'kimi-k1', humanizer: 'k2.5快速', polish: 'k2.5快速',
    proofreader: 'kimi-k2', reader: 'kimi-k2', summarizer: 'kimi-k2', reviewer: 'kimi-k2',
    planner: 'kimi-k1', outline: 'kimi-k1', product: 'kimi-k2', tech: 'kimi-k1',
    reviser: 'kimi-k2', synthesis: 'kimi-k1', repetitionRepair: 'kimi-k2',
    deviationCheck: 'kimi-k1', styleCorrect: 'kimi-k2', expandStyle: 'kimi-k2',
    promptEvolve: 'kimi-k1', fitnessEvaluate: 'kimi-k2',
  },
};

async function switchProvider(provider) {
  const roleMap = PROVIDER_ROLE_MAPS[provider];
  if (!roleMap) {
    throw new Error(`不支持的模型提供商: ${provider}。支持的: ${Object.keys(PROVIDER_ROLE_MAPS).join(', ')}`);
  }
  const cfg = await getModelConfig();
  cfg.defaultProvider = provider;
  cfg.roleDefaults = cfg.roleDefaults || {};
  for (const [role, model] of Object.entries(roleMap)) {
    const existing = cfg.roleDefaults[role] || {};
    cfg.roleDefaults[role] = {
      provider,
      model,
      temperature: typeof existing.temperature === 'number' ? existing.temperature : 0.7,
    };
  }
  await saveModelConfig(cfg);
  return { switched: true, provider, rolesUpdated: Object.keys(roleMap).length };
}

async function resolveWriterModel(chapterNumber, override) {
  const cfg = await getModelConfig();
  const rotation = cfg.writerRotation;
  if (rotation && rotation.enabled && Array.isArray(rotation.models) && rotation.models.length > 0) {
    const index = ((chapterNumber || 1) - 1) % rotation.models.length;
    const item = rotation.models[index];
    return {
      provider: item.provider || cfg.defaultProvider || 'yuanbao',
      model: item.model || 'deepseek-v3',
      temperature: typeof item.temperature === 'number' ? item.temperature : 0.85,
    };
  }
  return resolveRoleModelConfig('writer', override);
}

async function buildReviewDimensionsText(stylePlaceholder = '') {
  const dims = await getReviewDimensions();
  if (!dims.length) return '';
  return dims.map((d, i) => {
    const desc = stylePlaceholder ? d.description.replace(/\{\{style\}\}/g, stylePlaceholder) : d.description;
    return `${i + 1}. ${d.name}：${desc}\n   判断：[]  证据：`;
  }).join('\n');
}

async function getChapterConfig() {
  const settings = await getSettings();
  return settings.chapterConfig || { targetWords: 2000, minWords: 1800, maxWords: 2200, absoluteMin: 1600, absoluteMax: 2500 };
}

async function saveChapterConfig(config) {
  const settings = await getSettings();
  settings.chapterConfig = { ...settings.chapterConfig, ...config };
  await saveSettings(settings);
}

async function getWritingMode(workId = null) {
  if (workId) {
    const { Work } = require('../models');
    const work = await Work.findByPk(workId, { attributes: ['writingMode'] });
    if (work && work.writingMode) return work.writingMode;
  }
  const settings = await getSettings();
  return settings.writingMode || 'industrial';
}

async function saveWritingMode(mode) {
  const settings = await getSettings();
  settings.writingMode = mode === 'free' ? 'free' : 'industrial';
  await saveSettings(settings);
}

module.exports = {
  seedSettings,
  getSettings,
  saveSettings,
  getAuthorStyles,
  saveAuthorStyles,
  getPlatformStyles,
  savePlatformStyles,
  getReviewDimensions,
  saveReviewDimensions,
  getReviewPreset,
  setReviewPreset,
  getAuthorStyle,
  getPlatformStyle,
  buildReviewDimensionsText,
  getModelConfig,
  saveModelConfig,
  switchProvider,
  getRoleModelConfig,
  resolveRoleModelConfig,
  resolveWriterModel,
  getChapterConfig,
  saveChapterConfig,
  getWritingMode,
  saveWritingMode,
  encryptKey,
  decryptKey,
};
