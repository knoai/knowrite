const express = require('express');
const path = require('path');
const fs = require('fs');
const { PausedError } = require('../services/pause-utils');
const { startNovel, continueNovel, tryCreateOutline, tryCreateDetailedOutline, tryCreateChapters, tryContinue, importNovel, importOutline, detectOutlineDeviation, correctOutlineDeviation, correctStyle, listWorks, deleteWork, getWorkDir, loadMeta } = require("../services/novel-engine");
const { expandStyle } = require('../services/novel/novel-utils');
const { loadPrompt } = require('../services/prompt-loader');
const { checkContentRepetition, repairContentRepetition } = require('../services/memory-index');
const { planChapterBeats } = require('../services/novel/chapter-planner');
const { loadFitness } = require('../services/fitness-evaluator');
const { evolvePrompt, applyCandidate } = require('../services/prompt-evolver');
const { listPrompts } = require('../services/prompt-loader');
const { getSettings, saveSettings, getAuthorStyles, saveAuthorStyles, getPlatformStyles, savePlatformStyles, getReviewDimensions, saveReviewDimensions, getReviewPreset, setReviewPreset, getModelConfig, saveModelConfig, switchProvider, getChapterConfig, saveChapterConfig, getWritingMode, saveWritingMode, getRoleModelConfig, getModelLibrary, saveModelLibrary, getAgentModelConfig, setAgentModelConfig, listAgentModelConfigs, saveAgentModelConfigs, getConfig, saveConfig } = require('../services/settings-store');
const { runStreamChat } = require('../core/chat');
const fileStore = require('../services/file-store');
const { readFile } = fileStore;
const { extractWorldFromOutlines } = require('../services/world-extractor');
const { validateBody } = require('../middleware/validator');
const { startSchema, continueSchema, importSchema, importOutlineSchema } = require('../schemas/novel');

const WORKS_DIR = path.join(__dirname, '../../works');
const router = express.Router();

async function readFileIfExists(filePath) {
  try {
    await fs.promises.access(filePath);
    return await fs.promises.readFile(filePath, 'utf-8');
  } catch { return ''; }
}

async function readDirIfExists(dirPath) {
  try {
    await fs.promises.access(dirPath);
    return await fs.promises.readdir(dirPath);
  } catch { return []; }
}

// SSE helper
function sse(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  let ended = false;
  return {
    send: (data) => {
      if (ended) return;
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        if (res.flush) res.flush();
      } catch (writeErr) {
        console.error('[sse] write error:', writeErr.message);
        ended = true;
      }
    },
    end: () => {
      if (ended) return;
      ended = true;
      try { res.end(); } catch (e) { /* ignore */ }
    },
  };
}

function sendError(stream, err, context = '') {
  const msg = err?.message || String(err) || '未知错误';
  const stack = err?.stack || '';
  console.error(`[sse-error${context ? ' ' + context : ''}]`, msg, stack);
  stream.send({ type: 'error', message: msg, context });
  stream.end();
}

router.post('/start', validateBody(startSchema), async (req, res) => {
  const { topic, style, platformStyle, authorStyle, strategy, customModels, writingMode, language } = req.body || {};
  if (!topic || (!style && (!platformStyle || !authorStyle))) {
    return res.status(400).json({ error: 'Missing topic or style information' });
  }
  const stream = sse(res);

  try {
    await startNovel(topic, style, strategy || 'pipeline', customModels || {}, {
      onStepStart(step) {
        stream.send({ type: 'stepStart', step: step.key, name: step.name, model: step.model });
      },
      onChunk(stepKey, chunk) {
        stream.send({ type: 'chunk', step: stepKey, chunk });
      },
      onStepEnd(stepKey, result) {
        stream.send({ type: 'stepEnd', step: stepKey, chars: result.chars, durationMs: result.durationMs });
      },
      onDone(meta) {
        stream.send({ type: 'done', meta });
        stream.end();
      },
    }, platformStyle, authorStyle, writingMode, storyTemplate, language);
  } catch (err) {
    if (err && err.name === 'PausedError') {
      stream.send({ type: 'paused', step: err.step, message: err.message });
      stream.end();
    } else {
      sendError(stream, err, '/start');
    }
  }
});

