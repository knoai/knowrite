const fs = require('fs');
const path = require('path');
const { initDb, Setting } = require('../models');

// API Key 简易加密：base64 编码存储，避免明文暴露
function encryptKey(key) {
  if (!key || typeof key !== 'string') return '';
  if (key.startsWith('enc:')) return key; // 已经是加密态
  try {
    return 'enc:' + Buffer.from(key, 'utf-8').toString('base64');
  } catch {
    return key;
  }
}

function decryptKey(encKey) {
  if (!encKey || typeof encKey !== 'string') return '';
  if (!encKey.startsWith('enc:')) return encKey; // 兼容旧数据
  try {
    return Buffer.from(encKey.slice(4), 'base64').toString('utf-8');
  } catch {
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
  getRoleModelConfig,
  resolveRoleModelConfig,
  resolveWriterModel,
  getChapterConfig,
  saveChapterConfig,
  getWritingMode,
  saveWritingMode,
};
