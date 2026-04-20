/**
 * 拆书服务 — Book Deconstructor
 *
 * 核心职责：
 * 1. deconstruct(text, options) — 上传小说文本，自动拆解为结构化数据
 * 2. analyzeStructure(sampleChapters) — 分析套路/结构模板
 * 3. analyzeCharacters(sampleChapters) — 分析人物设定与关系
 * 4. analyzeWorld(sampleChapters) — 分析世界观设定
 * 5. analyzeStyle(sampleChapters) — 分析语言风格（复用 author-fingerprint）
 * 6. createArtifacts(analysis) — 一键创建 StoryTemplate + AuthorFingerprint + Prompt
 */

const { loadPrompt } = require('./prompt-loader');
const { runStreamChat } = require('../core/chat');
const { resolveRoleModelConfig } = require('./settings-store');
const authorFingerprint = require('./author-fingerprint');
const voiceFingerprint = require('./voice-fingerprint');
const { StoryTemplate, AuthorFingerprint, Prompt } = require('../models');
const { extractJson } = require('./world-extractor');

// ============ 主入口 ============

async function deconstruct(text, options = {}) {
  const {
    title = '未命名作品',
    author = '未知作者',
    model,
    maxSampleChars = 15000,
    callbacks = {},
    workId,
  } = options;

  // 1. 文本预处理
  const chapters = splitChapters(text);
  const sampleText = text.substring(0, maxSampleChars);
  const sampleChapters = chapters.slice(0, Math.min(chapters.length, 10));

  if (callbacks.onStepStart) {
    callbacks.onStepStart({ key: 'deconstruct', name: `拆书：${title}`, model: model || '(默认)' });
  }

  // 2. 并行分析
  const [
    structureResult,
    charactersResult,
    worldResult,
    styleResult,
    voiceResult,
  ] = await Promise.all([
    analyzeStructure(sampleChapters, model, callbacks, workId),
    analyzeCharacters(sampleChapters, model, callbacks, workId),
    analyzeWorld(sampleText, model, callbacks, workId),
    analyzeStyle(sampleText, model, callbacks),
    analyzeVoices(sampleChapters, model, callbacks),
  ]);

  // 3. 生成总结报告
  const summary = await generateSummary({
    title,
    author,
    chapterCount: chapters.length,
    totalChars: text.length,
    structure: structureResult,
    characters: charactersResult,
    world: worldResult,
    style: styleResult,
  }, model, callbacks, workId);

  const result = {
    meta: { title, author, genre: structureResult.genre || '未知', totalChars: text.length, chapterCount: chapters.length },
    structure: structureResult,
    characters: charactersResult,
    world: worldResult,
    style: styleResult,
    voiceFingerprints: voiceResult,
    summary,
  };

  if (callbacks.onStepEnd) {
    callbacks.onStepEnd('deconstruct', { success: true });
  }

  return result;
}

// ============ 各维度分析 ============

async function analyzeStructure(chapters, model, callbacks, workId) {
  const sample = chapters.map((c, i) => `第${i + 1}章：${c.title}\n${c.content.substring(0, 800)}`).join('\n\n---\n\n');

  const prompt = `你是一位资深网络文学编辑，擅长分析小说的结构和套路。请对以下章节样本进行结构分析。\n\n章节样本：\n${sample}\n\n请输出 JSON（不要加 markdown 代码块）：\n{\n  "genre": "题材标签（如：都市修仙/玄幻/言情等）",\n  "beatStructure": [\n    { "beat": "开局钩子", "description": "如何吸引读者", "position": "第1-3章" },\n    { "beat": "冲突升级", "description": "...", "position": "第4-10章" }\n  ],\n  "hookPattern": "每章结尾的钩子模式（如：悬念/冲突/反转）",\n  "conflictTypes": ["主要冲突类型1", "主要冲突类型2"],\n  "pacing": {\n    "early": "开局节奏（快/慢/适中）",\n    "mid": "中段节奏",\n    "late": "推测后期节奏"\n  },\n  "turningPoints": ["第X章 重大转折1", "第X章 重大转折2"],\n  "cliffhangerStyle": "悬念风格描述",\n  "recommendedTemplate": "建议的套路模板名称"\n}`;

  const result = await runStreamChat(
    [{ role: 'user', content: prompt }],
    await resolveRoleModelConfig('editor', model),
    { onChunk: (chunk) => { if (callbacks?.onChunk) callbacks.onChunk('deconstruct_structure', chunk); } },
    workId ? { workId, agentType: 'deconstruct', promptTemplate: 'deconstruct-structure.md' } : undefined
  );

  return extractJson(result.content) || {};
}