router.post('/continue', validateBody(continueSchema), async (req, res) => {
  const { workId, customModels, targetVolume } = req.body || {};
  if (!workId) {
    return res.status(400).json({ error: '缺少 workId' });
  }
  const stream = sse(res);

  try {
    await continueNovel(workId, customModels || {}, {
      onStepStart(step) {
        stream.send({ type: 'stepStart', step: step.key, name: step.name, model: step.model });
      },
      onChunk(stepKey, chunk) {
        stream.send({ type: 'chunk', step: stepKey, chunk });
      },
      onStepEnd(stepKey, result) {
        stream.send({ type: 'stepEnd', step: stepKey, chars: result.chars, durationMs: result.durationMs });
      },
      onDone(meta) {
        stream.send({ type: 'done', meta });
        stream.end();
      },
    }, { targetVolume });
  } catch (err) {
    if (err && err.name === 'PausedError') {
      stream.send({ type: 'paused', step: err.step, message: err.message });
      stream.end();
    } else {
      sendError(stream, err, '/continue');
    }
  }
});

// Plan 模式：章节节拍规划
router.post('/plan', async (req, res) => {
  const { workId, chapterNumber, customModels } = req.body || {};
  if (!workId) {
    return res.status(400).json({ error: '缺少 workId' });
  }
  const stream = sse(res);

  try {
    const meta = await loadMeta(workId);
    if (!meta) {
      return res.status(404).json({ error: '作品不存在' });
    }
    const plan = await planChapterBeats(workId, meta, chapterNumber || (meta.chapters?.length + 1), customModels || {}, {
      onStepStart(step) {
        stream.send({ type: 'stepStart', step: step.key, name: step.name, model: step.model });
      },
      onChunk(stepKey, chunk) {
        stream.send({ type: 'chunk', step: stepKey, chunk });
      },
      onStepEnd(stepKey, result) {
        stream.send({ type: 'stepEnd', step: stepKey, chars: result.chars, durationMs: result.durationMs });
      },
    });
    stream.send({ type: 'plan', beats: plan?.beats || [], overallTone: plan?.overallTone || '', riskFlags: plan?.riskFlags || [] });
    stream.end();
  } catch (err) {
    sendError(stream, err, '/plan');
  }
});

// ============ 尝试创作（渐进式流程）============

router.post('/try/outline', async (req, res) => {
  const { topic, style, platformStyle, authorStyle, strategy, customModels, writingMode, storyTemplate, language } = req.body || {};
  if (!topic || (!style && (!platformStyle || !authorStyle))) {
    return res.status(400).json({ error: 'Missing topic or style information' });
  }
  const stream = sse(res);
  try {
    await tryCreateOutline(topic, style, strategy || 'pipeline', customModels || {}, {
      onStepStart(step) { stream.send({ type: 'stepStart', step: step.key, name: step.name, model: step.model }); },
      onChunk(stepKey, chunk) { stream.send({ type: 'chunk', step: stepKey, chunk }); },
      onStepEnd(stepKey, result) { stream.send({ type: 'stepEnd', step: stepKey, chars: result.chars, durationMs: result.durationMs }); },
      onDone(meta) { stream.send({ type: 'done', meta }); stream.end(); },
    }, platformStyle, authorStyle, writingMode, storyTemplate, language);
  } catch (err) {
    sendError(stream, err, '/try/outline');
  }
});

router.post('/try/detailed-outline', async (req, res) => {
  const { workId, customModels } = req.body || {};
  if (!workId) return res.status(400).json({ error: '缺少 workId' });
  const stream = sse(res);
  try {
    await tryCreateDetailedOutline(workId, customModels || {}, {
      onStepStart(step) { stream.send({ type: 'stepStart', step: step.key, name: step.name, model: step.model }); },
      onChunk(stepKey, chunk) { stream.send({ type: 'chunk', step: stepKey, chunk }); },
      onStepEnd(stepKey, result) { stream.send({ type: 'stepEnd', step: stepKey, chars: result.chars, durationMs: result.durationMs }); },
      onDone(meta) { stream.send({ type: 'done', meta }); stream.end(); },
    });
  } catch (err) {
    sendError(stream, err, '/try/detailed-outline');
  }
});

