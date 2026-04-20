/**
 * Skill 自动生成与萃取服务
 *
 * 核心职责：
 * 1. triggerSkillExtraction(workId, options) — 检查是否满足萃取条件
 * 2. extractSkill(workId, highFitnessChapters, model, callbacks) — 从高分章节萃取 Skill
 * 3. saveSkill(skill) — 保存到 skills/ 目录
 * 4. getMatchingSkills(workId) — 获取匹配当前作品的 Skill
 * 5. buildSkillInjection(workId) — 构建 Skill 注入文本
 *
 * Skill 文件格式（Markdown）：
 * ---
 * name: 都市修仙-快节奏
 * tags: ["都市", "修仙", "快节奏", "爽文"]
 * fitnessThreshold: 0.85
 * extractedFrom: ["workId1", "workId2"]
 * extractedAt: 2026-04-20
 * ---
 * # 创作技能：都市修仙快节奏
 * ...
 */

const fs = require('fs');
const path = require('path');
const { Work, Chapter } = require('../models');
const { runStreamChat } = require('../core/chat');
const { resolveRoleModelConfig } = require('./settings-store');
const fileStore = require('./file-store');

const SKILLS_DIR = path.join(__dirname, '../../skills/generated');

async function ensureSkillsDir() {
  try {
    await fs.promises.access(SKILLS_DIR);
  } catch {
    await fs.promises.mkdir(SKILLS_DIR, { recursive: true });
  }
}

// ============ 核心 API ============

/**
 * 检查并触发 Skill 萃取
 */
async function triggerSkillExtraction(workId, options = {}) {
  const { minFitness = 0.85, minConsecutive = 3, model, callbacks } = options;

  const chapters = await Chapter.findAll({
    where: { workId },
    order: [['number', 'ASC']],
  });

  // 获取 Fitness 数据
  const withFitness = [];
  for (const ch of chapters) {
    const fitnessPath = `chapter_${ch.number}_fitness.json`;
    const fitnessRaw = await fileStore.readFile(workId, fitnessPath);
    let fitness = null;
    try {
      if (fitnessRaw) fitness = JSON.parse(fitnessRaw);
    } catch { /* ignore */ }
    withFitness.push({
      number: ch.number,
      score: fitness?.score || 0,
      breakdown: fitness?.breakdown || {},
    });
  }

  // 找连续高分章节
  const highFitness = [];
  let streak = 0;
  for (let i = withFitness.length - 1; i >= 0; i--) {
    if (withFitness[i].score >= minFitness) {
      highFitness.unshift(withFitness[i]);
      streak++;
    } else {
      break; // 只取最近连续高分
    }
  }

  if (streak < minConsecutive) {
    return {
      triggered: false,
      reason: `最近连续高分章节数 ${streak} < ${minConsecutive}（阈值 ${minFitness}）`,
      streak,
    };
  }

  // 执行萃取
  const skill = await extractSkill(workId, highFitness, model, callbacks);
  await saveSkill(skill);

  return {
    triggered: true,
    skill,
    streak,
  };
}

/**
 * 从高分章节萃取 Skill
 */
async function extractSkill(workId, highFitnessChapters, model, callbacks = {}) {
  const work = await Work.findByPk(workId);
  if (!work) throw new Error(`Work ${workId} not found`);

  // 收集高分章节的文本和摘要
  const samples = [];
  for (const h of highFitnessChapters.slice(-5)) {
    const ch = await Chapter.findOne({ where: { workId, number: h.number } });
    if (!ch) continue;
    const finalText = await fileStore.readFile(workId, ch.finalFile || ch.rawFile);
    const summary = await fileStore.readFile(workId, `chapter_${h.number}_summary.txt`);
    if (finalText) {
      samples.push({
        chapterNumber: h.number,
        fitness: h.score,
        breakdown: h.breakdown,
        textPreview: finalText.substring(0, 1500),
        summary: summary || '',
      });
    }
  }

  const prompt = `你是一位资深网络文学编辑和 Prompt 工程专家。请从以下高分章节的创作记录中，抽象出一套可复用的"创作技能"（Skill）。

作品信息：
- 题材：${work.topic || '未知'}
- 风格：${work.style || '未知'}
- 平台风格：${work.platformStyle || '无'}
- 作者风格：${work.authorStyle || '无'}

高分章节记录（按 Fitness 从高到低排列）：
${samples.map((s, i) => `
--- 样本 ${i + 1} ---
章节：第${s.chapterNumber}章
Fitness：${s.fitness.toFixed(2)}
字数得分：${s.breakdown?.wordScore || 'N/A'}
重复得分：${s.breakdown?.repScore || 'N/A'}
评审得分：${s.breakdown?.reviewScore || 'N/A'}
摘要：${s.summary.substring(0, 300)}
正文片段：${s.textPreview.substring(0, 600)}
`).join('')}

请分析这些高分章节的共同成功要素，输出为以下格式的 Markdown Skill 文档（不要加 markdown 代码块包裹，直接输出 Markdown）：

---
name: ${work.style || '通用'}-${work.platformStyle || '通用'}
tags: ["${work.style || '通用'}", "${work.platformStyle || '通用'}"]
fitnessThreshold: 0.85
extractedFrom: ["${workId}"]
extractedAt: ${new Date().toISOString().split('T')[0]}
---

# 创作技能：${work.style || '通用'} ${work.platformStyle || '通用'}

## 1. 适用题材标签
（列出最匹配的 3-5 个题材标签）

## 2. 结构模板
（该题材高分章节的通用结构模板，例如：钩子→冲突→升级→反转→悬念）

## 3. 节奏控制公式
（字数分配建议、场景切换节奏、信息密度控制）

## 4. 情绪转折技巧
（如何制造爽点、如何铺垫情绪、高潮前的压抑手法）

## 5. 常见陷阱与规避方法
（该题材最容易出现的毒点，以及如何在写作中规避）

## 6. Prompt 注入指令
（一段可以直接插入 Writer Prompt 的指令，让 AI 遵循以上技能写作）
`;

  if (callbacks.onStepStart) {
    callbacks.onStepStart({ key: 'skill_extract', name: 'Skill 萃取', model });
  }

  const result = await runStreamChat(
    [{ role: 'user', content: prompt }],
    await resolveRoleModelConfig('skillExtract', model),
    { onChunk: (chunk) => { if (callbacks.onChunk) callbacks.onChunk('skill_extract', chunk); } }
  );

  if (callbacks.onStepEnd) {
    callbacks.onStepEnd('skill_extract', { chars: result.chars, durationMs: result.durationMs });
  }

  // 解析 frontmatter
  const { frontmatter, content } = parseFrontmatter(result.content);

  return {
    name: frontmatter.name || `skill_${Date.now()}`,
    tags: frontmatter.tags || [],
    fitnessThreshold: frontmatter.fitnessThreshold || 0.85,
    extractedFrom: frontmatter.extractedFrom || [workId],
    extractedAt: frontmatter.extractedAt || new Date().toISOString(),
    content: content.trim(),
    raw: result.content,
  };
}

