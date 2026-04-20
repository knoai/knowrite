const path = require('path');
const fs = require('fs');
const { loadPrompt } = require('./prompt-loader');
const { WORKS_DIR, ensureDir, getWorkDir, sanitizeWorkId } = require('../core/paths');
const { runStreamChat } = require('../core/chat');
const { resolveRoleModelConfig, getWritingMode, getChapterConfig, getConfig } = require('./settings-store');
const { initDb, Work, Volume, Chapter, StoryTemplate, WorkTemplateLink, sequelize } = require('../models');
const fileStore = require('./file-store');
const truthManager = require('./truth-manager');
const outputGovernance = require('./output-governance');
const inputGovernance = require('./input-governance');
const editReviewer = require('./novel/edit-reviewer');
const outlineGenerator = require('./novel/outline-generator');
const contextBuilder = require('./novel/context-builder');
const novelUtils = require('./novel/novel-utils');
const chapterWriter = require('./novel/chapter-writer');
const chapterProcessor = require('./novel/chapter-processor');
const { extractWorldFromOutlines } = require('./world-extractor');
const { detectOutlineDeviation } = require('./outline-deviation');

async function generateWorkId(topic, strategy) {
  const engineCfg = await getConfig('engine');
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
  const engineCfg = await getConfig('engine');
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

async function deleteWork(workId) {
  await initDb();
  const meta = await loadMeta(workId);
  if (!meta) {
    // 如果 DB 中没有，尝试只清理本地目录
    const workDir = getWorkDir(workId);
    try {
      await fs.promises.rm(workDir, { recursive: true, force: true });
    } catch (err) {
      console.error(`[novel-engine] 删除作品目录失败: ${workId}`, err.message);
    }
    return { success: true };
  }

  const transaction = await sequelize.transaction();
  try {
    // 按外键依赖顺序删除子表（先叶子节点，后父节点）
    const deleteOrder = [
      'plot_nodes',          // 依赖 plot_lines
      'plot_lines',
      'character_relations', // 依赖 characters
      'character_memories',  // 有 ON DELETE CASCADE，但显式删除更安全
      'map_connections',     // 依赖 map_regions
      'work_template_links', // 依赖 story_templates
      'work_style_links',    // 有 ON DELETE CASCADE
      'truth_events',        // 有 ON DELETE CASCADE
      'truth_states',        // 有 ON DELETE CASCADE
      'truth_hooks',         // 有 ON DELETE CASCADE
      'truth_resources',     // 有 ON DELETE CASCADE
      'embeddings',          // 有 ON DELETE CASCADE
      'world_lore',
      'characters',
      'map_regions',
      'author_intents',
      'current_focuses',
      'chapter_intents',
      'output_queue',
      'work_files',
      'chapters',
      'volumes',
    ];

    for (const table of deleteOrder) {
      try {
        await sequelize.query(
          `DELETE FROM ${table} WHERE workId = ?`,
          { replacements: [workId], transaction }
        );
      } catch (err) {
        // 表不存在或没有 workId 列时跳过
        console.warn(`[novel-engine] 删除 ${table} 时跳过: ${err.message}`);
      }
    }

    // 删除主表记录
    await Work.destroy({ where: { workId }, transaction });

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  // 删除 fileStore 中的所有作品文件
  try {
    await fileStore.deleteAllWorkFiles(workId);
  } catch (err) {
    console.error(`[novel-engine] 删除作品文件存储失败: ${workId}`, err.message);
  }

  // 删除本地作品目录
  const workDir = getWorkDir(workId);
  try {
    await fs.promises.rm(workDir, { recursive: true, force: true });
  } catch (err) {
    console.error(`[novel-engine] 删除作品目录失败: ${workId}`, err.message);
  }

  console.log(`[novel-engine] 作品已删除: ${workId}`);
  return { success: true };
}

// ============ 上下文构建 ============


// ============ Pipeline 单章流程（兼容旧版） ============

async function startNovel(topic, style, strategy, customModels, callbacks, platformStyle, authorStyle, writingMode, storyTemplate) {
  const engineCfg = await getConfig('engine');
  const workId = await generateWorkId(topic, strategy);
  ensureDir(getWorkDir(workId));

  const outlineModel = customModels.outline;
  const isMV = outlineGenerator.isMultivolumeStrategy(strategy);

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
  try {
    await saveMeta(workId, meta);
  } catch (saveErr) {
    console.error(`[novel-engine] saveMeta 失败: workId=${workId} error=${saveErr.message}`);
    throw new Error(`创建作品元数据失败: ${saveErr.message}`);
  }

  // 关联套路模版
  if (storyTemplate) {
    try {
      await initDb();
      const template = await StoryTemplate.findByPk(parseInt(storyTemplate, 10));
      if (template) {
        await WorkTemplateLink.findOrCreate({
          where: { workId, templateId: template.id },
          defaults: { workId, templateId: template.id },
        });
        console.log(`[novel-engine] 作品 ${workId} 关联套路: ${template.name}`);
      }
    } catch (err) {
      console.error('[novel-engine] 关联套路失败:', err.message);
    }
  }

  // 1. 生成主题大纲
  if (callbacks.onStepStart) callbacks.onStepStart({ key: 'outline_theme', name: '生成主题大纲', model: outlineModel });
  const outlineThemeResult = await outlineGenerator.generateOutline(topic, style, outlineModel, {
    onChunk: (chunk) => { if (callbacks.onChunk) callbacks.onChunk('outline_theme', chunk); }
  }, workId);
  await writeFile(workId, 'outline_theme.txt', outlineThemeResult.content);
  if (callbacks.onStepEnd) callbacks.onStepEnd('outline_theme', outlineThemeResult);

  // 2. 生成详细纲章
  if (callbacks.onStepStart) callbacks.onStepStart({ key: 'outline_detailed', name: '生成详细纲章', model: outlineModel });
  const outlineDetailedResult = await outlineGenerator.generateDetailedOutline(topic, style, outlineThemeResult.content, outlineModel, {
    onChunk: (chunk) => { if (callbacks.onChunk) callbacks.onChunk('outline_detailed', chunk); }
  }, workId);
  await writeFile(workId, 'outline_detailed.txt', outlineDetailedResult.content);
  if (callbacks.onStepEnd) callbacks.onStepEnd('outline_detailed', outlineDetailedResult);

  let outlineMultivolume = '';
  let volumes = [];

  // 3. 多卷大纲
  if (isMV) {
    if (callbacks.onStepStart) callbacks.onStepStart({ key: 'outline_multivolume', name: '生成多卷大纲', model: outlineModel });
    const mvResult = await outlineGenerator.generateMultivolumeOutline(topic, style, outlineDetailedResult.content, 3, outlineModel, {
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
      const volResult = await outlineGenerator.generateVolumeOutline(topic, style, outlineMultivolume, v, outlineModel, {
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

  // 5. 自动提取世界观数据
  try {
    await extractWorldFromOutlines(
      workId,
      meta.outlineTheme,
      meta.outlineDetailed,
      meta.outlineMultivolume,
      outlineModel,
      callbacks
    );
  } catch (err) {
    console.error(`[novel-engine] 世界观提取失败: ${err.message}`);
    // 提取失败不应阻塞主流程
  }

  // 6. 写第一章
  const chapterResult = strategy === 'knowrite'
    ? await chapterWriter.writeChapterMultiAgent(workId, meta, 1, {
        writer: customModels.writer,
        editor: customModels.editor,
        humanizer: customModels.humanizer,
        proofreader: customModels.proofreader,
        reader: customModels.reader,
        summarizer: customModels.summarizer,
      }, callbacks)
    : await chapterWriter.writeChapterPipeline(workId, meta, 1, {
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

// ============ 尝试创作（渐进式流程）============

async function tryCreateOutline(topic, style, strategy, customModels, callbacks, platformStyle, authorStyle, writingMode, storyTemplate) {
  const workId = await generateWorkId(topic, strategy);
  ensureDir(getWorkDir(workId));

  const outlineModel = customModels.outline;
  console.log(`[novel-engine] tryCreateOutline 开始: workId=${workId} topic=${topic.substring(0, 30)}... outlineModel=${outlineModel || '(默认角色配置)'}`);

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

  // 关联套路模版
  if (storyTemplate) {
    try {
      await initDb();
      const template = await StoryTemplate.findByPk(parseInt(storyTemplate, 10));
      if (template) {
        await WorkTemplateLink.findOrCreate({
          where: { workId, templateId: template.id },
          defaults: { workId, templateId: template.id },
        });
        console.log(`[novel-engine] 作品 ${workId} 关联套路: ${template.name}`);
      }
    } catch (err) {
      console.error('[novel-engine] 关联套路失败:', err.message);
    }
  }

  try {
    if (callbacks?.onStepStart) callbacks.onStepStart({ key: 'outline_theme', name: '生成主题大纲', model: outlineModel });
    const outlineThemeResult = await outlineGenerator.generateOutline(topic, style, outlineModel, {
      onChunk: (chunk) => { if (callbacks?.onChunk) callbacks.onChunk('outline_theme', chunk); }
    }, workId);
    await writeFile(workId, 'outline_theme.txt', outlineThemeResult.content);
    if (callbacks?.onStepEnd) callbacks.onStepEnd('outline_theme', outlineThemeResult);

    meta.outlineTheme = outlineThemeResult.content;
    meta.updatedAt = new Date().toISOString();
    await saveMeta(workId, meta);

    console.log(`[novel-engine] tryCreateOutline 完成: workId=${workId} chars=${outlineThemeResult.chars}`);
    if (callbacks?.onDone) callbacks.onDone(meta);
    return { workId, meta, outlineTheme: outlineThemeResult.content };
  } catch (err) {
    const step = err?.step || 'outline_theme';
    console.error(`[novel-engine] tryCreateOutline 失败: workId=${workId} step=${step} error=${err.message}`);
    throw new Error(`生成主题大纲失败: ${err.message}`);
  }
}

async function tryCreateDetailedOutline(workId, customModels, callbacks) {
  const meta = await loadMeta(workId);
  if (!meta) throw new Error('作品不存在');

  const outlineModel = customModels.outline;
  const { topic, style, outlineTheme } = meta;

  if (callbacks?.onStepStart) callbacks.onStepStart({ key: 'outline_detailed', name: '生成详细纲章', model: outlineModel });
  const outlineDetailedResult = await outlineGenerator.generateDetailedOutline(topic, style, outlineTheme, outlineModel, {
    onChunk: (chunk) => { if (callbacks?.onChunk) callbacks.onChunk('outline_detailed', chunk); }
  }, workId);
  await writeFile(workId, 'outline_detailed.txt', outlineDetailedResult.content);
  if (callbacks?.onStepEnd) callbacks.onStepEnd('outline_detailed', outlineDetailedResult);

  meta.outlineDetailed = outlineDetailedResult.content;
  meta.updatedAt = new Date().toISOString();
  await saveMeta(workId, meta);

  // 自动提取世界观数据
  try {
    await extractWorldFromOutlines(
      workId,
      meta.outlineTheme,
      meta.outlineDetailed,
      meta.outlineMultivolume,
      outlineModel,
      callbacks
    );
  } catch (err) {
    console.error(`[novel-engine] 世界观提取失败: ${err.message}`);
  }

  if (callbacks?.onDone) callbacks.onDone(meta);
  return { workId, meta, outlineDetailed: outlineDetailedResult.content };
}

async function tryCreateChapters(workId, customModels, callbacks, count = 3) {
  const meta = await loadMeta(workId);
  if (!meta) throw new Error('作品不存在');

  const strategy = meta.strategy;
  const isKnowrite = strategy === 'knowrite';

  for (let i = 0; i < count; i++) {
    const nextNumber = (meta.chapters?.length || 0) + 1;
    const chapterResult = isKnowrite
      ? await chapterWriter.writeChapterMultiAgent(workId, meta, nextNumber, {
          writer: customModels.writer,
          editor: customModels.editor,
          humanizer: customModels.humanizer,
          proofreader: customModels.proofreader,
          reader: customModels.reader,
          summarizer: customModels.summarizer,
        }, callbacks)
      : await chapterWriter.writeChapterPipeline(workId, meta, nextNumber, {
          writer: customModels.writer || customModels.chapter,
          polish: customModels.polish,
          reader: customModels.reader,
          summarizer: customModels.summarizer,
        }, callbacks);

    meta.chapters.push({ number: nextNumber, ...chapterResult });
    meta.updatedAt = new Date().toISOString();
    await saveMeta(workId, meta);
  }

  if (callbacks?.onDone) callbacks.onDone(meta);
  return { workId, meta };
}

async function tryContinue(workId, customModels, callbacks) {
  return continueNovel(workId, customModels, callbacks);
}

async function continueNovel(workId, customModels, callbacks, options = {}) {
  const meta = await loadMeta(workId);
  if (!meta) throw new Error('作品不存在');

  const nextNumber = (meta.chapters?.length || 0) + 1;
  const strategy = meta.strategy;

  // 多卷切换
  if (options.targetVolume && outlineGenerator.isMultivolumeStrategy(strategy)) {
    meta.currentVolume = options.targetVolume;
  }

  const chapterResult = strategy === 'knowrite'
    ? await chapterWriter.writeChapterMultiAgent(workId, meta, nextNumber, {
        writer: customModels.writer || meta.chapters?.[0]?.models?.writer,
        editor: customModels.editor || meta.chapters?.[0]?.models?.editor,
        humanizer: customModels.humanizer || meta.chapters?.[0]?.models?.humanizer,
        proofreader: customModels.proofreader || meta.chapters?.[0]?.models?.proofreader,
        reader: customModels.reader || meta.chapters?.[0]?.models?.reader,
        summarizer: customModels.summarizer || meta.chapters?.[0]?.models?.summarizer,
      }, callbacks)
    : await chapterWriter.writeChapterPipeline(workId, meta, nextNumber, {
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
  const engineCfg = await getConfig('engine');
  const workId = await generateWorkId(title, 'import');
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
  const workId = await generateWorkId(title, 'outline');
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
    const result = await outlineGenerator.generateDetailedOutline(title, style || '', outlineText, undefined, {});
    outlineDetailed = result.content;
  }
  await writeFile(workId, 'outline_detailed.txt', outlineDetailed);

  meta.outlineDetailed = outlineDetailed;
  meta.updatedAt = new Date().toISOString();
  await saveMeta(workId, meta);
  return { workId, meta };
}

async function correctOutlineDeviation(workId, chapterNumber, model, callbacks) {
  const meta = await loadMeta(workId);
  if (!meta) throw new Error('作品不存在');
  const ch = meta.chapters.find(c => c.number === chapterNumber);
  if (!ch) throw new Error('章节不存在');
  const isMulti = meta.strategy === 'knowrite';
  const file = isMulti ? (ch.finalFile || ch.humanizedFile) : ch.polishFile;
  const text = file ? await readFile(workId, file) : '';
  const outline = await outlineGenerator.getCurrentVolumeOutline(workId, meta);

  if (callbacks?.onStepStart) callbacks.onStepStart({ key: `correct_${chapterNumber}`, name: `纲章矫正`, model });
  const prompt = `你是一位职业作家。以下第${chapterNumber}章偏离了当前大纲，请对其进行矫正重写，使其严格贴合大纲走向，同时保持情节连贯和原有风格。\n\n大纲：\n${outline}\n\n当前章节：\n${text}\n\n请直接输出矫正后的完整章节。`;
  const result = await runStreamChat([{ role: 'user', content: prompt }], await resolveRoleModelConfig('deviationCheck', model), {
    onChunk: (chunk) => { if (callbacks?.onChunk) callbacks.onChunk(`correct_${chapterNumber}`, chunk); }
  }, { workId, agentType: 'deviationCheck', promptTemplate: 'outline-correct.md' });
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
  }, { workId, agentType: 'styleCorrect', promptTemplate: 'style-correct.md' });
  if (callbacks?.onStepEnd) callbacks.onStepEnd(`style_correct_${chapterNumber}`, result);

  const correctedFile = `chapter_${chapterNumber}_style_corrected.txt`;
  await writeFile(workId, correctedFile, result.content);
  return { filename: correctedFile, chars: result.chars };
}

module.exports = {
  generateWorkId,
  loadMeta,
  saveMeta,
  writeFile,
  readFile,
  appendToFullTxt,
  listWorks,
  deleteWork,
  startNovel,
  continueNovel,
  tryCreateOutline,
  tryCreateDetailedOutline,
  tryCreateChapters,
  tryContinue,
  importNovel,
  importOutline,
  detectOutlineDeviation,
  correctOutlineDeviation,
  correctStyle,
  getWorkDir,
};
