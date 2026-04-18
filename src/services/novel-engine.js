const path = require('path');
const fs = require('fs');
const ProviderFactory = require('../providers/factory');
const { appendChapterToIndex, buildAntiRepetitionReminder } = require('./memory-index');
const { loadPrompt, loadPromptRaw, renderTemplate } = require('./prompt-loader');
const { WORKS_DIR, ensureDir, getWorkDir, sanitizeWorkId } = require('../core/paths');
const { runStreamChat } = require('../core/chat');
const { getAuthorStyle, getPlatformStyle, buildReviewDimensionsText, resolveRoleModelConfig, getChapterConfig, getWritingMode } = require('./settings-store');
const { initDb, Work, Volume, Chapter, sequelize } = require('../models');
const fileStore = require('./file-store');
const { getWorldContextForPrompt } = require('./world-context');
const { evaluateChapterFitness, saveFitness } = require('./fitness-evaluator');
const { buildRagContext, indexChapterSummary } = require('./rag-retriever');
const truthManager = require('./truth-manager');
const outputGovernance = require('./output-governance');

const engineCfg = require('../../config/engine.json');
const SUMMARY_WINDOW_SIZE = engineCfg.context.summaryWindowSize;
const FULL_TEXT_THRESHOLD = engineCfg.context.fullTextThreshold;

async function buildEditHistory(workId, chapterNumber, currentRound) {
  const histories = [];
  const maxCharsPerRound = 1500;
  for (let r = 1; r < currentRound; r++) {
    const content = await readFile(workId, `chapter_${chapterNumber}_edit_v${r}.txt`);
    if (content) {
      const truncated = content.substring(0, maxCharsPerRound);
      histories.push(`【第${r}轮评审意见】\n${truncated}${content.length > maxCharsPerRound ? '\n...(已截断)' : ''}`);
    }
  }
  if (histories.length === 0) return '';
  return '\n\n========== 历史评审记录 ==========\n' + histories.join('\n\n') + '\n\n========== 以上为之前各轮的评审意见，供你对比参考 ==========\n';
}

function parseEditorVerdict(content) {
  const dimensions = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*\d+\.\s*(.+?)\s*[：:]\s*\[(是|否)\]\s*(.*)$/);
    if (match) {
      dimensions.push({ name: match[1].trim(), passed: match[2] === '是', reason: match[3].trim() });
    }
  }

  const yesCount = dimensions.length > 0 ? dimensions.filter(d => d.passed).length : (content.match(/\[是\]/g) || []).length;
  const noCount = dimensions.length > 0 ? dimensions.filter(d => !d.passed).length : (content.match(/\[否\]/g) || []).length;
  const total = yesCount + noCount;
  const passRate = total > 0 ? yesCount / total : 0;
  const hasPassKeyword = engineCfg.editing.passKeywords.some(kw =>
    content.includes(kw) || content.toLowerCase().includes(kw.toLowerCase())
  );
  const hasFailKeyword = content.includes('不通过');
  return { yesCount, noCount, total, passRate: parseFloat(passRate.toFixed(4)), hasPassKeyword, hasFailKeyword, dimensions };
}

async function saveEditorReviewAsJson(workId, chapterNumber, content, verdict) {
  const reviewDir = path.join(getWorkDir(workId), `review_chapter_${chapterNumber}`);
  await fs.promises.mkdir(reviewDir, { recursive: true });

  const scores = {};
  for (const dim of verdict.dimensions || []) {
    scores[dim.name] = { score: dim.passed ? 10 : 0, reason: dim.reason };
  }
  // 兜底：没有维度解析时，按整体通过/不通过给分
  if (Object.keys(scores).length === 0) {
    scores['综合评审'] = { score: verdict.passRate >= 0.8 ? 10 : 0 };
  }

  const reviewJson = {
    passed: verdict.passRate >= 0.8,
    reviews: [{
      agent: 'editor',
      raw: content.substring(0, 3000),
      parsed: { scores }
    }],
    summary: {
      passRate: verdict.passRate,
      yesCount: verdict.yesCount,
      noCount: verdict.noCount,
      total: verdict.total
    },
    checkedAt: new Date().toISOString()
  };

  await fs.promises.writeFile(
    path.join(reviewDir, 'round_1.json'),
    JSON.stringify(reviewJson, null, 2),
    'utf-8'
  );
  console.log(`[editor] 第${chapterNumber}章评审结果已保存到 review_chapter_${chapterNumber}/round_1.json`);
}

async function expandAuthorStyle(authorStyle) {
  if (!authorStyle) return '';
  const custom = await getAuthorStyle(authorStyle);
  if (custom) return `${authorStyle}：${custom}`;
  return authorStyle;
}

async function expandPlatformStyle(platformStyle) {
  if (!platformStyle) return '';
  const custom = await getPlatformStyle(platformStyle);
  if (custom) return `${platformStyle}：${custom}`;
  return platformStyle;
}

async function expandStyle(platformStyle, authorStyle) {
  if (arguments.length === 1) {
    // legacy fallback: single style string
    const s = platformStyle || '';
    if (s.includes('热血磅礴') || s.includes('深情宿命') || s.includes('凡人') || s.includes('10后')) {
      return expandAuthorStyle(s);
    }
    return s;
  }
  const parts = [];
  const p = await expandPlatformStyle(platformStyle);
  const a = await expandAuthorStyle(authorStyle);
  if (p) parts.push(p);
  if (a) parts.push(a);
  return parts.join('；');
}

async function getChapterWordVariables() {
  const cfg = await getChapterConfig();
  return {
    targetWords: cfg.targetWords || 2000,
    minWords: cfg.minWords || 1800,
    maxWords: cfg.maxWords || 2200,
    absoluteMin: cfg.absoluteMin || 1600,
    absoluteMax: cfg.absoluteMax || 2500,
  };
}

async function resolvePromptName(baseName, workId = null) {
  const mode = await getWritingMode(workId);
  if (mode === 'free') {
    const freeName = `${baseName}-free`;
    try {
      const { loadPromptRaw } = require('./prompt-loader');
      await loadPromptRaw(freeName);
      return freeName;
    } catch {
      // 自由风模板不存在，回退到工业风
      return baseName;
    }
  }
  return baseName;
}

function generateWorkId(topic, strategy) {
  const safeTopic = topic.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_').substring(0, engineCfg.truncation.workIdTopicLength);
  const raw = `${Date.now()}_${safeTopic}_${strategy}`;
  const sanitized = sanitizeWorkId(raw);
  return sanitized || raw.replace(/[^a-zA-Z0-9_\-]/g, '_');
}

