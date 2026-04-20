const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { initDb, Setting, Prompt } = require('../models');

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
const PROMPTS_DIR = path.join(__dirname, '../../prompts');
const EXAMPLE_FILE = path.join(CONFIG_DIR, 'user-settings.example.json');
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
    // 如果用户保存的 providers 为空，从种子数据恢复默认 Provider 模板
    const seedProviders = seedSettings.modelConfig?.providers;
    if (seedProviders && Object.keys(d.modelConfig.providers || {}).length === 0) {
      d.modelConfig.providers = JSON.parse(JSON.stringify(seedProviders));
    }
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
  if (!existing) {
    // 首次初始化：以 seed-data.json 为底，可选从 example 文件导入默认模板
    let merged = { ...seedSettings };
    if (fs.existsSync(EXAMPLE_FILE)) {
      try {
        const fileData = JSON.parse(fs.readFileSync(EXAMPLE_FILE, 'utf-8'));
        merged = { ...seedSettings, ...fileData };
      } catch (err) { console.error('[settings] read example file error:', err.message); }
    }
    merged = ensurePresetFields(merged);
    merged = applyPreset(merged);

    await Setting.create({
      key: SETTINGS_KEY,
      value: JSON.stringify(merged),
    });
  }

  // 首次初始化：把其他静态配置从 example 文件导入数据库
  const staticConfigKeys = ['engine', 'fitness', 'i18n', 'network', 'prompts', 'model-library'];
  for (const key of staticConfigKeys) {
    const cfgKey = `config:${key}`;
    const row = await Setting.findByPk(cfgKey);
    if (row) continue;
    const examplePath = path.join(CONFIG_DIR, `${key}.example.json`);
    if (fs.existsSync(examplePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(examplePath, 'utf-8'));
        await Setting.create({ key: cfgKey, value: JSON.stringify(data) });
        console.log(`[settings] 静态配置已导入数据库: ${key}`);
      } catch (err) {
        console.error(`[settings] 读取 example ${key} 失败:`, err.message);
      }
    }
  }

  // 首次初始化：把 prompts 目录下的 .md 文件导入数据库
  const promptCount = await Prompt.count();
  if (promptCount === 0 && fs.existsSync(PROMPTS_DIR)) {
    try {
      const files = fs.readdirSync(PROMPTS_DIR).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const name = file.replace(/\.md$/, '');
        const content = fs.readFileSync(path.join(PROMPTS_DIR, file), 'utf-8');
        await Prompt.create({ name, lang: 'zh', content });
      }
      console.log(`[settings] 已导入 ${files.length} 个 prompt 到数据库`);
    } catch (err) {
      console.error('[settings] 导入 prompt 失败:', err.message);
    }
  }
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
  const agentModels = cfg.agentModels || {};
  // agentModels（Agent 级专属配置）优先于 roleDefaults（通用默认）
  const roleCfg = agentModels[role] || defaults[role] || {};

  const availableProviders = Object.keys(cfg.providers || {}).filter(
    k => cfg.providers[k] && cfg.providers[k].enabled !== false
  );

  // 1. 优先使用角色自身配置的 provider
  let provider = roleCfg.provider;
  // 2. 若角色 provider 为空或不在可用列表中，回退到 defaultProvider
  if (!provider || !availableProviders.includes(provider)) {
    provider = cfg.defaultProvider;
  }
  // 3. 若 defaultProvider 也不可用，回退到第一个可用 provider
  if (!provider || !availableProviders.includes(provider)) {
    provider = availableProviders[0] || '';
  }

  // 获取该 provider 下的可用模型列表
  const providerCfg = cfg.providers?.[provider] || {};
  const providerModels = providerCfg.models || [];
  let model = roleCfg.model;
  // 若角色 model 为空或不在该 provider 的 model 列表中，回退到 provider 默认模型或第一个可用 model
  if (!model || (providerModels.length > 0 && !providerModels.includes(model))) {
    model = providerCfg.defaultModel || providerModels[0] || '';
  }

  if (!provider || !model) {
    throw new Error(`角色 "${role}" 未配置模型。请先前往「设置-模型配置」配置该角色的模型。`);
  }

  return {
    provider,
    model,
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

async function switchProvider(provider, options = {}) {
  const { roles, mode = 'smart', uniformModel, customMap } = options;
  const cfg = await getModelConfig();

  // 校验 provider 是否存在于用户配置中
  const providerCfg = cfg.providers && cfg.providers[provider];
  if (!providerCfg) {
    throw new Error(`未找到 Provider "${provider}"。请先在「设置-模型配置」中添加该 Provider。`);
  }

  cfg.defaultProvider = provider;
  cfg.roleDefaults = cfg.roleDefaults || {};

  // 获取所有已配置的 role keys（若未传 roles 则处理全部）
  const allRoles = Object.keys(cfg.roleDefaults);
  const targetRoles = Array.isArray(roles) && roles.length > 0
    ? roles.filter((r) => allRoles.includes(r))
    : allRoles;

  if (targetRoles.length === 0) {
    throw new Error('未指定有效的角色，请先在「设置-模型配置」中配置角色默认模型');
  }

  const firstModel = Array.isArray(providerCfg.models) && providerCfg.models.length > 0
    ? providerCfg.models[0]
    : '';

  for (const role of targetRoles) {
    const existing = cfg.roleDefaults[role] || {};
    let model;
    if (mode === 'uniform' && uniformModel) {
      model = uniformModel;
    } else if (mode === 'custom' && customMap && customMap[role]) {
      model = customMap[role];
    } else if (mode === 'smart') {
      // smart 模式：统一使用当前 provider 的第一个模型
      model = firstModel;
    } else {
      model = existing.model || firstModel;
    }
    cfg.roleDefaults[role] = {
      provider,
      model,
      temperature: typeof existing.temperature === 'number' ? existing.temperature : 0.7,
    };
  }
  await saveModelConfig(cfg);
  return { switched: true, provider, mode, rolesUpdated: targetRoles.length, roles: targetRoles };
}

async function resolveWriterModel(chapterNumber, override) {
  const cfg = await getModelConfig();
  const rotation = cfg.writerRotation;
  if (rotation && rotation.enabled && Array.isArray(rotation.models) && rotation.models.length > 0) {
    const index = ((chapterNumber || 1) - 1) % rotation.models.length;
    const item = rotation.models[index];
    if (!item.provider || !item.model) {
      throw new Error('作家轮替配置不完整，请在「设置-模型配置」中检查轮替模型配置');
    }
    return {
      provider: item.provider,
      model: item.model,
      temperature: typeof item.temperature === 'number' ? item.temperature : 0.85,
    };
  }
  return resolveRoleModelConfig('writer', override);
}

// ============ Agent 级模型配置管理 ============

async function getAgentModelConfig(role) {
  const cfg = await getModelConfig();
  const agentModels = cfg.agentModels || {};
  return agentModels[role] || null;
}

async function setAgentModelConfig(role, config) {
  const cfg = await getModelConfig();
  cfg.agentModels = cfg.agentModels || {};
  if (config === null || config === undefined) {
    delete cfg.agentModels[role];
  } else {
    cfg.agentModels[role] = {
      provider: config.provider || '',
      model: config.model || '',
      temperature: typeof config.temperature === 'number' ? config.temperature : 0.7,
    };
  }
  await saveModelConfig(cfg);
  return cfg.agentModels[role] || null;
}

async function listAgentModelConfigs() {
  const cfg = await getModelConfig();
  const agentModels = cfg.agentModels || {};
  const defaults = cfg.roleDefaults || {};
  const allRoles = new Set([...Object.keys(defaults), ...Object.keys(agentModels)]);
  const result = {};
  for (const role of allRoles) {
    result[role] = agentModels[role] || null;
  }
  return result;
}

async function saveAgentModelConfigs(agentModels) {
  const cfg = await getModelConfig();
  cfg.agentModels = agentModels || {};
  await saveModelConfig(cfg);
  return cfg.agentModels;
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

// ========== 通用静态配置（DB 为准，example 为兜底）==========

async function getModelLibrary() {
  return getConfig('model-library');
}

async function saveModelLibrary(list) {
  return saveConfig('model-library', list);
}

async function getConfig(key) {
  await initSettings();
  const row = await Setting.findByPk(`config:${key}`);
  if (row) {
    try {
      return JSON.parse(row.value);
    } catch {
      // fallthrough to example fallback
    }
  }
  const examplePath = path.join(CONFIG_DIR, `${key}.example.json`);
  if (fs.existsSync(examplePath)) {
    return JSON.parse(fs.readFileSync(examplePath, 'utf-8'));
  }
  throw new Error(`Config "${key}" not found in database or example file`);
}

async function saveConfig(key, value) {
  await initSettings();
  await Setting.upsert({
    key: `config:${key}`,
    value: JSON.stringify(value),
  });
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
  getAgentModelConfig,
  setAgentModelConfig,
  listAgentModelConfigs,
  saveAgentModelConfigs,
  getChapterConfig,
  saveChapterConfig,
  getWritingMode,
  saveWritingMode,
  getModelLibrary,
  saveModelLibrary,
  encryptKey,
  decryptKey,
  getConfig,
  saveConfig,
};