/**
 * 保存 Skill 到文件系统
 */
async function saveSkill(skill) {
  await ensureSkillsDir();
  const safeName = skill.name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_');
  const filename = `${safeName}.md`;
  const filepath = path.join(SKILLS_DIR, filename);

  const frontmatter = `---
name: ${skill.name}
tags: [${(skill.tags || []).map((t) => `"${t}"`).join(', ')}]
fitnessThreshold: ${skill.fitnessThreshold}
extractedFrom: [${(skill.extractedFrom || []).map((w) => `"${w}"`).join(', ')}]
extractedAt: ${skill.extractedAt}
---\n\n`;

  await fs.promises.writeFile(filepath, frontmatter + skill.content, 'utf-8');
  return { filename, filepath };
}

/**
 * 获取匹配当前作品的 Skill
 */
async function getMatchingSkills(workId) {
  const work = await Work.findByPk(workId);
  if (!work) return [];

  await ensureSkillsDir();
  let files = [];
  try {
    files = await fs.promises.readdir(SKILLS_DIR);
  } catch { return []; }

  const skills = [];
  const workTags = new Set([
    work.style,
    work.platformStyle,
    work.authorStyle,
  ].filter(Boolean));

  for (const file of files.filter((f) => f.endsWith('.md'))) {
    const content = await fs.promises.readFile(path.join(SKILLS_DIR, file), 'utf-8');
    const { frontmatter } = parseFrontmatter(content);
    const skillTags = new Set(frontmatter.tags || []);

    // 计算匹配度：交集大小 / 并集大小
    const intersection = new Set([...workTags].filter((x) => skillTags.has(x)));
    const union = new Set([...workTags, ...skillTags]);
    const matchScore = union.size > 0 ? intersection.size / union.size : 0;

    if (matchScore > 0) {
      skills.push({
        name: frontmatter.name || file.replace('.md', ''),
        filename: file,
        matchScore,
        tags: Array.from(skillTags),
        fitnessThreshold: frontmatter.fitnessThreshold || 0.85,
        content: content.split('---').slice(2).join('---').trim(),
      });
    }
  }

  return skills.sort((a, b) => b.matchScore - a.matchScore);
}

/**
 * 构建 Skill 注入文本（用于 Writer Prompt）
 */
async function buildSkillInjection(workId) {
  const skills = await getMatchingSkills(workId);
  if (skills.length === 0) return '';

  // 取 Top-2 最匹配的 Skill
  const topSkills = skills.slice(0, 2);

  const lines = ['## 创作技能注入（自动匹配）', ''];
  for (const s of topSkills) {
    lines.push(`### ${s.name}（匹配度 ${(s.matchScore * 100).toFixed(0)}%）`);
    lines.push(s.content.substring(0, 2000));
    lines.push('');
  }

  lines.push('> 以上技能基于历史高分章节自动萃取，写作时请优先遵循。');
  return lines.join('\n');
}

// ============ 辅助函数 ============

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, content: text };

  const rawFm = match[1];
  const content = match[2];
  const frontmatter = {};

  for (const line of rawFm.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();

    if (value.startsWith('[') && value.endsWith(']')) {
      try {
        frontmatter[key] = JSON.parse(value.replace(/'/g, '"'));
      } catch {
        frontmatter[key] = value.slice(1, -1).split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
      }
    } else if (value === 'true') {
      frontmatter[key] = true;
    } else if (value === 'false') {
      frontmatter[key] = false;
    } else if (!isNaN(Number(value)) && value !== '') {
      frontmatter[key] = Number(value);
    } else {
      frontmatter[key] = value.replace(/^"|"$/g, '');
    }
  }

  return { frontmatter, content };
}

module.exports = {
  triggerSkillExtraction,
  extractSkill,
  saveSkill,
  getMatchingSkills,
  buildSkillInjection,
};
