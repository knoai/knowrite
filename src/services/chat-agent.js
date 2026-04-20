/**
 * 对话式创作代理 — Chat Agent
 *
 * 通过自然语言对话实现：
 * - 续写章节
 * - 修改章节/大纲/设定/人物
 * - 查询作品信息
 * - 创作建议与讨论
 *
 * 核心机制：
 * 1. 加载作品完整上下文（meta、大纲、章节、设定、人物）
 * 2. 构建系统提示词，告知 AI 当前作品的所有信息
 * 3. AI 分析用户意图，返回自然语言 + 操作标记
 * 4. 解析操作标记，执行实际的文件/数据库修改
 */

const fs = require('fs');
const path = require('path');
const { Work, Character, WorldLore, PlotLine, PlotNode, Chapter } = require('../models');
const { runStreamChat } = require('../core/chat');
const { resolveRoleModelConfig } = require('./settings-store');
const fileStore = require('./file-store');
const { getWorkDir } = require('../core/paths');

// ============ 主入口 ============

/**
 * 与作品进行对话式创作
 * @param {string} workId
 * @param {Array} messages - 对话历史 [{role, content}]
 * @param {object} options - { model, callbacks }
 */
async function chat(workId, messages, options = {}) {
  const { model, callbacks = {} } = options;

  // 1. 加载作品上下文
  const context = await loadWorkContext(workId);

  // 2. 构建系统提示词
  const systemPrompt = buildSystemPrompt(context);

  // 3. 组装完整消息
  const fullMessages = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  // 4. 调用 LLM 流式生成
  if (callbacks.onStepStart) {
    callbacks.onStepStart({ key: 'chat_agent', name: '对话式创作', model: model || '(默认)' });
  }

  const result = await runStreamChat(
    fullMessages,
    await resolveRoleModelConfig('writer', model),
    {
      onChunk: (chunk) => {
        if (callbacks.onChunk) callbacks.onChunk('chat_agent', chunk);
      },
    }
  );

  if (callbacks.onStepEnd) {
    callbacks.onStepEnd('chat_agent', { chars: result.chars, durationMs: result.durationMs });
  }

  // 5. 解析 AI 响应中的操作标记
  const actions = parseActionMarkers(result.content);

  // 6. 执行操作
  const executedActions = [];
  for (const action of actions) {
    try {
      const execResult = await executeAction(workId, action, context);
      executedActions.push({ action, success: true, result: execResult });
    } catch (err) {
      executedActions.push({ action, success: false, error: err.message });
      console.error('[chat-agent] 操作执行失败:', err.message);
    }
  }

  // 7. 返回处理后的内容（去掉操作标记，只保留自然语言）
  const cleanContent = stripActionMarkers(result.content);

  return {
    content: cleanContent,
    rawContent: result.content,
    actions: executedActions,
    chars: result.chars,
    durationMs: result.durationMs,
  };
}

// ============ 作品上下文加载 ============

async function loadWorkContext(workId) {
  const work = await Work.findByPk(workId);
  if (!work) throw new Error(`作品 ${workId} 不存在`);

  // 加载 meta
  const metaRaw = await fileStore.readFile(workId, 'meta.json');
  const meta = metaRaw ? JSON.parse(metaRaw) : {};

  // 加载大纲
  const outlineTheme = await fileStore.readFile(workId, 'outline_theme.txt') || '';
  const outlineDetailed = await fileStore.readFile(workId, 'outline_detailed.txt') || '';

  // 加载最近章节（最多5章）
  const chapters = await Chapter.findAll({
    where: { workId },
    order: [['number', 'DESC']],
    limit: 5,
  });

  const recentChapters = [];
  for (const ch of chapters) {
    const text = await fileStore.readFile(workId, ch.finalFile || ch.polishFile || ch.rawFile) || '';
    recentChapters.push({ number: ch.number, title: `第${ch.number}章`, content: text.substring(0, 1500) });
  }
  recentChapters.reverse();

  // 加载人物列表
  const characters = await Character.findAll({
    where: { workId },
    order: [['roleType', 'ASC'], ['name', 'ASC']],
    limit: 20,
  });

  // 加载世界观
  const worldLore = await WorldLore.findAll({
    where: { workId },
    order: [['importance', 'DESC']],
    limit: 20,
  });

  // 加载剧情线
  const plotLines = await PlotLine.findAll({
    where: { workId },
    order: [['createdAt', 'ASC']],
    limit: 10,
  });

  return {
    workId,
    topic: work.topic,
    style: work.style,
    platformStyle: work.platformStyle,
    authorStyle: work.authorStyle,
    strategy: work.strategy,
    meta,
    outlineTheme,
    outlineDetailed: outlineDetailed.substring(0, 3000),
    recentChapters,
    characters: characters.map((c) => ({
      name: c.name,
      roleType: c.roleType,
      alias: c.alias,
      status: c.status,
      personality: c.personality,
      goals: c.goals,
    })),
    worldLore: worldLore.map((w) => ({ category: w.category, title: w.title, content: w.content.substring(0, 200) })),
    plotLines: plotLines.map((p) => ({ name: p.name, type: p.type, status: p.status })),
  };
}