async function analyzeCharacters(chapters, model, callbacks, workId) {
  const sample = chapters.map((c, i) => `第${i + 1}章：${c.title}\n${c.content.substring(0, 600)}`).join('\n\n---\n\n');

  const prompt = `你是一位人物设定专家。请从以下章节样本中提取所有重要人物，并分析其设定和关系。\n\n章节样本：\n${sample}\n\n请输出 JSON（不要加 markdown 代码块）：\n{\n  "characters": [\n    {\n      "name": "角色名",\n      "roleType": "主角/配角/反派",\n      "alias": "别名/称号",\n      "appearance": "外貌特征",\n      "personality": "性格特点",\n      "goals": "目标/动机",\n      "background": "背景故事",\n      "relationships": [\n        { "target": "关系对象", "type": "师徒/敌对/恋人/亲人", "description": "关系描述" }\n      ]\n    }\n  ]\n}`;

  const result = await runStreamChat(
    [{ role: 'user', content: prompt }],
    await resolveRoleModelConfig('editor', model),
    { onChunk: (chunk) => { if (callbacks?.onChunk) callbacks.onChunk('deconstruct_characters', chunk); } },
    workId ? { workId, agentType: 'deconstruct', promptTemplate: 'deconstruct-characters.md' } : undefined
  );

  const data = extractJson(result.content) || {};
  return data.characters || [];
}

async function analyzeWorld(sampleText, model, callbacks, workId) {
  const prompt = `你是一位世界观设定专家。请从以下小说文本中提取世界观设定。\n\n文本样本：\n${sampleText.substring(0, 6000)}\n\n请输出 JSON（不要加 markdown 代码块）：\n{\n  "worldLore": [\n    { "category": "力量体系/种族/势力/历史/规则/道具/地理/其他", "title": "设定名称", "content": "详细描述", "tags": ["标签1"], "importance": 1-5 }\n  ],\n  "mapRegions": [\n    { "name": "区域名", "regionType": "大陆/国家/城市/宗门/秘境", "parentName": "上级区域", "description": "描述" }\n  ],\n  "plotLines": [\n    { "name": "剧情线名称", "type": "主线/支线", "nodes": [{ "title": "节点名", "description": "描述", "nodeType": "开端/发展/高潮/结局" }] }\n  ]\n}`;

  const result = await runStreamChat(
    [{ role: 'user', content: prompt }],
    await resolveRoleModelConfig('outline', model),
    { onChunk: (chunk) => { if (callbacks?.onChunk) callbacks.onChunk('deconstruct_world', chunk); } },
    workId ? { workId, agentType: 'deconstruct', promptTemplate: 'deconstruct-world.md' } : undefined
  );

  const data = extractJson(result.content) || {};
  return {
    worldLore: data.worldLore || [],
    mapRegions: data.mapRegions || [],
    plotLines: data.plotLines || [],
  };
}

async function analyzeStyle(sampleText, model, callbacks) {
  const fingerprint = await authorFingerprint.analyzeFullFingerprint(
    sampleText,
    '拆书临时分析',
    '从拆书流程中自动分析的风格指纹'
  );

  return {
    narrativeLayer: fingerprint.narrativeLayer,
    characterLayer: fingerprint.characterLayer,
    plotLayer: fingerprint.plotLayer,
    languageLayer: fingerprint.languageLayer,
    worldLayer: fingerprint.worldLayer,
    sampleParagraphs: fingerprint.sampleParagraphs,
  };
}

async function analyzeVoices(chapters, model, callbacks) {
  const allText = chapters.map((c) => c.content).join('\n');
  const dialogues = voiceFingerprint.extractDialogues(allText);

  const bySpeaker = {};
  for (const { speaker, text } of dialogues) {
    if (!bySpeaker[speaker]) bySpeaker[speaker] = [];
    bySpeaker[speaker].push(text);
  }

  const results = [];
  for (const [charName, texts] of Object.entries(bySpeaker)) {
    if (texts.length < 3) continue;
    const fingerprint = voiceFingerprint.analyzeSpeakerVoice(texts);
    if (fingerprint) results.push({ charName, fingerprint });
  }

  return results;
}

async function generateSummary(analysis, model, callbacks, workId) {
  const prompt = `请根据以下拆书分析结果，生成一份结构化的拆书总结报告。\n\n作品：${analysis.title}\n章节数：${analysis.chapterCount}\n总字数：${analysis.totalChars}\n\n结构分析：\n${JSON.stringify(analysis.structure, null, 2)}\n\n人物数量：${analysis.characters.length}\n世界观条目：${analysis.world.worldLore.length}\n\n请输出一份面向作者的拆书报告，包含：\n1. 作品整体评价（100字）\n2. 可学习的亮点（3-5条）\n3. 可复用的套路/技巧（3-5条）\n4. 适合模仿的风格特征（3-5条）`;

  const result = await runStreamChat(
    [{ role: 'user', content: prompt }],
    await resolveRoleModelConfig('editor', model),
    { onChunk: (chunk) => { if (callbacks?.onChunk) callbacks.onChunk('deconstruct_summary', chunk); } },
    workId ? { workId, agentType: 'deconstruct', promptTemplate: 'deconstruct-summary.md' } : undefined
  );

  return result.content;
}

