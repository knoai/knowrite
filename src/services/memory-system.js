/**
 * 三层记忆系统 — 统一记忆架构
 *
 * 将现有分散的记忆模块整合为三层记忆模型：
 * ┌─────────────────────────────────────────┐
 * │  Working Memory  （工作记忆）            │
 * │  当前章节正在使用的上下文窗口              │
 * │  → buildWorkingContext()                │
 * ├─────────────────────────────────────────┤
 * │  Episodic Memory （情节记忆 / 经历记忆）   │
 * │  角色经历、事件流、时间线                  │
 * │  → buildEpisodicContext()               │
 * ├─────────────────────────────────────────┤
 * │  Semantic Memory （语义记忆 / 知识记忆）   │
 * │  世界观、规则、人物设定、声纹字典           │
 * │  → buildSemanticContext()               │
 * └─────────────────────────────────────────┘
 *
 * 对外提供统一 API：
 * - buildMemoryContext(workId, meta, chapterNumber, options)
 * - refreshCharacterMemories(workId, chapterNumber, chapterText, summaryText)
 */

const contextBuilder = require('./novel/context-builder');
const temporalTruth = require('./temporal-truth');
const truthManager = require('./truth-manager');
const characterMemory = require('./character-memory');
const voiceFingerprint = require('./voice-fingerprint');
const worldContext = require('./world-context');
const memoryIndex = require('./memory-index');
const ragRetriever = require('./rag-retriever');

// ============ 统一 API ============

/**
 * 构建完整的三层记忆上下文
 *
 * @param {string} workId
 * @param {object} meta — 作品元数据
 * @param {number} chapterNumber — 当前章节号
 * @param {object} models — 模型配置
 * @param {object} callbacks — SSE 回调
 * @param {object} options — 可选配置
 *   - enableWorking: true
 *   - enableEpisodic: true
 *   - enableSemantic: true
 *   - maxWorkingTokens: 6000
 *   - maxEpisodicTokens: 2000
 *   - maxSemanticTokens: 3000
 */
async function buildMemoryContext(workId, meta, chapterNumber, models, callbacks, options = {}) {
  const {
    enableWorking = true,
    enableEpisodic = true,
    enableSemantic = true,
  } = options;

  const layers = {
    working: null,
    episodic: null,
    semantic: null,
  };

  // Layer 1: Working Memory（滚动上下文 + RAG + 反重复）
  if (enableWorking) {
    layers.working = await contextBuilder.buildSmartContext(
      workId,
      meta,
      chapterNumber,
      models,
      callbacks
    );
  }

  // Layer 2: Episodic Memory（时序真相 + 角色经历）
  if (enableEpisodic) {
    layers.episodic = await buildEpisodicContext(workId, chapterNumber);
  }

  // Layer 3: Semantic Memory（世界观 + 声纹 + 智能索引）
  if (enableSemantic) {
    layers.semantic = await buildSemanticContext(workId, chapterNumber);
  }

  // 组装完整上下文（按优先级排序）
  const parts = [];

  // Working 层最先（时间窗口、反重复、RAG）
  if (layers.working?.fullContext) {
    parts.push(layers.working.fullContext);
  }

  // Episodic 层次之（角色经历、事件状态）
  if (layers.episodic?.promptText) {
    parts.push(layers.episodic.promptText);
  }

  // Semantic 层最后（世界观、声纹）
  if (layers.semantic?.promptText) {
    parts.push(layers.semantic.promptText);
  }

  return {
    layers,
    fullContext: parts.filter(Boolean).join('\n\n'),
    summary: {
      workingTokens: estimateTokens(layers.working?.fullContext),
      episodicTokens: estimateTokens(layers.episodic?.promptText),
      semanticTokens: estimateTokens(layers.semantic?.promptText),
      totalTokens: estimateTokens(parts.join('\n\n')),
    },
  };
}

/**
 * 章节完成后刷新所有记忆层
 */
async function refreshCharacterMemories(workId, chapterNumber, chapterText, summaryText) {
  const results = {
    voiceFingerprint: null,
    characterMemory: null,
    memoryIndex: null,
    truthDelta: null,
  };

  // 1. 声纹提取
  try {
    results.voiceFingerprint = await voiceFingerprint.extractFromChapter(workId, chapterNumber, chapterText);
  } catch (err) {
    console.error('[memory-system] 声纹提取失败:', err.message);
  }

  // 2. 角色经历记忆
  try {
    results.characterMemory = await characterMemory.extractEpisodesFromSummary(workId, chapterNumber, summaryText);
  } catch (err) {
    console.error('[memory-system] 角色记忆提取失败:', err.message);
  }

  // 3. 智能索引（已有 memory-index）
  try {
    const { appendChapterToIndex } = memoryIndex;
    results.memoryIndex = await appendChapterToIndex(workId, chapterNumber, summaryText);
  } catch (err) {
    console.error('[memory-system] 智能索引更新失败:', err.message);
  }

  // 4. RAG 向量索引
  try {
    const { indexChapterSummary } = require('./rag-retriever');
    results.ragIndex = await indexChapterSummary(workId, chapterNumber, summaryText);
  } catch (err) {
    console.error('[memory-system] RAG 索引失败:', err.message);
  }

  // 5. 时序真相数据库
  try {
    const { extractTruthDeltaFromSummary } = require('./novel/chapter-processor');
    const summaryDelta = extractTruthDeltaFromSummary(summaryText, workId, chapterNumber);
    if (summaryDelta) {
      results.truthDelta = await truthManager.applyChapterDelta(workId, chapterNumber, summaryDelta);
    }
  } catch (err) {
    console.error('[memory-system] Truth delta 应用失败:', err.message);
  }

  // 6. 更新投影文件
  try {
    await truthManager.regenerateProjections(workId);
    await voiceFingerprint.buildVoiceFingerprintProjection(workId);
  } catch (err) {
    console.error('[memory-system] 投影文件更新失败:', err.message);
  }

  return results;
}