// ============ 系统提示词构建 ============

function buildSystemPrompt(context) {
  const parts = [];

  parts.push('# 系统指令：你是一位资深网络小说创作助手');
  parts.push('');
  parts.push('## 核心能力');
  parts.push('1. **续写**：根据上下文继续写作下一章或下一段');
  parts.push('2. **修改**：根据用户要求修改已有内容（章节、大纲、人物、世界观）');
  parts.push('3. **查询**：回答关于作品设定、剧情、人物的问题');
  parts.push('4. **建议**：提供创作建议、情节设计、人物塑造方案');
  parts.push('');
  parts.push('## 作品信息');
  parts.push(`- 作品名：${context.topic || '未命名'}`);
  parts.push(`- 风格：${context.style || '默认'}`);
  parts.push(`- 平台风格：${context.platformStyle || ''}`);
  parts.push(`- 创作策略：${context.strategy || 'pipeline'}`);
  parts.push('');

  if (context.outlineTheme) {
    parts.push('## 主题大纲');
    parts.push(context.outlineTheme.substring(0, 800));
    parts.push('');
  }

  if (context.outlineDetailed) {
    parts.push('## 详细大纲（前3000字）');
    parts.push(context.outlineDetailed);
    parts.push('');
  }

  if (context.characters.length) {
    parts.push('## 人物列表');
    for (const c of context.characters) {
      parts.push(`- ${c.name}${c.alias ? `（${c.alias}）` : ''} [${c.roleType}] ${c.personality ? `性格：${c.personality}` : ''}`);
    }
    parts.push('');
  }

  if (context.worldLore.length) {
    parts.push('## 世界观设定');
    for (const w of context.worldLore.slice(0, 10)) {
      parts.push(`- [${w.category}] ${w.title}：${w.content}`);
    }
    parts.push('');
  }

  if (context.plotLines.length) {
    parts.push('## 剧情线');
    for (const p of context.plotLines) {
      parts.push(`- ${p.type}「${p.name}」${p.status}`);
    }
    parts.push('');
  }

  if (context.recentChapters.length) {
    parts.push('## 最近章节（最近5章，每章前1500字）');
    for (const ch of context.recentChapters) {
      parts.push(`### 第${ch.number}章`);
      parts.push(ch.content);
      parts.push('');
    }
  }

  parts.push('## 操作标记语法');
  parts.push('当你需要修改文件时，请在自然语言回复之后，使用以下 XML 标记格式：');
  parts.push('');
  parts.push('```');
  parts.push('<action type="操作类型" target="目标">');
  parts.push('修改后的完整内容');
  parts.push('</action>');
  parts.push('```');
  parts.push('');
  parts.push('支持的操作类型：');
  parts.push('- `continue_chapter`：续写下一章，target 填下一章的章节号（如 chapter_6）');
  parts.push('- `edit_chapter`：修改已有章节，target 填章节号（如 chapter_3）');
  parts.push('- `edit_outline_theme`：修改主题大纲');
  parts.push('- `edit_outline_detailed`：修改详细大纲');
  parts.push('- `edit_character`：修改人物设定，target 填人物名');
  parts.push('- `edit_world`：修改世界观设定，target 填设定标题');
  parts.push('');
  parts.push('## 回复规则');
  parts.push('1. 先以自然语言回复用户，说明你的理解和计划');
  parts.push('2. 如果涉及修改，在末尾使用 <action> 标记输出修改后的完整内容');
  parts.push('3. 续写时，直接输出完整的章节正文（不需要 action 标记）');
  parts.push('4. 查询时，直接回答，不需要 action 标记');
  parts.push('5. 修改章节时，必须输出完整的章节内容，不能只输出修改部分');
  parts.push('');

  return parts.join('\n');
}

