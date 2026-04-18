const express = require('express');
const path = require('path');
const fs = require('fs');
const { startNovel, continueNovel, importNovel, importOutline, detectOutlineDeviation, correctOutlineDeviation, correctStyle, listWorks, getWorkDir, loadMeta } = require('../services/novel-engine');
const { expandStyle } = require('../services/novel/novel-utils');
const { loadPrompt } = require('../services/prompt-loader');
const { checkContentRepetition, repairContentRepetition } = require('../services/memory-index');
const { loadFitness } = require('../services/fitness-evaluator');
const { evolvePrompt, applyCandidate } = require('../services/prompt-evolver');
const { listPrompts } = require('../services/prompt-loader');
const { getSettings, saveSettings, getAuthorStyles, saveAuthorStyles, getPlatformStyles, savePlatformStyles, getReviewDimensions, saveReviewDimensions, getReviewPreset, setReviewPreset, getModelConfig, saveModelConfig, getChapterConfig, saveChapterConfig, getWritingMode, saveWritingMode } = require('../services/settings-store');
const fileStore = require('../services/file-store');
const { readFile } = fileStore;
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
  res.flushHeaders();
  return {
    send: (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    },
  };
}

router.post('/start', validateBody(startSchema), async (req, res) => {
  const { topic, style, platformStyle, authorStyle, strategy, customModels, writingMode } = req.body || {};
  if (!topic || (!style && (!platformStyle || !authorStyle))) {
    return res.status(400).json({ error: '缺少 topic 或风格信息' });
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
        res.end();
      },
    }, platformStyle, authorStyle, writingMode);
  } catch (err) {
    stream.send({ type: 'error', message: err.message });
    res.end();
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
        res.end();
      },
    }, { targetVolume });
  } catch (err) {
    stream.send({ type: 'error', message: err.message });
    res.end();
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
    const result = await detectOutlineDeviation(workId, parseInt(chapterNumber, 10), text, 'deepseek-r1');
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
    const result = await correctOutlineDeviation(workId, parseInt(chapterNumber, 10), 'deepseek-r1', {
      onStepStart(step) { stream.send({ type: 'stepStart', step: step.key, name: step.name, model: step.model }); },
      onChunk(stepKey, chunk) { stream.send({ type: 'chunk', step: stepKey, chunk }); },
      onStepEnd(stepKey, r) { stream.send({ type: 'stepEnd', step: stepKey, chars: r.chars, durationMs: r.durationMs }); },
    });
    stream.send({ type: 'done', result });
    res.end();
  } catch (err) {
    stream.send({ type: 'error', message: err.message });
    res.end();
  }
});

router.post('/style-correct', async (req, res) => {
  const { workId, chapterNumber, newStyle } = req.body || {};
  if (!workId || !chapterNumber || !newStyle) {
    return res.status(400).json({ error: '缺少 workId、chapterNumber 或 newStyle' });
  }
  const stream = sse(res);
  try {
    const result = await correctStyle(workId, parseInt(chapterNumber, 10), newStyle, 'deepseek-v3', {
      onStepStart(step) { stream.send({ type: 'stepStart', step: step.key, name: step.name, model: step.model }); },
      onChunk(stepKey, chunk) { stream.send({ type: 'chunk', step: stepKey, chunk }); },
      onStepEnd(stepKey, r) { stream.send({ type: 'stepEnd', step: stepKey, chars: r.chars, durationMs: r.durationMs }); },
    });
    stream.send({ type: 'done', result });
    res.end();
  } catch (err) {
    stream.send({ type: 'error', message: err.message });
    res.end();
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
    const result = await evolvePrompt(templateName, workIds || [], {
      model: model || 'deepseek-r1',
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
    const result = await checkContentRepetition(workId, parseInt(chapterNumber, 10), text, expandedStyle, 'deepseek-v3');
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
    const repResult = await checkContentRepetition(workId, parseInt(chapterNumber, 10), text, expandedStyle, 'deepseek-v3');
    if (!repResult.repetitive || repResult.severity === 'low') {
      stream.send({ type: 'done', result: { repaired: false, reason: '重复程度低，无需修复' } });
      res.end();
      return;
    }
    const result = await repairContentRepetition(workId, parseInt(chapterNumber, 10), text, repResult, expandedStyle, 'deepseek-v3', {
      onStepStart(step) { stream.send({ type: 'stepStart', step: step.key, name: step.name, model: step.model }); },
      onChunk(stepKey, chunk) { stream.send({ type: 'chunk', step: stepKey, chunk }); },
      onStepEnd(stepKey, r) { stream.send({ type: 'stepEnd', step: stepKey, chars: r.chars, durationMs: r.durationMs }); },
    });
    stream.send({ type: 'done', result: { repaired: true, filename: result.filename, chars: result.chars } });
    res.end();
  } catch (err) {
    stream.send({ type: 'error', message: err.message });
    res.end();
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
    res.end();
  } catch (err) {
    stream.send({ type: 'error', message: err.message });
    res.end();
  }
});

module.exports = router;