// ============ 各层构建器 ============

async function buildEpisodicContext(workId, chapterNumber) {
  const lines = ['## 情节记忆（Episodic Memory）', ''];

  // 1. 相关角色近期经历
  try {
    const charMemory = await characterMemory.getCharacterMemoryPrompt(workId, [], chapterNumber, {
      maxEventsPerChar: 3,
      maxCharsPerEvent: 100,
      includeRelationships: true,
    });
    if (charMemory) {
      lines.push('### 角色近期经历');
      lines.push(charMemory.replace(/^## .+\n/, '').trim());
      lines.push('');
    }
  } catch (err) {
    console.error('[memory-system] 角色记忆加载失败:', err.message);
  }

  // 2. 即将到期的伏笔
  try {
    const openHooks = await truthManager.getOpenHooks(workId);
    const dueHooks = openHooks.filter((h) => h.targetChapter && h.targetChapter <= chapterNumber + 3);
    if (dueHooks.length) {
      lines.push('### 即将到期的伏笔');
      for (const h of dueHooks) {
        lines.push(`- [${h.importance}] ${h.description}（目标: 第${h.targetChapter}章）`);
      }
      lines.push('');
    }
  } catch (err) {
    console.error('[memory-system] 伏笔加载失败:', err.message);
  }

  // 3. 上一章关键角色状态
  try {
    const prevState = await temporalTruth.getCurrentState(workId);
    if (prevState?.characterStates?.length) {
      lines.push('### 角色当前状态快照');
      for (const c of prevState.characterStates.slice(0, 5)) {
        lines.push(`- ${c.charName}: ${c.location || '位置未知'}, ${c.health || '健康'}, ${c.mood || '平静'}`);
      }
      lines.push('');
    }
  } catch (err) {
    console.error('[memory-system] 角色状态加载失败:', err.message);
  }

  const promptText = lines.join('\n');
  return {
    promptText: promptText.trim().length > 30 ? promptText : '',
    hookCount: 0,
    characterCount: 0,
  };
}

async function buildSemanticContext(workId, chapterNumber) {
  const lines = ['## 语义记忆（Semantic Memory）', ''];

  // 1. 世界观设定（精简版，避免与 world-context 重复）
  try {
    const worldCtx = await worldContext.getWorldContextForPrompt(workId, chapterNumber);
    if (worldCtx) {
      lines.push('### 世界观设定');
      // 只取前 1500 字，避免过长
      lines.push(worldCtx.substring(0, 1500));
      lines.push('');
    }
  } catch (err) {
    console.error('[memory-system] 世界观加载失败:', err.message);
  }

  // 2. 角色声纹字典
  try {
    const voicePrompt = await voiceFingerprint.getVoiceFingerprintPrompt(workId);
    if (voicePrompt) {
      lines.push(voicePrompt);
      lines.push('');
    }
  } catch (err) {
    console.error('[memory-system] 声纹字典加载失败:', err.message);
  }

  // 3. 核心规则/设定索引（防重复的关键信息）
  try {
    const { buildAntiRepetitionReminder } = memoryIndex;
    // 这里传入空卷纲，只获取基于索引的通用防重复提醒
    const antiRepeat = await buildAntiRepetitionReminder(workId, '', 1, chapterNumber - 1);
    if (antiRepeat) {
      lines.push('### 已交代过的核心设定（禁止重复解释）');
      lines.push(antiRepeat.replace(/^【防重复提醒】\n/, '').replace(/请专注于.+/s, '').trim());
      lines.push('');
    }
  } catch (err) {
    console.error('[memory-system] 防重复提醒加载失败:', err.message);
  }

  const promptText = lines.join('\n');
  return {
    promptText: promptText.trim().length > 30 ? promptText : '',
  };
}

// ============ 工具 ============

function estimateTokens(text) {
  if (!text) return 0;
  // 粗略估算：1 个中文字 ≈ 1.5 tokens
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.round(chineseChars * 1.5 + otherChars * 0.3);
}

module.exports = {
  buildMemoryContext,
  refreshCharacterMemories,
  buildEpisodicContext,
  buildSemanticContext,
};