// ============ 一键创建产物 ============

async function createArtifacts(analysis, options = {}) {
  const artifacts = {
    template: null,
    fingerprint: null,
    prompt: null,
  };

  // 1. 创建 StoryTemplate
  if (analysis.structure) {
    const template = await StoryTemplate.create({
      scope: 'global',
      name: `${analysis.meta.title} 套路`,
      category: analysis.structure.genre || '其他',
      description: analysis.summary?.substring(0, 500) || '',
      beatStructure: analysis.structure.beatStructure || [],
      tags: [analysis.structure.genre, '拆书提取'].filter(Boolean),
    });
    artifacts.template = template;
  }

  // 2. 创建 AuthorFingerprint
  if (analysis.style) {
    const fingerprint = await AuthorFingerprint.create({
      name: `${analysis.meta.title} 风格`,
      description: `从《${analysis.meta.title}》拆书提取的全维度风格指纹`,
      narrativeLayer: analysis.style.narrativeLayer,
      characterLayer: analysis.style.characterLayer,
      plotLayer: analysis.style.plotLayer,
      languageLayer: analysis.style.languageLayer,
      worldLayer: analysis.style.worldLayer,
      sampleParagraphs: analysis.style.sampleParagraphs || [],
    });
    artifacts.fingerprint = fingerprint;
  }

  // 3. 创建 Prompt
  const promptContent = await generateWriterPromptFromAnalysis(analysis, options.model, options.workId);
  if (promptContent) {
    const [promptRow] = await Prompt.findOrCreate({
      where: { name: `deconstructed_${Date.now()}`, lang: 'zh' },
      defaults: {
        name: `deconstructed_${Date.now()}`,
        lang: 'zh',
        content: promptContent,
      },
    });
    artifacts.prompt = promptRow;
  }

  return artifacts;
}

async function generateWriterPromptFromAnalysis(analysis, model, workId) {
  const prompt = `请根据以下拆书分析结果，生成一段可以直接用于 Writer Agent 的系统提示词（System Prompt）。\n\n作品：${analysis.meta.title}\n题材：${analysis.structure.genre || '未知'}\n\n结构模板：\n${JSON.stringify(analysis.structure.beatStructure, null, 2)}\n\n语言风格特征：\n- 平均句长：${analysis.style.languageLayer?.avgSentenceLength?.toFixed(1) || '未知'} 字\n- 对话占比：${((analysis.style.languageLayer?.dialogueRatio || 0) * 100).toFixed(1)}%\n- 叙事视角：${analysis.style.narrativeLayer?.povPreference || '未知'}\n- 章节结尾：${analysis.style.narrativeLayer?.chapterEndingStyle || '未知'}\n\n请输出一段 300-500 字的 Writer 系统提示词，要求：\n1. 明确指定该作品的风格特征\n2. 包含结构模板要求\n3. 包含对话和叙事的具体指令\n4. 可以直接作为 {{style}} 变量注入到 writer.md 中`;

  const result = await runStreamChat(
    [{ role: 'user', content: prompt }],
    await resolveRoleModelConfig('editor', model),
    {},
    workId ? { workId, agentType: 'deconstruct', promptTemplate: 'deconstruct-prompt.md' } : undefined
  );

  return result.content;
}

// ============ 工具函数 ============

function splitChapters(text) {
  const patterns = [
    /第[一二三四五六七八九十百千零\d]+章[^\n]*\n/g,
    /Chapter\s+\d+[^\n]*\n/gi,
    /\n#{1,2}\s+[^\n]+\n/g,
  ];

  let matches = [];
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m && m.length > 1) {
      matches = m;
      break;
    }
  }

  if (matches.length === 0) {
    const chunkSize = 3000;
    const chapters = [];
    for (let i = 0; i < text.length; i += chunkSize) {
      chapters.push({
        title: `第${Math.floor(i / chunkSize) + 1}章`,
        content: text.slice(i, i + chunkSize),
      });
    }
    return chapters;
  }

  const chapters = [];
  let lastIndex = 0;
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const start = text.indexOf(match, lastIndex);
    if (i > 0) {
      const prevStart = text.indexOf(matches[i - 1], lastIndex);
      chapters.push({
        title: matches[i - 1].trim(),
        content: text.slice(prevStart + matches[i - 1].length, start).trim(),
      });
    }
    lastIndex = start + match.length;
  }

  const lastMatchStart = text.indexOf(matches[matches.length - 1], 0);
  chapters.push({
    title: matches[matches.length - 1].trim(),
    content: text.slice(lastMatchStart + matches[matches.length - 1].length).trim(),
  });

  return chapters.filter((c) => c.content.length > 50);
}

module.exports = {
  deconstruct,
  createArtifacts,
  analyzeStructure,
  analyzeCharacters,
  analyzeWorld,
  analyzeStyle,
  analyzeVoices,
  splitChapters,
};