router.post('/try/chapters', async (req, res) => {
  const { workId, customModels, count } = req.body || {};
  if (!workId) return res.status(400).json({ error: '缺少 workId' });
  const stream = sse(res);
  try {
    await tryCreateChapters(workId, customModels || {}, {
      onStepStart(step) { stream.send({ type: 'stepStart', step: step.key, name: step.name, model: step.model }); },
      onChunk(stepKey, chunk) { stream.send({ type: 'chunk', step: stepKey, chunk }); },
      onStepEnd(stepKey, result) { stream.send({ type: 'stepEnd', step: stepKey, chars: result.chars, durationMs: result.durationMs }); },
      onDone(meta) { stream.send({ type: 'done', meta }); stream.end(); },
    }, count || 3);
  } catch (err) {
    sendError(stream, err, '/try/chapters');
  }
});

router.post('/try/continue', async (req, res) => {
  const { workId, customModels } = req.body || {};
  if (!workId) return res.status(400).json({ error: '缺少 workId' });
  const stream = sse(res);
  try {
    await tryContinue(workId, customModels || {}, {
      onStepStart(step) { stream.send({ type: 'stepStart', step: step.key, name: step.name, model: step.model }); },
      onChunk(stepKey, chunk) { stream.send({ type: 'chunk', step: stepKey, chunk }); },
      onStepEnd(stepKey, result) { stream.send({ type: 'stepEnd', step: stepKey, chars: result.chars, durationMs: result.durationMs }); },
      onDone(meta) { stream.send({ type: 'done', meta }); stream.end(); },
    });
  } catch (err) {
    sendError(stream, err, '/try/continue');
  }
});

router.get('/works', async (req, res) => {
  const works = await listWorks();
  res.json({ works });
});