async function loadMeta(workId) {
  await initDb();
  const work = await Work.findByPk(workId, {
    include: [
      { model: Volume, as: 'volumes' },
      { model: Chapter, as: 'chapters' },
    ],
  });
  if (work) {
    const plain = work.toJSON();
    return {
      ...plain,
      volumes: (plain.volumes || []).sort((a, b) => a.number - b.number),
      chapters: (plain.chapters || []).sort((a, b) => a.number - b.number),
    };
  }
  const metaPath = path.join(getWorkDir(workId), 'meta.json');
  try {
    const data = await fs.promises.readFile(metaPath, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error(`[novel-engine] meta.json 读取失败 ${workId}:`, err.message);
  }
  const legacyJsonPath = path.join(WORKS_DIR, `${workId}.json`);
  try {
    const data = await fs.promises.readFile(legacyJsonPath, 'utf-8');
    const legacy = JSON.parse(data);
    const hasChapter = (legacy.steps || []).some(s => s.key === 'chapter' || s.key === 'polish');
    const chapterStep = (legacy.steps || []).find(s => s.key === 'polish') || (legacy.steps || []).find(s => s.key === 'chapter');
    return {
      workId,
      topic: legacy.topic || workId,
      style: legacy.style || '',
      strategy: legacy.strategy || 'single',
      outlineTheme: '',
      outlineDetailed: '',
      chapters: hasChapter ? [{
        number: 1,
        rawFile: null,
        polishFile: null,
        summaryFile: null,
        chars: chapterStep?.chars || 0,
      }] : [],
      createdAt: legacy.time || new Date().toISOString(),
      updatedAt: legacy.time || new Date().toISOString(),
      _legacy: true,
    };
  } catch (err) {
    console.error(`[novel-engine] legacy.json 读取失败 ${workId}:`, err.message);
  }
  return null;
}

async function saveMeta(workId, meta) {
  await initDb();
  const { volumes, chapters, ...workData } = meta;
  await Work.upsert({ ...workData, workId });
  if (volumes && volumes.length) {
    for (const vol of volumes) {
      await Volume.upsert({ ...vol, workId });
    }
  }
  if (chapters && chapters.length) {
    for (const ch of chapters) {
      await Chapter.upsert({ ...ch, workId });
    }
  }
  const metaPath = path.join(getWorkDir(workId), 'meta.json');
  try {
    await fs.promises.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
  } catch (err) {
    console.error('[novel-engine] saveMeta 写入本地文件失败:', err.message);
  }
}

async function writeFile(workId, filename, content) {
  await fileStore.writeFile(workId, filename, content);
  // 同时保留本地文件作为备份/导出
  const filePath = path.join(getWorkDir(workId), filename);
  ensureDir(path.dirname(filePath));
  try {
    await fs.promises.writeFile(filePath, content, 'utf-8');
  } catch (err) {
    console.error('[novel-engine] writeFile 写入本地文件失败:', err.message);
  }
  return filePath;
}

async function readFile(workId, filename) {
  return fileStore.readFile(workId, filename);
}

async function appendToFullTxt(workId, sectionTitle, content) {
  const header = sectionTitle ? `\n\n========== ${sectionTitle} ==========\n\n` : '\n';
  await fileStore.appendToFile(workId, 'full.txt', header + content);
  // 同时保留本地文件作为备份/导出
  const fullPath = path.join(getWorkDir(workId), 'full.txt');
  try {
    await fs.promises.appendFile(fullPath, header + content, 'utf-8');
  } catch (err) {
    console.error('[novel-engine] appendToFullTxt 写入本地文件失败:', err.message);
  }
}

function truncate(str, len) {
  if (!str) return '';
  const s = str.replace(/\n/g, ' ').trim();
  return s.length > len ? s.substring(0, len) + '…' : s;
}

async function listWorks() {
  await initDb();
  const buildWorkItem = (work) => {
    const rawTopic = (work.topic || '').trim();
    const firstLine = rawTopic.split('\n')[0].trim();
    return {
      workId: work.workId,
      title: truncate(firstLine, engineCfg.truncation.workTitleLength),
      desc: truncate(rawTopic, engineCfg.truncation.workDescLength),
      rawTopic,
      strategy: work.strategy,
      style: work.style,
      chapterCount: Number(work.chapterCount) || 0,
      updatedAt: work.updatedAt,
    };
  };

  const dbWorks = await Work.findAll({
    attributes: [
      'workId',
      'topic',
      'strategy',
      'style',
      'updatedAt',
      [sequelize.fn('COUNT', sequelize.col('chapters.id')), 'chapterCount'],
    ],
    include: [{ model: Chapter, as: 'chapters', attributes: [] }],
    group: ['Work.workId'],
    order: [['updatedAt', 'DESC']],
    raw: true,
  });
  const works = dbWorks.map(buildWorkItem);
  const seen = new Set(works.map((w) => w.workId));

  ensureDir(WORKS_DIR);
  const items = await fs.promises.readdir(WORKS_DIR);
  for (const item of items) {
    if (seen.has(item)) continue;
    const itemPath = path.join(WORKS_DIR, item);
    let stat;
    try {
      stat = await fs.promises.stat(itemPath);
    } catch { continue; }
    if (stat.isDirectory()) {
      const meta = await loadMeta(item);
      if (meta) {
        seen.add(item);
        works.push({
          workId: item,
          title: truncate((meta.topic || '').split('\n')[0].trim(), 40),
          desc: truncate(meta.topic || '', 120),
          rawTopic: meta.topic || '',
          strategy: meta.strategy,
          style: meta.style,
          chapterCount: meta.chapters?.length || 0,
          updatedAt: meta.updatedAt || stat.mtime.toISOString(),
        });
      }
    }
    if (item.endsWith('.json') && item !== 'meta.json') {
      const workId = item.replace(/\.json$/, '');
      if (seen.has(workId)) continue;
      const meta = await loadMeta(workId);
      if (meta) {
        seen.add(workId);
        works.push({
          workId,
          title: truncate((meta.topic || '').split('\n')[0].trim(), 40),
          desc: truncate(meta.topic || '', 120),
          rawTopic: meta.topic || '',
          strategy: meta.strategy,
          style: meta.style,
          chapterCount: meta.chapters?.length || 0,
          updatedAt: meta.updatedAt || stat.mtime.toISOString(),
        });
      }
    }
  }

  return works.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

// ============ 通用 Agent Prompts ============

async function generateChapterSummary(chapterContent, style, model, callbacks) {
  const prompt = await loadPrompt('summary', {
    style: await expandStyle(style),
    chapterContent: chapterContent.substring(0, engineCfg.truncation.chapterContentPreview),
  });
  return runStreamChat([{ role: 'user', content: prompt }], await resolveRoleModelConfig('summarizer', model), callbacks || {});
}

async function runFitnessEvaluation(workId, chapterNumber, chars) {
  try {
    const { evaluateChapterFitness, saveFitness } = require('./fitness-evaluator');
    const fitness = await evaluateChapterFitness(workId, chapterNumber, chars);
    await saveFitness(workId, chapterNumber, fitness);
    console.log(`[fitness] 第${chapterNumber}章 评估完成: ${fitness.score}`);
    return fitness;
  } catch (err) {
    console.error(`[fitness] 第${chapterNumber}章 评估失败:`, err.message);
    return null;
  }
}

async function generateReaderFeedback(chapterContent, style, model, callbacks) {
  const is10s = style.includes('10后');
  const extraDims = is10s ? `\n6. 中二燃度评分（1-10）及理由\n7. 梗密度是否合适（过多/过少/刚好）\n8. 是否希望立刻看到下一章（是/否）及原因` : '';
  const extraJson = is10s ? ', "chunibyo": {"score": 8, "reason": "..."}, "meme_density": "刚好", "immediate_next": {"want": true, "reason": "..."}' : '';

  const prompt = await loadPrompt('reader-feedback', {
    style: await expandStyle(style),
    chapterContent: chapterContent.substring(0, 3000),
    extraDims,
    extraJson,
  });

  return runStreamChat([{ role: 'user', content: prompt }], await resolveRoleModelConfig('reader', model), callbacks || {});
}

// ============ 上下文构建 ============

async function compressChapterText(workId, chapterNumber, text, model, callbacks) {
  const cacheFile = `chapter_${chapterNumber}_compressed.txt`;
  const cached = await readFile(workId, cacheFile);
  if (cached) return cached;

  const prompt = await loadPrompt('compress-chapter', { text });
  const result = await runStreamChat([{ role: 'user', content: prompt }], await resolveRoleModelConfig('summarizer', model), callbacks || {});
  await writeFile(workId, cacheFile, result.content);
  return result.content;
}

async function compressDistantSummaries(workId, start, end, model, callbacks) {
  const cacheFile = `context_distant_summary_${start}_${end}.txt`;
  const cached = await readFile(workId, cacheFile);
  if (cached) return cached;

  const summaries = [];
  for (let i = start; i <= end; i++) {
    const s = await readFile(workId, `chapter_${i}_summary.txt`);
    if (s) summaries.push(`第${i}章：${s}`);
  }
  if (summaries.length === 0) return '';

  const prompt = await loadPrompt('compress-distant', {
    start,
    end,
    summaries: summaries.join('\n'),
  });
  const result = await runStreamChat([{ role: 'user', content: prompt }], await resolveRoleModelConfig('summarizer', model), callbacks || {});
  await writeFile(workId, cacheFile, result.content);
  return result.content;
}

async function buildRollingContext(workId, meta, nextNumber, models, callbacks) {
  const contextParts = [];
  const isMultiAgent = meta.strategy === 'knowrite';
  const prevFile = isMultiAgent ? `chapter_${nextNumber - 1}_final.txt` : `chapter_${nextNumber - 1}_polish.txt`;
  const compressModel = models?.summarizer || models?.writer || 'deepseek-v3';

  // 1. 前1章：前4章保留全文，之后压缩
  if (nextNumber > 1) {
    const prevFull = await readFile(workId, prevFile);
    if (prevFull) {
      if (nextNumber - 1 <= FULL_TEXT_THRESHOLD) {
        contextParts.push(`【第${nextNumber - 1}章 全文】\n${prevFull}`);
      } else {
        const compressed = await compressChapterText(workId, nextNumber - 1, prevFull, compressModel, {
          onChunk: (chunk) => { if (callbacks?.onChunk) callbacks.onChunk(`compress_${nextNumber - 1}`, chunk); }
        });
        contextParts.push(`【第${nextNumber - 1}章 压缩提要】\n${compressed}`);
      }
    }
  }

  // 2. 近史摘要：保留最近 SUMMARY_WINDOW_SIZE 章
  const nearStart = Math.max(1, nextNumber - 1 - SUMMARY_WINDOW_SIZE);
  for (let i = nearStart; i < nextNumber - 1; i++) {
    const summary = await readFile(workId, `chapter_${i}_summary.txt`);
    if (summary) {
      contextParts.push(`【第${i}章 摘要】\n${summary}`);
    }
  }

  // 3. 远史摘要：更早的章节合并压缩
  if (nearStart > 1) {
    const distant = await compressDistantSummaries(workId, 1, nearStart - 1, compressModel, {
      onChunk: (chunk) => { if (callbacks?.onChunk) callbacks.onChunk('distant_summary', chunk); }
    });
    if (distant) {
      contextParts.unshift(`【远史提要 第1-${nearStart - 1}章】\n${distant}`);
    }
  }

  return contextParts.join('\n\n');
}

async function buildSmartContext(workId, meta, nextNumber, models, callbacks) {
  const timeWindow = await buildRollingContext(workId, meta, nextNumber, models, callbacks);

  // 读取当前卷纲章
  const currentVolume = meta.currentVolume || 1;
  let volumeOutline = await readFile(workId, `volume_${currentVolume}_outline.txt`);

  const windowStart = Math.max(1, nextNumber - 1 - SUMMARY_WINDOW_SIZE);
  const windowEnd = nextNumber - 1;

  const antiRepeat = await buildAntiRepetitionReminder(workId, volumeOutline, windowStart, windowEnd);

  // RAG 检索：基于当前卷纲章检索最相关的历史上下文
  let ragContext = '';
  try {
    ragContext = await buildRagContext(workId, volumeOutline || meta.outlineDetailed || '', nextNumber);
  } catch (err) {
    console.error('[novel-engine] RAG 检索失败:', err.message);
  }

  return {
    timeWindow,
    antiRepeat,
    ragContext,
    fullContext: timeWindow + antiRepeat + ragContext,
  };
}

async function writeChapterMultiAgent(workId, meta, nextNumber, models, callbacks) {
  const style = (await expandStyle(meta.platformStyle, meta.authorStyle)) || (await expandStyle(meta.style));
  const topic = meta.topic;
  const isMV = isMultivolumeStrategy(meta.strategy);
  const outlineDetailed = getCurrentVolumeOutline(workId, meta);
  const { fullContext: previousContext } = await buildSmartContext(workId, meta, nextNumber, models, {
    onChunk: (chunk) => { if (callbacks.onChunk) callbacks.onChunk(`context_${nextNumber}`, chunk); }
  });
  const worldContext = await getWorldContextForPrompt(workId, nextNumber);
  const isFreeMode = (await getWritingMode(workId)) === 'free';
  const MAX_EDIT_ROUNDS = isFreeMode ? engineCfg.editing.maxEditRoundsFree : engineCfg.editing.maxEditRounds;

  // 1. 作者：初稿
  if (callbacks.onStepStart) callbacks.onStepStart({ key: `raw_${nextNumber}`, name: `第${nextNumber}章 作者初稿`, model: models.writer });
  const wordVars = await getChapterWordVariables();
  let writerPrompt = await loadPrompt(await resolvePromptName('writer', workId), {
    style,
    topic,
    outlineTheme: meta.outlineTheme,
    outlineDetailed,
    previousContext,
    nextNumber,
    ...wordVars,
  });
  if (worldContext) writerPrompt += '\n\n【世界观上下文】\n' + worldContext;
  const rawResult = await runStreamChat([{ role: 'user', content: writerPrompt }], await resolveWriterModel(nextNumber, models.writer), {
    onChunk: (chunk) => { if (callbacks.onChunk) callbacks.onChunk(`raw_${nextNumber}`, chunk); }
  }, { workId, agentType: 'writer', promptTemplate: 'writer.md' });
  await writeFile(workId, `chapter_${nextNumber}_raw.txt`, rawResult.content);
  if (callbacks.onStepEnd) callbacks.onStepEnd(`raw_${nextNumber}`, rawResult);

  // 2. 编辑-作者改循环，直到编辑通过或达到最大轮次
  let currentDraft = rawResult.content;
  let lastEditResult = null;
  let lastEditedResult = null;
  let passedRound = 0;
  const prevFinal = nextNumber > 1 ? await readFile(workId, `chapter_${nextNumber - 1}_final.txt`) : '';

  for (let round = 1; round <= MAX_EDIT_ROUNDS; round++) {
    // 如果有上一轮的 edit.txt / edited.txt，先归档为 v{round-1}
    if (round > 1) {
      const prevEditContent = await readFile(workId, `chapter_${nextNumber}_edit.txt`);
      if (prevEditContent) {
        await writeFile(workId, `chapter_${nextNumber}_edit_v${round - 1}.txt`, prevEditContent);
        const prevEditPath = path.join(getWorkDir(workId), `chapter_${nextNumber}_edit.txt`);
        try {
          await fs.promises.access(prevEditPath);
          await fs.promises.rename(prevEditPath, path.join(getWorkDir(workId), `chapter_${nextNumber}_edit_v${round - 1}.txt`));
        } catch {
          // 本地文件不存在，忽略
        }
      }
      const prevEditedContent = await readFile(workId, `chapter_${nextNumber}_edited.txt`);
      if (prevEditedContent) {
        await writeFile(workId, `chapter_${nextNumber}_edited_v${round - 1}.txt`, prevEditedContent);
        const prevEditedPath = path.join(getWorkDir(workId), `chapter_${nextNumber}_edited.txt`);
        try {
          await fs.promises.access(prevEditedPath);
          await fs.promises.rename(prevEditedPath, path.join(getWorkDir(workId), `chapter_${nextNumber}_edited_v${round - 1}.txt`));
        } catch {
          // 本地文件不存在，忽略
        }
      }
    }

    // 编辑审阅
    const editKey = `edit_${nextNumber}${round > 1 ? '_r' + round : ''}`;
    const editName = `第${nextNumber}章 编辑审阅${round > 1 ? ' (第' + round + '轮)' : ''}`;
    if (callbacks.onStepStart) callbacks.onStepStart({ key: editKey, name: editName, model: models.editor });
    const editHistory = await buildEditHistory(workId, nextNumber, round);
    let editorPrompt = await loadPrompt(await resolvePromptName('editor', workId), {
      style,
      nextNumber,
      reviewDimensions: await buildReviewDimensionsText(style),
      prevFinal: prevFinal ? '\n上一章内容（供参考连贯性）：\n' + prevFinal.substring(0, engineCfg.truncation.previousChapterReference) + '\n' : '',
      roundLabel: round === 1 ? '初稿' : '第' + (round - 1) + '轮修改稿',
      currentDraft: currentDraft.substring(0, engineCfg.truncation.editDraftPreview),
      editHistory,
    });
    if (worldContext) editorPrompt += '\n\n【世界观上下文】\n' + worldContext;
    const editResult = await runStreamChat([{ role: 'user', content: editorPrompt }], await resolveRoleModelConfig('editor', models.editor), {
      onChunk: (chunk) => { if (callbacks.onChunk) callbacks.onChunk(editKey, chunk); }
    }, { workId, agentType: 'editor', promptTemplate: 'editor.md' });
    lastEditResult = editResult;
    await writeFile(workId, `chapter_${nextNumber}_edit.txt`, editResult.content);
    if (callbacks.onStepEnd) callbacks.onStepEnd(editKey, editResult);

    // 双重判定：关键词 + 维度通过率
    const verdict = parseEditorVerdict(editResult.content);
    const isPass =
      (verdict.hasPassKeyword && verdict.passRate >= 0.8) ||
      (!verdict.hasFailKeyword && verdict.passRate >= 0.8 && verdict.total > 0);
    console.log(`[editor] 第${nextNumber}章 第${round}轮评审结果: 关键词通过=${verdict.hasPassKeyword}, 通过率=${(verdict.passRate*100).toFixed(1)}%, 判定=${isPass ? '通过' : '不通过'}`);

    if (isPass) {
      passedRound = round;
      if (round === 1) {
        // 第一轮直接通过，edited = raw
        lastEditedResult = { content: currentDraft, chars: currentDraft.length, chunks: 0, durationMs: 0 };
        await writeFile(workId, `chapter_${nextNumber}_edited.txt`, currentDraft);
      }
      break;
    }

    // 未通过，且还有修改机会
    if (round < MAX_EDIT_ROUNDS) {
      const editedKey = `edited_${nextNumber}_r${round}`;
      const editedName = `第${nextNumber}章 作者改稿 (第${round}轮)`;
      if (callbacks.onStepStart) callbacks.onStepStart({ key: editedKey, name: editedName, model: models.writer });
      const revisePrompt = await loadPrompt('revise', {
        style,
        currentDraft,
        editContent: editResult.content,
        round,
      });
      const editedResult = await runStreamChat([{ role: 'user', content: revisePrompt }], await resolveWriterModel(nextNumber, models.writer), {
        onChunk: (chunk) => { if (callbacks.onChunk) callbacks.onChunk(editedKey, chunk); }
      });
      lastEditedResult = editedResult;
      currentDraft = editedResult.content;
      await writeFile(workId, `chapter_${nextNumber}_edited.txt`, editedResult.content);
      if (callbacks.onStepEnd) callbacks.onStepEnd(editedKey, editedResult);
    } else {
      // 最后一轮仍未通过，强制以最后一稿进入后续流程
      if (!lastEditedResult) {
        lastEditedResult = { content: currentDraft, chars: currentDraft.length, chunks: 0, durationMs: 0 };
      }
      await writeFile(workId, `chapter_${nextNumber}_edited.txt`, lastEditedResult.content);
    }
  }

  // 保存 editor 评审结果为 review JSON（供 fitness evaluator 使用）
  if (lastEditResult) {
    const finalVerdict = parseEditorVerdict(lastEditResult.content);
    await saveEditorReviewAsJson(workId, nextNumber, lastEditResult.content, finalVerdict);
  }

  // 3. 去AI化：风格化
  if (callbacks.onStepStart) callbacks.onStepStart({ key: `humanized_${nextNumber}`, name: `第${nextNumber}章 去AI化`, model: models.humanizer });
  const humanizePrompt = await loadPrompt(await resolvePromptName('humanizer', workId), {
    style,
    content: lastEditedResult.content,
  });
  const humanizedResult = await runStreamChat([{ role: 'user', content: humanizePrompt }], await resolveRoleModelConfig('humanizer', models.humanizer), {
    onChunk: (chunk) => { if (callbacks.onChunk) callbacks.onChunk(`humanized_${nextNumber}`, chunk); }
  });
  await writeFile(workId, `chapter_${nextNumber}_humanized.txt`, humanizedResult.content);
  if (callbacks.onStepEnd) callbacks.onStepEnd(`humanized_${nextNumber}`, humanizedResult);

  // 5. 校编：校对（自由风跳过）
  let finalResult;
  if (isFreeMode) {
    finalResult = humanizedResult;
    await writeFile(workId, `chapter_${nextNumber}_final.txt`, finalResult.content);
    await appendToFullTxt(workId, `第${nextNumber}章`, finalResult.content);
  } else {
    if (callbacks.onStepStart) callbacks.onStepStart({ key: `final_${nextNumber}`, name: `第${nextNumber}章 校编`, model: models.proofreader });
    const proofPrompt = await loadPrompt('proofreader', {
      content: humanizedResult.content,
    });
    finalResult = await runStreamChat([{ role: 'user', content: proofPrompt }], await resolveRoleModelConfig('proofreader', models.proofreader), {
      onChunk: (chunk) => { if (callbacks.onChunk) callbacks.onChunk(`final_${nextNumber}`, chunk); }
    });
    await writeFile(workId, `chapter_${nextNumber}_final.txt`, finalResult.content);
    await appendToFullTxt(workId, `第${nextNumber}章`, finalResult.content);
    if (callbacks.onStepEnd) callbacks.onStepEnd(`final_${nextNumber}`, finalResult);
  }

  // 6. 读者：反馈
  if (callbacks.onStepStart) callbacks.onStepStart({ key: `feedback_${nextNumber}`, name: `第${nextNumber}章 读者反馈`, model: models.reader });
  const feedbackResult = await generateReaderFeedback(finalResult.content, style, models.reader, {
    onChunk: (chunk) => { if (callbacks.onChunk) callbacks.onChunk(`feedback_${nextNumber}`, chunk); }
  });
  let feedbackJson = feedbackResult.content;
  // 尝试去掉 markdown 代码块
  feedbackJson = feedbackJson.replace(/```json\s*/i, '').replace(/```\s*$/m, '').trim();
  await writeFile(workId, `chapter_${nextNumber}_feedback.json`, feedbackJson);
  if (callbacks.onStepEnd) callbacks.onStepEnd(`feedback_${nextNumber}`, feedbackResult);

  // 7. 摘要
  if (callbacks.onStepStart) callbacks.onStepStart({ key: `summary_${nextNumber}`, name: `第${nextNumber}章 摘要`, model: models.summarizer });
  const summaryResult = await generateChapterSummary(finalResult.content, style, models.summarizer, {
    onChunk: (chunk) => { if (callbacks.onChunk) callbacks.onChunk(`summary_${nextNumber}`, chunk); }
  });
  await writeFile(workId, `chapter_${nextNumber}_summary.txt`, summaryResult.content);
  if (callbacks.onStepEnd) callbacks.onStepEnd(`summary_${nextNumber}`, summaryResult);

  // 更新智能检索索引
  try {
    await appendChapterToIndex(workId, nextNumber, summaryResult.content, style, models.summarizer);
  } catch (err) {
    console.error('[novel-engine] 更新智能检索索引失败:', err.message);
  }

  // RAG 向量索引：为章节摘要生成 embedding
  try {
    await indexChapterSummary(workId, nextNumber, summaryResult.content, models.summarizer);
  } catch (err) {
    console.error('[novel-engine] RAG 摘要索引失败:', err.message);
  }

  // 时序真相数据库：提取 truth delta 并更新
  try {
    const summaryDelta = extractTruthDeltaFromSummary(summaryResult.content, workId, nextNumber);
    if (summaryDelta) {
      await truthManager.applyChapterDelta(workId, nextNumber, summaryDelta);
      console.log(`[truth] 第${nextNumber}章 truth delta 已应用`);
    }
  } catch (err) {
    console.error('[novel-engine] truth delta 应用失败:', err.message);
  }

  // Fitness 评估
  const fitnessResult = await runFitnessEvaluation(workId, nextNumber, finalResult.chars);

  // 输出治理：入队
  try {
    await outputGovernance.enqueueChapter(workId, nextNumber, {
      fitnessScore: fitnessResult?.score,
    });
  } catch (err) {
    console.error('[novel-engine] 输出治理入队失败:', err.message);
  }

  return {
    rawFile: `chapter_${nextNumber}_raw.txt`,
    editFile: `chapter_${nextNumber}_edit.txt`,
    editedFile: `chapter_${nextNumber}_edited.txt`,
    humanizedFile: `chapter_${nextNumber}_humanized.txt`,
    finalFile: `chapter_${nextNumber}_final.txt`,
    feedbackFile: `chapter_${nextNumber}_feedback.json`,
    summaryFile: `chapter_${nextNumber}_summary.txt`,
    chars: finalResult.chars,
    models: {
      writer: models.writer,
      editor: models.editor,
      humanizer: models.humanizer,
      proofreader: models.proofreader,
      reader: models.reader,
      summarizer: models.summarizer,
    },
  };
}

// ============ Pipeline 单章流程（兼容旧版） ============

async function writeChapterPipeline(workId, meta, nextNumber, models, callbacks) {
  const style = (await expandStyle(meta.platformStyle, meta.authorStyle)) || (await expandStyle(meta.style));
  const outlineDetailed = getCurrentVolumeOutline(workId, meta);
  const { fullContext: previousContext } = await buildSmartContext(workId, meta, nextNumber, models, {
    onChunk: (chunk) => { if (callbacks.onChunk) callbacks.onChunk(`context_${nextNumber}`, chunk); }
  });
  const worldContext = await getWorldContextForPrompt(workId, nextNumber);
  const isFreeMode = (await getWritingMode(workId)) === 'free';

  // 生成正文
  if (callbacks.onStepStart) callbacks.onStepStart({ key: `chapter_${nextNumber}`, name: `第${nextNumber}章 正文`, model: models.writer });
  const wordVars = await getChapterWordVariables();
  let chapterPrompt = await loadPrompt(await resolvePromptName('chapter', workId), {
    topic: meta.topic,
    style,
    outlineTheme: meta.outlineTheme,
    outlineDetailed,
    previousContext,
    nextNumber,
    ...wordVars,
  });
  if (worldContext) chapterPrompt += '\n\n【世界观上下文】\n' + worldContext;
  const chapterResult = await runStreamChat([{ role: 'user', content: chapterPrompt }], await resolveWriterModel(nextNumber, models.writer), {
    onChunk: (chunk) => { if (callbacks.onChunk) callbacks.onChunk(`chapter_${nextNumber}`, chunk); }
  }, { workId, agentType: 'chapter', promptTemplate: 'chapter.md' });
  await writeFile(workId, `chapter_${nextNumber}.txt`, chapterResult.content);
  if (callbacks.onStepEnd) callbacks.onStepEnd(`chapter_${nextNumber}`, chapterResult);

  // 润色（自由风跳过，直接writer输出）
  let polishResult;
  if (isFreeMode) {
    polishResult = chapterResult;
    await writeFile(workId, `chapter_${nextNumber}_polish.txt`, polishResult.content);
    await appendToFullTxt(workId, `第${nextNumber}章`, polishResult.content);
  } else {
    if (callbacks.onStepStart) callbacks.onStepStart({ key: `polish_${nextNumber}`, name: `第${nextNumber}章 润色`, model: models.polish });
    const polishPrompt = await loadPrompt('polish', {
      style,
      content: chapterResult.content,
    });
    polishResult = await runStreamChat([{ role: 'user', content: polishPrompt }], await resolveRoleModelConfig('polish', models.polish), {
      onChunk: (chunk) => { if (callbacks.onChunk) callbacks.onChunk(`polish_${nextNumber}`, chunk); }
    });
    await writeFile(workId, `chapter_${nextNumber}_polish.txt`, polishResult.content);
    await appendToFullTxt(workId, `第${nextNumber}章`, polishResult.content);
    if (callbacks.onStepEnd) callbacks.onStepEnd(`polish_${nextNumber}`, polishResult);
  }

  // 读者反馈
  if (callbacks.onStepStart) callbacks.onStepStart({ key: `feedback_${nextNumber}`, name: `第${nextNumber}章 读者反馈`, model: models.reader });
  const feedbackResult = await generateReaderFeedback(polishResult.content, style, models.reader, {
    onChunk: (chunk) => { if (callbacks.onChunk) callbacks.onChunk(`feedback_${nextNumber}`, chunk); }
  });
  let feedbackJson = feedbackResult.content;
  feedbackJson = feedbackJson.replace(/```json\s*/i, '').replace(/```\s*$/m, '').trim();
  await writeFile(workId, `chapter_${nextNumber}_feedback.json`, feedbackJson);
  if (callbacks.onStepEnd) callbacks.onStepEnd(`feedback_${nextNumber}`, feedbackResult);

  // 摘要
  if (callbacks.onStepStart) callbacks.onStepStart({ key: `summary_${nextNumber}`, name: `第${nextNumber}章 摘要`, model: models.summarizer });
  const summaryResult = await generateChapterSummary(polishResult.content, style, models.summarizer, {
    onChunk: (chunk) => { if (callbacks.onChunk) callbacks.onChunk(`summary_${nextNumber}`, chunk); }
  });
  await writeFile(workId, `chapter_${nextNumber}_summary.txt`, summaryResult.content);
  if (callbacks.onStepEnd) callbacks.onStepEnd(`summary_${nextNumber}`, summaryResult);

  // 更新索引
  try {
    await appendChapterToIndex(workId, nextNumber, summaryResult.content, style, models.summarizer);
  } catch (err) {
    console.error('[novel-engine] 更新索引失败:', err.message);
  }

  // RAG 向量索引
  try {
    await indexChapterSummary(workId, nextNumber, summaryResult.content, models.summarizer);
  } catch (err) {
    console.error('[novel-engine] RAG 摘要索引失败:', err.message);
  }

  // 时序真相数据库：提取 truth delta 并更新
  try {
    const summaryDelta = extractTruthDeltaFromSummary(summaryResult.content, workId, nextNumber);
    if (summaryDelta) {
      await truthManager.applyChapterDelta(workId, nextNumber, summaryDelta);
      console.log(`[truth] 第${nextNumber}章 truth delta 已应用`);
    }
  } catch (err) {
    console.error('[novel-engine] truth delta 应用失败:', err.message);
  }

  // Fitness 评估
  const fitnessResult = await runFitnessEvaluation(workId, nextNumber, polishResult.chars);

  // 输出治理：入队
  try {
    await outputGovernance.enqueueChapter(workId, nextNumber, {
      fitnessScore: fitnessResult?.score,
    });
  } catch (err) {
    console.error('[novel-engine] 输出治理入队失败:', err.message);
  }

  return {
    rawFile: `chapter_${nextNumber}.txt`,
    polishFile: `chapter_${nextNumber}_polish.txt`,
    feedbackFile: `chapter_${nextNumber}_feedback.json`,
    summaryFile: `chapter_${nextNumber}_summary.txt`,
    chars: polishResult.chars,
    models: {
      writer: models.writer,
      polish: models.polish,
      reader: models.reader,
      summarizer: models.summarizer,
    },
  };
}


function isMultivolumeStrategy(strategy) {
  return strategy && (strategy.includes('multivolume') || strategy === 'mv');
}

async function getCurrentVolumeOutline(workId, meta) {
  if (!isMultivolumeStrategy(meta.strategy)) return meta.outlineDetailed || '';
  const currentVolume = meta.currentVolume || 1;
  const volOutline = await readFile(workId, `volume_${currentVolume}_outline.txt`);
  if (volOutline) return volOutline;
  return meta.outlineDetailed || '';
}

async function generateOutline(topic, style, model, callbacks, workId = null) {
  const wordVars = await getChapterWordVariables();
  let prompt = await loadPrompt('outline-theme', { topic, style: await expandStyle(style), ...wordVars });
  if (workId) {
    const worldCtx = await getWorldContextForPrompt(workId);
    if (worldCtx) prompt += '\n\n【世界观上下文】\n' + worldCtx;
  }
  return runStreamChat([{ role: 'user', content: prompt }], await resolveRoleModelConfig('outline', model), callbacks || {});
}

async function generateDetailedOutline(topic, style, outlineTheme, model, callbacks, workId = null) {
  const wordVars = await getChapterWordVariables();
  let prompt = await loadPrompt('outline-detailed', { topic, style: await expandStyle(style), outlineTheme, ...wordVars });
  if (workId) {
    const worldCtx = await getWorldContextForPrompt(workId);
    if (worldCtx) prompt += '\n\n【世界观上下文】\n' + worldCtx;
  }
  return runStreamChat([{ role: 'user', content: prompt }], await resolveRoleModelConfig('outline', model), callbacks || {});
}

async function generateMultivolumeOutline(topic, style, outlineDetailed, totalVolumes, model, callbacks, workId = null) {
  const wordVars = await getChapterWordVariables();
  let prompt = await loadPrompt('outline-multivolume', {
    topic,
    style: await expandStyle(style),
    outlineDetailed,
    totalVolumes,
    ...wordVars,
  });
  if (workId) {
    const worldCtx = await getWorldContextForPrompt(workId);
    if (worldCtx) prompt += '\n\n【世界观上下文】\n' + worldCtx;
  }
  return runStreamChat([{ role: 'user', content: prompt }], await resolveRoleModelConfig('outline', model), callbacks || {});
}

async function generateVolumeOutline(topic, style, outlineMultivolume, volumeNumber, model, callbacks, workId = null) {
  const wordVars = await getChapterWordVariables();
  let prompt = await loadPrompt('volume-outline', {
    topic,
    style: await expandStyle(style),
    ...wordVars,
    outlineMultivolume,
    volumeNumber,
  });
  if (workId) {
    const worldCtx = await getWorldContextForPrompt(workId);
    if (worldCtx) prompt += '\n\n【世界观上下文】\n' + worldCtx;
  }
  return runStreamChat([{ role: 'user', content: prompt }], await resolveRoleModelConfig('outline', model), callbacks || {});
}

async function startNovel(topic, style, strategy, customModels, callbacks, platformStyle, authorStyle, writingMode) {
  const workId = generateWorkId(topic, strategy);
  ensureDir(getWorkDir(workId));

  const outlineModel = customModels.outline;
  const isMV = isMultivolumeStrategy(strategy);

  // 预创建 meta 和 Work 记录，避免 WorkFile 外键约束失败
  let meta = {
    workId,
    topic,
    style,
    platformStyle: platformStyle || '',
    authorStyle: authorStyle || '',
    strategy,
    writingMode: writingMode || null,
    outlineTheme: '',
    outlineDetailed: '',
    outlineMultivolume: '',
    currentVolume: 1,
    chapters: [],
    reviews: {},
    fitness: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveMeta(workId, meta);

  // 1. 生成主题大纲
  if (callbacks.onStepStart) callbacks.onStepStart({ key: 'outline_theme', name: '生成主题大纲', model: outlineModel });
  const outlineThemeResult = await generateOutline(topic, style, outlineModel, {
    onChunk: (chunk) => { if (callbacks.onChunk) callbacks.onChunk('outline_theme', chunk); }
  }, workId);
  await writeFile(workId, 'outline_theme.txt', outlineThemeResult.content);
  if (callbacks.onStepEnd) callbacks.onStepEnd('outline_theme', outlineThemeResult);

  // 2. 生成详细纲章
  if (callbacks.onStepStart) callbacks.onStepStart({ key: 'outline_detailed', name: '生成详细纲章', model: outlineModel });
  const outlineDetailedResult = await generateDetailedOutline(topic, style, outlineThemeResult.content, outlineModel, {
    onChunk: (chunk) => { if (callbacks.onChunk) callbacks.onChunk('outline_detailed', chunk); }
  }, workId);
  await writeFile(workId, 'outline_detailed.txt', outlineDetailedResult.content);
  if (callbacks.onStepEnd) callbacks.onStepEnd('outline_detailed', outlineDetailedResult);

  let outlineMultivolume = '';
  let volumes = [];

  // 3. 多卷大纲
  if (isMV) {
    if (callbacks.onStepStart) callbacks.onStepStart({ key: 'outline_multivolume', name: '生成多卷大纲', model: outlineModel });
    const mvResult = await generateMultivolumeOutline(topic, style, outlineDetailedResult.content, 3, outlineModel, {
      onChunk: (chunk) => { if (callbacks.onChunk) callbacks.onChunk('outline_multivolume', chunk); }
    }, workId);
    outlineMultivolume = mvResult.content;
    await writeFile(workId, 'outline_multivolume.txt', outlineMultivolume);
    if (callbacks.onStepEnd) callbacks.onStepEnd('outline_multivolume', mvResult);

    // 生成各卷纲章
    const totalVolumes = engineCfg.generation.multivolumeTotalVolumes;
    for (let v = 1; v <= totalVolumes; v++) {
      const stepKey = `volume_outline_${v}`;
      if (callbacks.onStepStart) callbacks.onStepStart({ key: stepKey, name: `生成第${v}卷纲章`, model: outlineModel });
      const volResult = await generateVolumeOutline(topic, style, outlineMultivolume, v, outlineModel, {
        onChunk: (chunk) => { if (callbacks.onChunk) callbacks.onChunk(stepKey, chunk); }
      }, workId);
      await writeFile(workId, `volume_${v}_outline.txt`, volResult.content);
      if (callbacks.onStepEnd) callbacks.onStepEnd(stepKey, volResult);
      volumes.push({
        workId,
        number: v,
        title: `第${v}卷`,
        outlineFile: `volume_${v}_outline.txt`,
        chapterRange: [],
        status: v === 1 ? 'writing' : 'outlined',
      });
    }
  }

  // 更新 meta
  meta.outlineTheme = outlineThemeResult.content;
  meta.outlineDetailed = outlineDetailedResult.content;
  meta.outlineMultivolume = outlineMultivolume;
  meta.volumes = volumes.length ? volumes : undefined;

  // 5. 写第一章
  const chapterResult = strategy === 'knowrite'
    ? await writeChapterMultiAgent(workId, meta, 1, {
        writer: customModels.writer,
        editor: customModels.editor,
        humanizer: customModels.humanizer,
        proofreader: customModels.proofreader,
        reader: customModels.reader,
        summarizer: customModels.summarizer,
      }, callbacks)
    : await writeChapterPipeline(workId, meta, 1, {
        writer: customModels.writer || customModels.chapter,
        polish: customModels.polish,
        reader: customModels.reader,
        summarizer: customModels.summarizer,
      }, callbacks);

  meta.chapters.push({ number: 1, ...chapterResult });
  await saveMeta(workId, meta);

  if (callbacks.onDone) callbacks.onDone(meta);
  return { workId, meta };
}

async function continueNovel(workId, customModels, callbacks, options = {}) {
  const meta = await loadMeta(workId);
  if (!meta) throw new Error('作品不存在');

  const nextNumber = (meta.chapters?.length || 0) + 1;
  const strategy = meta.strategy;

  // 多卷切换
  if (options.targetVolume && isMultivolumeStrategy(strategy)) {
    meta.currentVolume = options.targetVolume;
  }

  const chapterResult = strategy === 'knowrite'
    ? await writeChapterMultiAgent(workId, meta, nextNumber, {
        writer: customModels.writer || meta.chapters?.[0]?.models?.writer,
        editor: customModels.editor || meta.chapters?.[0]?.models?.editor,
        humanizer: customModels.humanizer || meta.chapters?.[0]?.models?.humanizer,
        proofreader: customModels.proofreader || meta.chapters?.[0]?.models?.proofreader,
        reader: customModels.reader || meta.chapters?.[0]?.models?.reader,
        summarizer: customModels.summarizer || meta.chapters?.[0]?.models?.summarizer,
      }, callbacks)
    : await writeChapterPipeline(workId, meta, nextNumber, {
        writer: customModels.writer || customModels.chapter || meta.chapters?.[0]?.models?.writer,
        polish: customModels.polish || meta.chapters?.[0]?.models?.polish,
        reader: customModels.reader || meta.chapters?.[0]?.models?.reader,
        summarizer: customModels.summarizer || meta.chapters?.[0]?.models?.summarizer,
      }, callbacks);

  meta.chapters.push({ number: nextNumber, ...chapterResult });
  meta.updatedAt = new Date().toISOString();
  await saveMeta(workId, meta);

  if (callbacks.onDone) callbacks.onDone(meta);
  return { workId, meta };
}

async function importNovel(title, content, options = {}) {
  const workId = generateWorkId(title, 'import');
  ensureDir(getWorkDir(workId));
  const { style, platformStyle, authorStyle } = options;

  const meta = {
    workId,
    topic: title,
    style: style || '',
    platformStyle: platformStyle || '',
    authorStyle: authorStyle || '',
    strategy: 'import',
    outlineTheme: '',
    outlineDetailed: '',
    chapters: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveMeta(workId, meta);

  // 简单分章：按配置的目标字数切分，或按空行分隔
  const chapterCfg = await getChapterConfig();
  const targetSplit = (chapterCfg.targetWords || 2000) * engineCfg.generation.importSplitRatio;
  const segments = content.split(/\n{2,}/).filter(Boolean);
  const chapters = [];
  let currentBuffer = '';
  let chNum = 0;

  for (const seg of segments) {
    if (currentBuffer.length > targetSplit) {
      chNum++;
      await writeFile(workId, `chapter_${chNum}.txt`, currentBuffer.trim());
      chapters.push({ number: chNum, rawFile: `chapter_${chNum}.txt`, chars: currentBuffer.length });
      currentBuffer = seg;
    } else {
      currentBuffer += '\n\n' + seg;
    }
  }
  if (currentBuffer.trim()) {
    chNum++;
    await writeFile(workId, `chapter_${chNum}.txt`, currentBuffer.trim());
    chapters.push({ number: chNum, rawFile: `chapter_${chNum}.txt`, chars: currentBuffer.length });
  }

  meta.chapters = chapters;
  meta.updatedAt = new Date().toISOString();
  await saveMeta(workId, meta);
  return { workId, meta };
}

async function importOutline(title, outlineText, options = {}) {
  const workId = generateWorkId(title, 'outline');
  ensureDir(getWorkDir(workId));
  const { style, platformStyle, authorStyle, optimize } = options;

  const meta = {
    workId,
    topic: title,
    style: style || '',
    platformStyle: platformStyle || '',
    authorStyle: authorStyle || '',
    strategy: 'outline',
    outlineTheme: outlineText,
    outlineDetailed: outlineText,
    chapters: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveMeta(workId, meta);

  await writeFile(workId, 'outline_theme.txt', outlineText);

  let outlineDetailed = outlineText;
  if (optimize) {
    const result = await generateDetailedOutline(title, style || '', outlineText, undefined, {});
    outlineDetailed = result.content;
  }
  await writeFile(workId, 'outline_detailed.txt', outlineDetailed);

  meta.outlineDetailed = outlineDetailed;
  meta.updatedAt = new Date().toISOString();
  await saveMeta(workId, meta);
  return { workId, meta };
}

async function detectOutlineDeviation(workId, chapterNumber, text, model) {
  const meta = await loadMeta(workId);
  if (!meta) throw new Error('作品不存在');
  const outline = await getCurrentVolumeOutline(workId, meta);
  const prompt = `你是一位资深编辑，请判断以下第${chapterNumber}章正文是否偏离了给定大纲。\n\n大纲：\n${outline}\n\n正文：\n${text.substring(0, engineCfg.truncation.deviationCheckText)}\n\n请输出 JSON：\n{"severity": "low/medium/high", "reason": "...", "suggestions": ["..."]}`;
  const result = await runStreamChat([{ role: 'user', content: prompt }], await resolveRoleModelConfig('deviationCheck', model), {});
  let json = null;
  try {
    json = JSON.parse(result.content.replace(/```json\s*/i, '').replace(/```\s*$/m, '').trim());
  } catch {
    try {
      const m = result.content.match(/\{[\s\S]*\}/);
      if (m) json = JSON.parse(m[0]);
    } catch (err) {
      console.error('[novel-engine] 偏离检测结果解析失败:', err.message);
    }
  }
  if (!json) {
    json = { severity: 'low', reason: '无法判断', suggestions: [] };
  }
  return json;
}

async function correctOutlineDeviation(workId, chapterNumber, model, callbacks) {
  const meta = await loadMeta(workId);
  if (!meta) throw new Error('作品不存在');
  const ch = meta.chapters.find(c => c.number === chapterNumber);
  if (!ch) throw new Error('章节不存在');
  const isMulti = meta.strategy === 'knowrite';
  const file = isMulti ? (ch.finalFile || ch.humanizedFile) : ch.polishFile;
  const text = file ? await readFile(workId, file) : '';
  const outline = await getCurrentVolumeOutline(workId, meta);

  if (callbacks?.onStepStart) callbacks.onStepStart({ key: `correct_${chapterNumber}`, name: `纲章矫正`, model });
  const prompt = `你是一位职业作家。以下第${chapterNumber}章偏离了当前大纲，请对其进行矫正重写，使其严格贴合大纲走向，同时保持情节连贯和原有风格。\n\n大纲：\n${outline}\n\n当前章节：\n${text}\n\n请直接输出矫正后的完整章节。`;
  const result = await runStreamChat([{ role: 'user', content: prompt }], await resolveRoleModelConfig('deviationCheck', model), {
    onChunk: (chunk) => { if (callbacks?.onChunk) callbacks.onChunk(`correct_${chapterNumber}`, chunk); }
  });
  if (callbacks?.onStepEnd) callbacks.onStepEnd(`correct_${chapterNumber}`, result);

  const correctedFile = `chapter_${chapterNumber}_outline_corrected.txt`;
  await writeFile(workId, correctedFile, result.content);
  await appendToFullTxt(workId, `第${chapterNumber}章（纲章矫正版）`, result.content);
  return { corrected: true, filename: correctedFile, chars: result.chars };
}

async function correctStyle(workId, chapterNumber, newStyle, model, callbacks) {
  const meta = await loadMeta(workId);
  if (!meta) throw new Error('作品不存在');
  const ch = meta.chapters.find(c => c.number === chapterNumber);
  if (!ch) throw new Error('章节不存在');
  const isMulti = meta.strategy === 'knowrite';
  const file = isMulti ? (ch.finalFile || ch.humanizedFile) : ch.polishFile;
  const text = file ? await readFile(workId, file) : '';

  if (callbacks?.onStepStart) callbacks.onStepStart({ key: `style_correct_${chapterNumber}`, name: `风格矫正`, model });
  const prompt = `你是一位职业作家。请将以下第${chapterNumber}章改写为"${newStyle}"风格，保持情节不变，只调整语言风格、句式节奏和描写方式。\n\n当前章节：\n${text}\n\n请直接输出改写后的完整章节。`;
  const result = await runStreamChat([{ role: 'user', content: prompt }], await resolveRoleModelConfig('styleCorrect', model), {
    onChunk: (chunk) => { if (callbacks?.onChunk) callbacks.onChunk(`style_correct_${chapterNumber}`, chunk); }
  });
  if (callbacks?.onStepEnd) callbacks.onStepEnd(`style_correct_${chapterNumber}`, result);

  const correctedFile = `chapter_${chapterNumber}_style_corrected.txt`;
  await writeFile(workId, correctedFile, result.content);
  return { filename: correctedFile, chars: result.chars };
}

/**
 * 从章节摘要中提取 truth delta（用于时序真相数据库）
 * 
 * 当前策略：
 * 1. 尝试解析摘要中的 JSON 代码块（如果 Summarizer 被修改为输出结构化 delta）
 * 2. 如果失败，返回 null（后续可通过修改 Summarizer prompt 启用）
 * 
 * TODO: 扩展 Summarizer prompt 以输出 truth delta JSON
 */
function extractTruthDeltaFromSummary(summaryContent, workId, chapterNumber) {
  // 尝试提取 JSON 代码块
  const jsonMatch = summaryContent.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    try {
      const delta = JSON.parse(jsonMatch[1]);
      // 验证基本结构
      if (delta && (delta.characterChanges || delta.worldChanges || delta.newHooks || delta.newResources)) {
        return delta;
      }
    } catch (err) {
      // JSON 解析失败，忽略
    }
  }

  // 尝试提取 summary 末尾的 JSON（无代码块格式）
  const lastBrace = summaryContent.lastIndexOf('}');
  const firstBrace = summaryContent.lastIndexOf('{', lastBrace);
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      const delta = JSON.parse(summaryContent.slice(firstBrace, lastBrace + 1));
      if (delta && (delta.characterChanges || delta.worldChanges || delta.newHooks || delta.newResources)) {
        return delta;
      }
    } catch (err) {
      // 忽略
    }
  }

  // 当前 Summarizer 未输出结构化 delta，返回 null
  // 后续可通过修改 prompts/summary.md 启用
  return null;
}

module.exports = {
  expandStyle,
  generateWorkId,
  loadMeta,
  saveMeta,
  writeFile,
  readFile,
  appendToFullTxt,
  listWorks,
  startNovel,
  continueNovel,
  importNovel,
  importOutline,
  detectOutlineDeviation,
  correctOutlineDeviation,
  correctStyle,
  getWorkDir,
};
