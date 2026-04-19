#!/usr/bin/env node
/**
 * 配置重置脚本
 * 清空数据库中的所有配置数据，然后从 *.example.json 和 prompts/ 目录重新导入
 *
 * 用法:
 *   node scripts/reset-config.js
 */

const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, '../config');
const PROMPTS_DIR = path.join(__dirname, '../prompts');

async function main() {
  const { sequelize, initDb, Setting, Prompt, StoryTemplate } = require('../src/models');
  await initDb(); // 触发 sequelize.sync() 创建表
  const {
    seedSettings,
    defaultModelConfig,
    defaultPresets,
    presetKeys,
    reviewDimensions8,
    reviewDimensions15,
    reviewDimensions33,
    skill8,
    skill15,
    skill33,
  } = require('../config/seed-data.json');

  console.log('[reset-config] 开始重置配置...');

  // 1. 清空配置相关记录
  await Setting.destroy({ where: { key: 'user-settings' } });
  await Setting.destroy({ where: { key: { [require('sequelize').Op.like]: 'config:%' } } });
  console.log('[reset-config] 已清空 settings 中的配置记录');

  // 2. 清空套路库
  const storyCount = await StoryTemplate.destroy({ where: {}, truncate: true });
  console.log(`[reset-config] 已清空 story_templates 表 (${storyCount} 条)`);

  // 3. 清空 prompts
  const promptCount = await Prompt.destroy({ where: {}, truncate: true });
  console.log(`[reset-config] 已清空 prompts 表 (${promptCount} 条)`);

  // 4. 重新导入 user-settings
  const EXAMPLE_FILE = path.join(CONFIG_DIR, 'user-settings.example.json');
  let merged = { ...seedSettings };
  if (fs.existsSync(EXAMPLE_FILE)) {
    try {
      const fileData = JSON.parse(fs.readFileSync(EXAMPLE_FILE, 'utf-8'));
      merged = { ...seedSettings, ...fileData };
    } catch (err) {
      console.error('[reset-config] 读取 user-settings.example.json 失败:', err.message);
    }
  }
  // 确保预设字段完整（复制自 settings-store.js 的逻辑）
  for (const preset of ['8', '15', '33']) {
    const pk = presetKeys[preset];
    if (!merged[pk.dim] || !merged[pk.dim].length) {
      merged[pk.dim] = defaultPresets[preset].dimensions;
    }
    if (!merged[pk.skill]) {
      merged[pk.skill] = defaultPresets[preset].skill;
    }
  }
  if (!merged.modelConfig) {
    merged.modelConfig = JSON.parse(JSON.stringify(defaultModelConfig));
  }
  merged.reviewPreset = merged.reviewPreset || '33';
  const pk = presetKeys[merged.reviewPreset];
  merged.reviewDimensions = merged[pk.dim] || defaultPresets[merged.reviewPreset].dimensions;
  merged.skill = merged[pk.skill] || defaultPresets[merged.reviewPreset].skill;

  await Setting.create({ key: 'user-settings', value: JSON.stringify(merged) });
  console.log('[reset-config] 已重新导入 user-settings');

  // 5. 重新导入静态配置
  const staticConfigKeys = ['engine', 'fitness', 'i18n', 'network', 'prompts'];
  for (const key of staticConfigKeys) {
    const examplePath = path.join(CONFIG_DIR, `${key}.example.json`);
    if (fs.existsSync(examplePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(examplePath, 'utf-8'));
        await Setting.create({ key: `config:${key}`, value: JSON.stringify(data) });
        console.log(`[reset-config] 已重新导入 config:${key}`);
      } catch (err) {
        console.error(`[reset-config] 读取 example ${key} 失败:`, err.message);
      }
    }
  }

  // 6. 重新导入 prompts
  if (fs.existsSync(PROMPTS_DIR)) {
    try {
      const files = fs.readdirSync(PROMPTS_DIR).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const name = file.replace(/\.md$/, '');
        const content = fs.readFileSync(path.join(PROMPTS_DIR, file), 'utf-8');
        await Prompt.create({ name, lang: 'zh', content });
      }
      console.log(`[reset-config] 已重新导入 ${files.length} 个 prompt`);
    } catch (err) {
      console.error('[reset-config] 导入 prompt 失败:', err.message);
    }
  }

  // 7. 重新导入套路模板（如果 seedDefaultTemplates 可用）
  try {
    const { seedDefaultTemplates } = require('../src/routes/templates');
    await seedDefaultTemplates();
    const count = await StoryTemplate.count();
    console.log(`[reset-config] 已重新导入套路模板 (${count} 条)`);
  } catch (err) {
    console.error('[reset-config] 导入套路模板失败:', err.message);
  }

  console.log('[reset-config] 配置重置完成');

  await sequelize.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('[reset-config] 重置失败:', err.message);
  process.exit(1);
});