router.get('/works/:workId', async (req, res) => {
  const workId = req.params.workId;
  const workDir = getWorkDir(workId);
  let isLegacy;
  try {
    await fs.promises.access(workDir);
    isLegacy = false;
  } catch {
    isLegacy = true;
  }
  const legacyTxtPath = path.join(WORKS_DIR, `${workId}.txt`);
  const legacyJsonPath = path.join(WORKS_DIR, `${workId}.json`);

  if (isLegacy) {
    const txtExists = !!(await readFileIfExists(legacyTxtPath));
    const jsonExists = !!(await readFileIfExists(legacyJsonPath));
    if (!txtExists && !jsonExists) {
      return res.status(404).json({ error: '作品不存在' });
    }
  }

  const meta = await loadMeta(workId);
  // 批量读取该作品的所有数据库文件
  const fileMap = isLegacy ? {} : await fileStore.readAllWorkFiles(workId);

  const fullText = isLegacy
    ? (await readFileIfExists(legacyTxtPath))
    : (fileMap['full.txt'] || '');

  const chapterTexts = {};
  const summaryTexts = {};
  const feedbackTexts = {};
  const editTexts = {};
  if (meta && meta.chapters) {
    for (const ch of meta.chapters) {
      const isMulti = meta.strategy === 'multi-agent';
      const polishFile = isMulti ? (ch.finalFile || ch.humanizedFile) : ch.polishFile;
      if (polishFile) {
        const content = isLegacy
          ? (await readFileIfExists(path.join(workDir, polishFile)))
          : (fileMap[polishFile] || '');
        if (content) chapterTexts[ch.number] = content;
      }
      // 兼容旧版：没有独立章节文件时返回 full.txt
      if (!chapterTexts[ch.number] && isLegacy && fullText) {
        chapterTexts[ch.number] = fullText;
      }
      // 多版本读取（knowrite + 修复版本）
      const versionFiles = {
        raw: ch.rawFile,
        edited: ch.editedFile,
        humanized: ch.humanizedFile,
        final: ch.finalFile,
        repetitionRepaired: ch.repetitionRepairedFile,
        outlineCorrected: `chapter_${ch.number}_outline_corrected.txt`,
        styleCorrected: `chapter_${ch.number}_style_corrected.txt`,
      };
      for (const [vk, vf] of Object.entries(versionFiles)) {
        if (!vf) continue;
        const content = isLegacy
          ? (await readFileIfExists(path.join(workDir, vf)))
          : (fileMap[vf] || '');
        if (content) {
          if (!chapterTexts.versions) chapterTexts.versions = {};
          if (!chapterTexts.versions[ch.number]) chapterTexts.versions[ch.number] = {};
          chapterTexts.versions[ch.number][vk] = content;
        }
      }
      if (ch.editFile) {
        const content = isLegacy
          ? (await readFileIfExists(path.join(workDir, ch.editFile)))
          : (fileMap[ch.editFile] || '');
        if (content) editTexts[ch.number] = content;
      }
      if (ch.feedbackFile) {
        const content = isLegacy
          ? (await readFileIfExists(path.join(workDir, ch.feedbackFile)))
          : (fileMap[ch.feedbackFile] || '');
        if (content) {
          feedbackTexts[ch.number] = content;
          try {
            feedbackTexts[`${ch.number}_parsed`] = JSON.parse(content);
          } catch (err) { console.error("[novel] parse feedback error:", err.message); }
        }
      }
      if (ch.summaryFile) {
        const content = isLegacy
          ? (await readFileIfExists(path.join(workDir, ch.summaryFile)))
          : (fileMap[ch.summaryFile] || '');
        if (content) summaryTexts[ch.number] = content;
      }
    }
  }

  // 为多卷作品补充各卷纲章内容
  let volumesWithContent;
  if (meta.volumes) {
    volumesWithContent = [];
    for (const v of meta.volumes) {
      const fn = v.outlineFile || `volume_${v.number}_outline.txt`;
      const content = isLegacy
        ? (await readFileIfExists(path.join(workDir, fn)))
        : (fileMap[fn] || '');
      volumesWithContent.push({ ...v, outlineContent: content });
    }
  }

  // 读取 ReAct 评审记录（仍走本地目录，后续可迁移）
  const reviewRecords = {};
  if (!isLegacy) {
    try {
      await fs.promises.access(workDir);
      const reviewDirs = (await fs.promises.readdir(workDir)).filter(d => d.startsWith('review_'));
      for (const rd of reviewDirs) {
        const reviewType = rd.replace(/^review_/, '');
        const dirPath = path.join(workDir, rd);
        let stat;
        try {
          stat = await fs.promises.stat(dirPath);
        } catch { continue; }
        if (!stat.isDirectory()) continue;
        const files = (await fs.promises.readdir(dirPath))
          .filter(f => f.startsWith('round_') && f.endsWith('.json'))
          .sort();
        const rounds = [];
        for (const f of files) {
          try {
            const content = await fs.promises.readFile(path.join(dirPath, f), 'utf-8');
            rounds.push(JSON.parse(content));
          } catch (err) { console.error('[novel] parse review error:', err.message); }
        }
        if (rounds.length) reviewRecords[reviewType] = rounds;
      }
    } catch { /* workDir not accessible */ }
  }

  // 读取 Fitness 数据
  const fitnessRecords = {};
  if (!isLegacy && meta.chapters) {
    for (const ch of meta.chapters) {
      const f = await loadFitness(workId, ch.number);
      if (f) fitnessRecords[ch.number] = f;
    }
  }

  // 读取重复检查记录
  const repetitionRecords = {};
  if (!isLegacy && meta.chapters) {
    for (const ch of meta.chapters) {
      const content = fileMap[`chapter_${ch.number}_repetition.json`];
      if (content) {
        try {
          repetitionRecords[ch.number] = JSON.parse(content);
        } catch (err) { console.error("[novel] parse feedback error:", err.message); }
      }
    }
  }

  res.json({
    ...meta,
    ...(volumesWithContent ? { volumes: volumesWithContent } : {}),
    fullText,
    outlineTheme: isLegacy
      ? (await readFileIfExists(legacyTxtPath))
      : (fileMap['outline_theme.txt'] || ''),
    outlineDetailed: isLegacy
      ? (await readFileIfExists(legacyTxtPath))
      : (fileMap['outline_detailed.txt'] || ''),
    chapterTexts,
    summaryTexts,
    feedbackTexts,
    editTexts,
    reviewRecords,
    fitnessRecords,
    repetitionRecords,
  });
});

