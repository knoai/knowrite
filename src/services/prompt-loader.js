/**
 * Prompt 资产加载器
 * 支持从 prompts/ 目录读取 .md 模板，进行变量替换和局部包含
 */

const fs = require('fs');
const path = require('path');
const { getConfig } = require('./settings-store');

// 获取多语言 Prompt 目录（预留 i18n 扩展）
async function getLangPromptsDir(lang) {
  const promptCfg = await getConfig('prompts');
  const i18nCfg = await getConfig('i18n');
  const PROMPTS_DIR = path.join(__dirname, promptCfg.directory);
  const effectiveLang = lang || i18nCfg.defaultLang || 'zh';
  const langDir = path.join(PROMPTS_DIR, effectiveLang);
  // 如果语言子目录存在则使用，否则回退到根目录
  if (fs.existsSync(langDir)) {
    return langDir;
  }
  return PROMPTS_DIR;
}

async function ensurePromptsDir() {
  const promptCfg = await getConfig('prompts');
  const PROMPTS_DIR = path.join(__dirname, promptCfg.directory);
  try {
    await fs.promises.access(PROMPTS_DIR);
  } catch {
    await fs.promises.mkdir(PROMPTS_DIR, { recursive: true });
  }
}

async function loadPromptRaw(name, lang) {
  const promptCfg = await getConfig('prompts');
  // 支持从用户设置中覆盖 core-rules
  if (name === promptCfg.coreRulesName) {
    try {
      const { getSettings } = require('./settings-store');
      const settings = await getSettings();
      if (settings.skill) return settings.skill;
    } catch (err) { console.error("[prompt-loader] settings error:", err.message); }
  }
  const dir = await getLangPromptsDir(lang);
  const PROMPTS_DIR = path.join(__dirname, promptCfg.directory);
  const filePath = path.join(dir, `${name}${promptCfg.extension}`);
  try {
    await fs.promises.access(filePath);
  } catch {
    // 回退：如果语言版本不存在，尝试根目录
    if (dir !== PROMPTS_DIR) {
      const fallbackPath = path.join(PROMPTS_DIR, `${name}${promptCfg.extension}`);
      try {
        await fs.promises.access(fallbackPath);
        return fs.promises.readFile(fallbackPath, 'utf-8');
      } catch {
        throw new Error(`Prompt template not found: ${filePath} (also tried ${fallbackPath})`);
      }
    }
    throw new Error(`Prompt template not found: ${filePath}`);
  }
  return fs.promises.readFile(filePath, 'utf-8');
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
  ensurePromptsDir();
  const template = await loadPromptRaw(name, lang);
  return renderTemplate(template, variables);
}

async function listPrompts(lang) {
  await ensurePromptsDir();
  const promptCfg = await getConfig('prompts');
  const dir = await getLangPromptsDir(lang);
  const files = await fs.promises.readdir(dir);
  return files
    .filter(f => f.endsWith(promptCfg.extension))
    .map(f => f.replace(/\.md$/, ''));
}

async function savePrompt(name, content, lang) {
  await ensurePromptsDir();
  const promptCfg = await getConfig('prompts');
  const dir = await getLangPromptsDir(lang);
  await fs.promises.writeFile(path.join(dir, `${name}${promptCfg.extension}`), content, 'utf-8');
}

module.exports = {
  loadPrompt,
  loadPromptRaw,
  renderTemplate,
  listPrompts,
  savePrompt,
  getLangPromptsDir,
};
