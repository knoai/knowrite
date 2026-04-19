/**
 * Prompt 资产加载器
 * 从数据库读取 prompt 模板，进行变量替换和局部包含
 */

const { getConfig, getSettings } = require('./settings-store');
const { Prompt } = require('../models');

async function loadPromptRaw(name, lang) {
  const promptCfg = await getConfig('prompts');
  // 支持从用户设置中覆盖 core-rules
  if (name === promptCfg.coreRulesName) {
    try {
      const settings = await getSettings();
      if (settings.skill) return settings.skill;
    } catch (err) { console.error('[prompt-loader] settings error:', err.message); }
  }
  const effectiveLang = lang || 'zh';
  const row = await Prompt.findOne({ where: { name, lang: effectiveLang } });
  if (row) return row.content;
  // 回退：尝试默认语言
  if (effectiveLang !== 'zh') {
    const fallback = await Prompt.findOne({ where: { name, lang: 'zh' } });
    if (fallback) return fallback.content;
  }
  throw new Error(`Prompt template not found in database: ${name} (lang: ${effectiveLang})`);
}

async function renderTemplate(template, variables = {}) {
  let result = template;

  // 支持 {{include:filename}} 局部包含
  const includeRegex = /\{\{include:([^}]+)\}\}/g;
  let match;
  while ((match = includeRegex.exec(result)) !== null) {
    const includeName = match[1].trim();
    const includeContent = await loadPromptRaw(includeName);
    result = result.replace(match[0], includeContent);
    // 重置 regex 因为字符串长度变化了
    includeRegex.lastIndex = 0;
  }

  // 支持 {{key}} 变量替换
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp('\\{\\{' + key + '\\}\\}', 'g');
    result = result.replace(regex, value == null ? '' : String(value));
  }

  return result;
}

async function loadPrompt(name, variables = {}, lang) {
  const template = await loadPromptRaw(name, lang);
  return renderTemplate(template, variables);
}

async function listPrompts(lang) {
  const effectiveLang = lang || 'zh';
  const rows = await Prompt.findAll({
    where: { lang: effectiveLang },
    attributes: ['name'],
    order: [['name', 'ASC']],
  });
  return rows.map(r => r.name);
}

async function savePrompt(name, content, lang) {
  const effectiveLang = lang || 'zh';
  const [row, created] = await Prompt.findOrCreate({
    where: { name, lang: effectiveLang },
    defaults: { name, lang: effectiveLang, content },
  });
  if (!created) {
    row.content = content;
    await row.save();
  }
}

module.exports = {
  loadPrompt,
  loadPromptRaw,
  renderTemplate,
  listPrompts,
  savePrompt,
};