// ============ 操作标记解析 ============

function parseActionMarkers(text) {
  const actions = [];
  const regex = /<action\s+type="([^"]+)"\s+target="([^"]*)">([\s\S]*?)<\/action>/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    actions.push({
      type: match[1].trim(),
      target: match[2].trim(),
      content: match[3].trim(),
    });
  }
  return actions;
}

function stripActionMarkers(text) {
  return text.replace(/<action\s+type="[^"]+"\s+target="[^"]*">[\s\S]*?<\/action>/g, '').trim();
}

// ============ 操作执行 ============

async function executeAction(workId, action, context) {
  const { type, target, content } = action;

  switch (type) {
    case 'continue_chapter':
    case 'edit_chapter': {
      const chapterNumber = parseInt(target.replace(/\D/g, ''), 10) || context.recentChapters.length + 1;
      const filename = `chapter_${chapterNumber}_raw.txt`;
      await fileStore.writeFile(workId, filename, content);
      // 同步写入本地文件
      const localPath = path.join(getWorkDir(workId), filename);
      await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
      await fs.promises.writeFile(localPath, content, 'utf-8');
      return { type: 'chapter', chapterNumber, filename };
    }

    case 'edit_outline_theme': {
      await fileStore.writeFile(workId, 'outline_theme.txt', content);
      const localPath = path.join(getWorkDir(workId), 'outline_theme.txt');
      await fs.promises.writeFile(localPath, content, 'utf-8');
      // 同步更新数据库
      await Work.update({ outlineTheme: content }, { where: { workId } });
      return { type: 'outline_theme' };
    }

    case 'edit_outline_detailed': {
      await fileStore.writeFile(workId, 'outline_detailed.txt', content);
      const localPath = path.join(getWorkDir(workId), 'outline_detailed.txt');
      await fs.promises.writeFile(localPath, content, 'utf-8');
      await Work.update({ outlineDetailed: content }, { where: { workId } });
      return { type: 'outline_detailed' };
    }

    case 'edit_character': {
      const char = await Character.findOne({ where: { workId, name: target } });
      if (!char) {
        // 创建新人物
        const created = await Character.create({
          workId,
          name: target,
          notes: content,
        });
        return { type: 'character', created: true, charId: created.id };
      }
      await char.update({ notes: content });
      return { type: 'character', created: false, charId: char.id };
    }

    case 'edit_world': {
      const lore = await WorldLore.findOne({ where: { workId, title: target } });
      if (!lore) {
        const created = await WorldLore.create({
          workId,
          title: target,
          content,
          category: '其他',
        });
        return { type: 'world', created: true, loreId: created.id };
      }
      await lore.update({ content });
      return { type: 'world', created: false, loreId: lore.id };
    }

    default:
      throw new Error(`不支持的操作类型: ${type}`);
  }
}

// ============ 快捷方法 ============

/**
 * 续写下一章（快捷方法）
 */
async function continueNextChapter(workId, options = {}) {
  const context = await loadWorkContext(workId);
  const nextNumber = (context.recentChapters.length > 0
    ? Math.max(...context.recentChapters.map((c) => c.number))
    : 0) + 1;

  const messages = [
    {
      role: 'user',
      content: `请续写第${nextNumber}章。要求：与已有剧情保持连贯，保持作品风格，每章约2000-3000字。`,
    },
  ];

  return chat(workId, messages, options);
}

/**
 * 修改指定章节（快捷方法）
 */
async function editChapter(workId, chapterNumber, instruction, options = {}) {
  const chapterText = await fileStore.readFile(workId, `chapter_${chapterNumber}_final.txt`)
    || await fileStore.readFile(workId, `chapter_${chapterNumber}_polish.txt`)
    || await fileStore.readFile(workId, `chapter_${chapterNumber}_raw.txt`)
    || '';

  const messages = [
    {
      role: 'user',
      content: `请修改第${chapterNumber}章。\n\n修改要求：${instruction}\n\n当前章节内容：\n${chapterText.substring(0, 3000)}`,
    },
  ];

  return chat(workId, messages, options);
}

module.exports = {
  chat,
  continueNextChapter,
  editChapter,
  loadWorkContext,
  buildSystemPrompt,
  parseActionMarkers,
  stripActionMarkers,
  executeAction,
};