router.delete('/works/:workId', async (req, res) => {
  try {
    await deleteWork(req.params.workId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Import & Correction APIs
router.post('/import', validateBody(importSchema), async (req, res) => {
  const { title, content, style, platformStyle, authorStyle } = req.body || {};
  if (!title || !content) {
    return res.status(400).json({ error: '缺少 title 或 content' });
  }
  try {
    const result = await importNovel(title, content, { style, platformStyle, authorStyle });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/import-outline', validateBody(importOutlineSchema), async (req, res) => {
  const { title, outlineText, style, platformStyle, authorStyle, optimize } = req.body || {};
  if (!title || !outlineText) {
    return res.status(400).json({ error: '缺少 title 或 outlineText' });
  }
  try {
    const result = await importOutline(title, outlineText, { style, platformStyle, authorStyle, optimize });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/deviation-check', async (req, res) => {
  const { workId, chapterNumber, chapterText } = req.body || {};
  if (!workId || !chapterNumber) {
    return res.status(400).json({ error: '缺少 workId 或 chapterNumber' });
  }
  try {
    const text = chapterText || '';
    const roleCfg = await getRoleModelConfig('deviationCheck');
    const result = await detectOutlineDeviation(workId, parseInt(chapterNumber, 10), text, roleCfg.model);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/deviation-correct', async (req, res) => {
  const { workId, chapterNumber } = req.body || {};
  if (!workId || !chapterNumber) {
    return res.status(400).json({ error: '缺少 workId 或 chapterNumber' });
  }
  const stream = sse(res);
  try {
    const roleCfg = await getRoleModelConfig('deviationCheck');
    const result = await correctOutlineDeviation(workId, parseInt(chapterNumber, 10), roleCfg.model, {
      onStepStart(step) { stream.send({ type: 'stepStart', step: step.key, name: step.name, model: step.model }); },
      onChunk(stepKey, chunk) { stream.send({ type: 'chunk', step: stepKey, chunk }); },
      onStepEnd(stepKey, r) { stream.send({ type: 'stepEnd', step: stepKey, chars: r.chars, durationMs: r.durationMs }); },
    });
    stream.send({ type: 'done', result });
    stream.end();
  } catch (err) {
    sendError(stream, err, '/deviation-correct');
  }
});

router.post('/style-correct', async (req, res) => {
  const { workId, chapterNumber, newStyle } = req.body || {};
  if (!workId || !chapterNumber || !newStyle) {
    return res.status(400).json({ error: '缺少 workId、chapterNumber 或 newStyle' });
  }
  const stream = sse(res);
  try {
    const roleCfg = await getRoleModelConfig('styleCorrect');
    const result = await correctStyle(workId, parseInt(chapterNumber, 10), newStyle, roleCfg.model, {
      onStepStart(step) { stream.send({ type: 'stepStart', step: step.key, name: step.name, model: step.model }); },
      onChunk(stepKey, chunk) { stream.send({ type: 'chunk', step: stepKey, chunk }); },
      onStepEnd(stepKey, r) { stream.send({ type: 'stepEnd', step: stepKey, chars: r.chars, durationMs: r.durationMs }); },
    });
    stream.send({ type: 'done', result });
    stream.end();
  } catch (err) {
    sendError(stream, err, '/style-correct');
  }
});

// Evolution APIs
router.get('/prompts', async (req, res) => {
  try {
    const prompts = await listPrompts();
    res.json({ prompts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/evolve', async (req, res) => {
  const { templateName, workIds, model, variantCount, fitnessThreshold } = req.body || {};
  if (!templateName) {
    return res.status(400).json({ error: '缺少 templateName' });
  }
  try {
    let evolveModel = model;
    if (!evolveModel) {
      const roleCfg = await getRoleModelConfig('promptEvolve');
      evolveModel = roleCfg.model;
    }
    const result = await evolvePrompt(templateName, workIds || [], {
      model: evolveModel,
      variantCount: variantCount || 3,
      fitnessThreshold: fitnessThreshold || 0.6,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/evolve/apply', async (req, res) => {
  const { templateName, candidatePath } = req.body || {};
  if (!templateName || !candidatePath) {
    return res.status(400).json({ error: '缺少 templateName 或 candidatePath' });
  }
  try {
    const result = applyCandidate(templateName, candidatePath);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/repetition-check', async (req, res) => {
  const { workId, chapterNumber } = req.body || {};
  if (!workId || !chapterNumber) {
    return res.status(400).json({ error: '缺少 workId 或 chapterNumber' });
  }
  const meta = await loadMeta(workId);
  if (!meta) return res.status(404).json({ error: '作品不存在' });
  const ch = meta.chapters?.find(c => c.number === parseInt(chapterNumber, 10));
  if (!ch) return res.status(404).json({ error: '章节不存在' });
  const isMulti = meta.strategy === 'multi-agent';
  const file = isMulti ? (ch.finalFile || ch.humanizedFile) : ch.polishFile;
  const text = file ? await readFile(workId, file) : '';
  const expandedStyle = (await expandStyle(meta.platformStyle, meta.authorStyle)) || (await expandStyle(meta.style));
  try {
    const roleCfg = await getRoleModelConfig('repetitionRepair');
    const result = await checkContentRepetition(workId, parseInt(chapterNumber, 10), text, expandedStyle, roleCfg.model);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/repetition-repair', async (req, res) => {
  const { workId, chapterNumber } = req.body || {};
  if (!workId || !chapterNumber) {
    return res.status(400).json({ error: '缺少 workId 或 chapterNumber' });
  }
  const stream = sse(res);
  const meta = await loadMeta(workId);
  if (!meta) { stream.send({ type: 'error', message: '作品不存在' }); res.end(); return; }
  const ch = meta.chapters?.find(c => c.number === parseInt(chapterNumber, 10));
  if (!ch) { stream.send({ type: 'error', message: '章节不存在' }); res.end(); return; }
  const isMulti = meta.strategy === 'multi-agent';
  const file = isMulti ? (ch.finalFile || ch.humanizedFile) : ch.polishFile;
  const text = file ? await readFile(workId, file) : '';
  const expandedStyle = (await expandStyle(meta.platformStyle, meta.authorStyle)) || (await expandStyle(meta.style));
  try {
    const roleCfg = await getRoleModelConfig('repetitionRepair');
    const repResult = await checkContentRepetition(workId, parseInt(chapterNumber, 10), text, expandedStyle, roleCfg.model);
    if (!repResult.repetitive || repResult.severity === 'low') {
      stream.send({ type: 'done', result: { repaired: false, reason: '重复程度低，无需修复' } });
      res.end();
      return;
    }
    const result = await repairContentRepetition(workId, parseInt(chapterNumber, 10), text, repResult, expandedStyle, roleCfg.model, {
      onStepStart(step) { stream.send({ type: 'stepStart', step: step.key, name: step.name, model: step.model }); },
      onChunk(stepKey, chunk) { stream.send({ type: 'chunk', step: stepKey, chunk }); },
      onStepEnd(stepKey, r) { stream.send({ type: 'stepEnd', step: stepKey, chars: r.chars, durationMs: r.durationMs }); },
    });
    stream.send({ type: 'done', result: { repaired: true, filename: result.filename, chars: result.chars } });
    stream.end();
  } catch (err) {
    sendError(stream, err, '/repetition-repair');
  }
});

router.get('/settings', async (req, res) => {
  try {
    res.json(await getSettings());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/settings', async (req, res) => {
  try {
    await saveSettings(req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Agent 级模型配置 API
router.get('/settings/agent-models', async (req, res) => {
  try {
    const configs = await listAgentModelConfigs();
    res.json({ success: true, agentModels: configs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/settings/agent-models/:role', async (req, res) => {
  try {
    const config = await getAgentModelConfig(req.params.role);
    res.json({ success: true, config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/settings/agent-models/:role', async (req, res) => {
  try {
    const config = await setAgentModelConfig(req.params.role, req.body);
    res.json({ success: true, config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/settings/agent-models/:role', async (req, res) => {
  try {
    await setAgentModelConfig(req.params.role, null);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/settings/agent-models', async (req, res) => {
  try {
    const agentModels = await saveAgentModelConfigs(req.body);
    res.json({ success: true, agentModels });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Engine Pipeline 配置
router.get('/engine/pipeline', async (req, res) => {
  try {
    const engineCfg = await getConfig('engine');
    res.json({ success: true, pipeline: engineCfg.pipeline || {} });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/engine/pipeline', async (req, res) => {
  try {
    const engineCfg = await getConfig('engine');
    const pipeline = engineCfg.pipeline || {};
    const update = req.body || {};
    // 安全合并：只覆盖非空/已定义字段，避免空对象清空现有配置
    if (update.plan !== undefined) {
      pipeline.plan = { ...(pipeline.plan || {}), ...update.plan };
    }
    if (update.stages !== undefined) {
      pipeline.stages = { ...(pipeline.stages || {}), ...update.stages };
    }
    if (update.autoSkip !== undefined) {
      pipeline.autoSkip = { ...(pipeline.autoSkip || {}), ...update.autoSkip };
    }
    if (update.mode !== undefined) pipeline.mode = update.mode;
    engineCfg.pipeline = pipeline;
    await saveConfig('engine', engineCfg);
    res.json({ success: true, pipeline: engineCfg.pipeline });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 独立动态配置接口
router.get('/author-styles', async (req, res) => {
  try {
    res.json({ authorStyles: await getAuthorStyles() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/author-styles', async (req, res) => {
  try {
    await saveAuthorStyles(req.body || []);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/platform-styles', async (req, res) => {
  try {
    res.json({ platformStyles: await getPlatformStyles() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/platform-styles', async (req, res) => {
  try {
    await savePlatformStyles(req.body || []);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/review-dimensions', async (req, res) => {
  try {
    res.json({ reviewDimensions: await getReviewDimensions() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/review-dimensions', async (req, res) => {
  try {
    await saveReviewDimensions(req.body || []);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/review-preset', async (req, res) => {
  try {
    const preset = await getReviewPreset();
    res.json({ reviewPreset: preset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/review-preset', async (req, res) => {
  try {
    const { preset } = req.body || {};
    await setReviewPreset(preset);
    const settings = await getSettings();
    res.json({ success: true, reviewPreset: settings.reviewPreset, reviewDimensions: settings.reviewDimensions, skill: settings.skill });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/model-library', async (req, res) => {
  try {
    const list = await getModelLibrary();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/model-library', async (req, res) => {
  try {
    await saveModelLibrary(req.body || []);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/model-config', async (req, res) => {
  try {
    const cfg = await getModelConfig();
    res.json(cfg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/model-config', async (req, res) => {
  try {
    await saveModelConfig(req.body || {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/switch-provider', async (req, res) => {
  try {
    const { provider, roles, mode, uniformModel, customMap } = req.body || {};
    if (!provider) {
      return res.status(400).json({ error: '缺少 provider 参数' });
    }
    const options = {};
    if (Array.isArray(roles)) options.roles = roles;
    if (mode) options.mode = mode;
    if (uniformModel) options.uniformModel = uniformModel;
    if (customMap && typeof customMap === 'object') options.customMap = customMap;
    const result = await switchProvider(provider, options);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/test-provider', async (req, res) => {
  try {
    const { provider } = req.body || {};
    if (!provider) {
      return res.status(400).json({ error: '缺少 provider 参数' });
    }
    const cfg = await getModelConfig();
    const providerCfg = cfg.providers?.[provider];
    if (!providerCfg) {
      return res.status(400).json({ error: `未找到 Provider: ${provider}` });
    }
    const model = providerCfg.models?.[0];
    if (!model) {
      return res.status(400).json({ error: `Provider ${provider} 没有配置可用模型` });
    }

    const testMessages = [{ role: 'user', content: '你好，请只回复"成功"两个字。' }];
    const testPromise = runStreamChat(testMessages, { provider, model, temperature: 0.7 });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('测试请求超时（15秒）')), 15_000)
    );
    const result = await Promise.race([testPromise, timeoutPromise]);

    res.json({ valid: true, response: result.content?.substring(0, 200) || '' });
  } catch (err) {
    res.json({ valid: false, error: err.message });
  }
});

async function testModel(provider, model) {
  const testMessages = [{ role: 'user', content: '你好，请只回复"成功"两个字。' }];
  const start = Date.now();
  try {
    const testPromise = runStreamChat(testMessages, { provider, model, temperature: 0.7 });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('测试请求超时（15秒）')), 15_000)
    );
    const result = await Promise.race([testPromise, timeoutPromise]);
    return {
      model,
      valid: true,
      response: result.content?.substring(0, 200) || '',
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      model,
      valid: false,
      error: err.message,
      durationMs: Date.now() - start,
    };
  }
}

async function runWithConcurrency(tasks, concurrency = 3) {
  const results = [];
  const executing = [];
  for (const [index, task] of tasks.entries()) {
    const p = task().then((r) => { results[index] = r; return r; });
    results[index] = p; // placeholder
    executing.push(p);
    if (executing.length >= concurrency) {
      await Promise.race(executing);
      executing.splice(executing.findIndex((x) => x === p), 1);
    }
  }
  await Promise.all(executing);
  return results;
}

router.post('/test-models', async (req, res) => {
  try {
    const { provider } = req.body || {};
    if (!provider) {
      return res.status(400).json({ error: '缺少 provider 参数' });
    }
    const cfg = await getModelConfig();
    const providerCfg = cfg.providers?.[provider];
    if (!providerCfg) {
      return res.status(400).json({ error: `未找到 Provider: ${provider}` });
    }
    const models = providerCfg.models || [];
    if (models.length === 0) {
      return res.status(400).json({ error: `Provider ${provider} 没有配置可用模型` });
    }

    const tasks = models.map((model) => () => testModel(provider, model));
    const results = await runWithConcurrency(tasks, 3);
    res.json({ provider, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/chapter-config', async (req, res) => {
  try {
    const cfg = await getChapterConfig();
    res.json(cfg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/chapter-config', async (req, res) => {
  try {
    await saveChapterConfig(req.body || {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/writing-mode', async (req, res) => {
  try {
    const mode = await getWritingMode();
    res.json({ writingMode: mode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/writing-mode', async (req, res) => {
  try {
    const { mode } = req.body || {};
    await saveWritingMode(mode);
    res.json({ success: true, writingMode: mode === 'free' ? 'free' : 'industrial' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/chat', async (req, res) => {
  const { provider, model, temperature, promptTemplate, systemPrompt, messages = [] } = req.body || {};
  if (!provider || !model) {
    return res.status(400).json({ error: '缺少 provider 或 model' });
  }

  const stream = sse(res);
  let fullSystem = '';
  try {
    if (promptTemplate) {
      fullSystem = await loadPrompt(promptTemplate, req.body.promptVariables || {});
    } else if (systemPrompt) {
      fullSystem = systemPrompt;
    }
  } catch (e) {
    stream.send({ type: 'error', message: `加载 Prompt 模板失败: ${e.message}` });
    res.end();
    return;
  }

  const chatMessages = [];
  if (fullSystem) {
    chatMessages.push({ role: 'system', content: fullSystem });
  }
  chatMessages.push(...messages);

  try {
    const { runStreamChat } = require('../core/chat');
    stream.send({ type: 'stepStart', step: 'chat', name: 'Agent 对话', model });
    const result = await runStreamChat(chatMessages, { provider, model, temperature }, {
      onChunk: (chunk) => {
        stream.send({ type: 'chunk', step: 'chat', chunk });
      },
    });
    stream.send({ type: 'stepEnd', step: 'chat', chars: result.chars, durationMs: result.durationMs });
    stream.send({ type: 'done' });
    stream.end();
  } catch (err) {
    sendError(stream, err, '/chat');
  }
});

// 手动触发世界观数据提取
router.post('/works/:workId/extract-world', async (req, res) => {
  try {
    const { workId } = req.params;
    const meta = await loadMeta(workId);
    if (!meta) return res.status(404).json({ error: '作品不存在' });

    const result = await extractWorldFromOutlines(
      workId,
      meta.outlineTheme,
      meta.outlineDetailed,
      meta.outlineMultivolume,
      req.body?.model || null
    );
    res.json({ success: true, stats: result.stats });
  } catch (err) {
    console.error('[novel] extract-world error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Pause / Resume / Status
router.post('/pause', async (req, res) => {
  try {
    const { workId } = req.body || {};
    if (!workId) return res.status(400).json({ error: 'Missing workId' });
    await initDb();
    const work = await Work.findByPk(workId);
    if (!work) return res.status(404).json({ error: 'Work not found' });
    work.status = 'paused';
    await work.save();
    res.json({ success: true, status: 'paused' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/resume', async (req, res) => {
  try {
    const { workId } = req.body || {};
    if (!workId) return res.status(400).json({ error: 'Missing workId' });
    await initDb();
    const work = await Work.findByPk(workId);
    if (!work) return res.status(404).json({ error: 'Work not found' });
    work.status = 'running';
    await work.save();
    res.json({ success: true, status: 'running' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/status/:workId', async (req, res) => {
  try {
    const { workId } = req.params;
    await initDb();
    const work = await Work.findByPk(workId, { attributes: ['status', 'pausedAtStep'] });
    if (!work) return res.status(404).json({ error: 'Work not found' });
    res.json({ status: work.status, pausedAtStep: work.pausedAtStep });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
