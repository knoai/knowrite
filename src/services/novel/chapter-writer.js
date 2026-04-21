/**
 * Chapter Writer — 7-Agent / Pipeline 写作管道
 *
 * 从 novel-engine.js 提取，负责：
 * - writeChapterMultiAgent: 7-Agent 完整流程（作者→编辑→改稿→去AI化→校编→读者→摘要）
 * - writeChapterPipeline: 轻量级单模型流程（正文→润色→读者→摘要）
 */

const path = require('path');
const fs = require('fs');
const fileStore = require('../file-store');
const { getWorkDir } = require('../../core/paths');
const { runStreamChat } = require('../../core/chat');
const { loadPrompt } = require('../prompt-loader');
const { getWorldContextForPrompt } = require('../world-context');
const {
  buildReviewDimensionsText,
  resolveRoleModelConfig,
  getWritingMode,
  resolveWriterModel,
  getConfig,
} = require('../settings-store');
const editReviewer = require('./edit-reviewer');
const outlineGenerator = require('./outline-generator');
const contextBuilder = require('./context-builder');
const inputGovernance = require('../input-governance');
const truthManager = require('../truth-manager');
const outputGovernance = require('../output-governance');
const { appendChapterToIndex } = require('../memory-index');
const { indexChapterSummary } = require('../rag-retriever');
const voiceFingerprint = require('../voice-fingerprint');
const characterMemory = require('../character-memory');
const skillExtractor = require('../skill-extractor');
const { expandStyle, getChapterWordVariables, resolvePromptName } = require('./novel-utils');
const {
  generateChapterSummary,
  generateReaderFeedback,
  runFitnessEvaluation,
  extractTruthDeltaFromSummary,
} = require('./chapter-processor');
const { planChapterBeats } = require('./chapter-planner');
const { loadRecentFitness } = require('../fitness-evaluator');



// ============ 内部工具 ============

async function writeFile(workId, filename, content) {
  return fileStore.writeFile(workId, filename, content);
}

async function readFile(workId, filename) {
  return fileStore.readFile(workId, filename);
}

async function appendToFullTxt(workId, sectionTitle, content) {
  const header = sectionTitle ? `\n\n========== ${sectionTitle} ==========\n\n` : '\n';
  await fileStore.appendToFile(workId, 'full.txt', header + content);
  const fullPath = path.join(getWorkDir(workId), 'full.txt');
  try {
    await fs.promises.appendFile(fullPath, header + content, 'utf-8');
  } catch (err) {
    console.error('[chapter-writer] appendToFullTxt 写入本地文件失败:', err.message);
  }
}

// ============ AutoSkip 逻辑 ============

async function shouldAutoSkip(workId, stageKey, autoSkip, isFreeMode) {
  if (!autoSkip || !autoSkip[stageKey]) return false;
  const rule = autoSkip[stageKey];

  // 自由风自动跳过
  if (rule.ifFreeMode && isFreeMode) {
    console.log(`[pipeline] 第${stageKey}阶段 自动跳过（自由风模式）`);
    return true;
  }

  // Fitness 历史自动跳过
  if (rule.ifLastFitness) {
    const match = rule.ifLastFitness.match(/^([<>]=?)\s*([\d.]+)$/);
    if (match) {
      const op = match[1];
      const threshold = parseFloat(match[2]);
      const recent = await loadRecentFitness(workId, rule.consecutive || 1);
      if (recent.length >= (rule.consecutive || 1)) {
        const allMatch = recent.every((f) => {
          const score = f.score ?? f.fitnessScore ?? 0;
          if (op === '>') return score > threshold;
          if (op === '>=') return score >= threshold;
          if (op === '<') return score < threshold;
          if (op === '<=') return score <= threshold;
          return false;
        });
        if (allMatch) {
          console.log(`[pipeline] 第${stageKey}阶段 自动跳过（最近${recent.length}章 Fitness ${rule.ifLastFitness}）`);
          return true;
        }
      }
    }
  }

  return false;
}

// ============ 7-Agent 多智能体流程 ============

async function writeChapterMultiAgent(workId, meta, nextNumber, models, callbacks) {
  const engineCfg = await getConfig('engine');
  const pipelineCfg = engineCfg.pipeline || {};
  const stages = pipelineCfg.stages || {};
  const style =
    (await expandStyle(meta.platformStyle, meta.authorStyle)) || (await expandStyle(meta.style));
  const topic = meta.topic;
  const isMV = outlineGenerator.isMultivolumeStrategy(meta.strategy);
  const outlineDetailed = outlineGenerator.getCurrentVolumeOutline(workId, meta);
  const { fullContext: previousContext } = await contextBuilder.buildSmartContext(
    workId,
    meta,
    nextNumber,
    models,
    {
      onChunk: (chunk) => {
        if (callbacks.onChunk) callbacks.onChunk(`context_${nextNumber}`, chunk);
      },
    }
  );
  const worldContext = await getWorldContextForPrompt(workId, nextNumber);
  const isFreeMode = (await getWritingMode(workId)) === 'free';
  const MAX_EDIT_ROUNDS = isFreeMode
    ? (stages.editor?.maxRounds ?? engineCfg.editing.maxEditRoundsFree)
    : (stages.editor?.maxRounds ?? engineCfg.editing.maxEditRounds);

  // ===== Plan 模式：章节节拍规划 =====
  let chapterPlan = null;
  if (pipelineCfg.plan?.enabled) {
    try {
      chapterPlan = await planChapterBeats(workId, meta, nextNumber, models, callbacks);
      if (chapterPlan) {
        console.log(`[chapter-writer] 第${nextNumber}章 节拍规划完成，beats=${chapterPlan.beats?.length || 0}`);
      }
    } catch (err) {
      console.error(`[chapter-writer] 第${nextNumber}章 节拍规划失败（继续写作）:`, err.message);
    }
  }

  // ===== 输入治理：plan + compose =====
  let governanceVars = null;
  if (engineCfg.inputGovernance?.enabled) {
    try {
      if (engineCfg.inputGovernance?.planBeforeWrite) {
        await inputGovernance.planChapter(workId, nextNumber);
        console.log(`[input-gov] 第${nextNumber}章 plan 完成`);
      }
      if (engineCfg.inputGovernance?.composeContext) {
        await inputGovernance.composeChapter(workId, nextNumber);
        console.log(`[input-gov] 第${nextNumber}章 compose 完成`);
      }
      governanceVars = await inputGovernance.getGovernanceVariables(workId, nextNumber);
    } catch (err) {
      console.error(`[input-gov] 第${nextNumber}章 输入治理失败（继续写作）:`, err.message);
    }
  }

  // 1. 作者：初稿
  if (callbacks.onStepStart)
    callbacks.onStepStart({
      key: `raw_${nextNumber}`,
      name: `第${nextNumber}章 作者初稿`,
      model: models.writer,
    });
  const wordVars = await getChapterWordVariables();
  let writerPrompt = await loadPrompt(await resolvePromptName('writer', workId), {
    style,
    topic,
    outlineTheme: meta.outlineTheme,
    outlineDetailed,
    previousContext,
    nextNumber,
    ...wordVars,
  }, meta.language || 'zh');
  if (worldContext) writerPrompt += '\n\n【世界观上下文】\n' + worldContext;

  // Skill 注入：自动匹配历史高分 Skill
  try {
    const skillInjection = await skillExtractor.buildSkillInjection(workId);
    if (skillInjection) {
      writerPrompt += '\n\n========== 创作技能注入 ==========\n' + skillInjection + '\n========== 创作技能注入结束 ==========';
    }
  } catch (err) {
    console.error('[chapter-writer] Skill 注入失败:', err.message);
  }

  // 输入治理：注入治理变量到 Writer prompt
  if (governanceVars && governanceVars.governanceEnabled) {
    const govLines = [];
    if (governanceVars.authorLongTermVision)
      govLines.push(`【长期愿景】${governanceVars.authorLongTermVision}`);
    if (governanceVars.focusText)
      govLines.push(
        `【当前焦点】${governanceVars.focusText}（目标${governanceVars.targetChapters}章内完成）`
      );
    if (governanceVars.chapterMustKeep)
      govLines.push(`【本章必须保留】${governanceVars.chapterMustKeep}`);
    if (governanceVars.chapterMustAvoid)
      govLines.push(`【本章必须避免】${governanceVars.chapterMustAvoid}`);
    if (governanceVars.ruleStackText) govLines.push(`【规则栈】\n${governanceVars.ruleStackText}`);
    if (govLines.length) {
      writerPrompt +=
        '\n\n========== 输入治理指令 ==========\n' +
        govLines.join('\n\n') +
        '\n========== 输入治理指令结束 ==========';
    }
  }

  // Plan 模式：注入节拍规划到 Writer prompt
  if (chapterPlan && chapterPlan.beats && chapterPlan.beats.length > 0) {
    const beatsText = chapterPlan.beats.map((b, i) =>
      `${i + 1}. [${b.type}] ${b.description}（约${b.estimatedWords || '?'}字）`
    ).join('\n');
    writerPrompt +=
      '\n\n========== 本章节拍规划 ==========\n' +
      `整体基调：${chapterPlan.overallTone || '未指定'}\n\n` +
      `叙事节拍：\n${beatsText}\n` +
      (chapterPlan.riskFlags?.length ? `\n风险提示：${chapterPlan.riskFlags.join('、')}\n` : '') +
      '========== 本章节拍规划结束 ==========';
  }

  console.log(`[prompt-trace] Writer 最终提交：model=${models.writer}, prompt长度=${writerPrompt.length}`);
  const rawResult = await runStreamChat(
    [{ role: 'user', content: writerPrompt }],
    await resolveWriterModel(nextNumber, models.writer),
    {
      onChunk: (chunk) => {
        if (callbacks.onChunk) callbacks.onChunk(`raw_${nextNumber}`, chunk);
      },
    },
    { workId, agentType: 'writer', promptTemplate: 'writer.md' }
  );
  await writeFile(workId, `chapter_${nextNumber}_raw.txt`, rawResult.content);
  if (callbacks.onStepEnd) callbacks.onStepEnd(`raw_${nextNumber}`, rawResult);

  // 2. 编辑-作者改循环，直到编辑通过或达到最大轮次
  if (stages.editor?.enabled === false) {
    console.log(`[pipeline] 第${nextNumber}章 Editor 已禁用，跳过审阅`);
    await writeFile(workId, `chapter_${nextNumber}_edit.txt`, rawResult.content);
  } else {
  let currentDraft = rawResult.content;
  let lastEditResult = null;
  let lastEditedResult = null;
  let passedRound = 0;
  const prevFinal =
    nextNumber > 1 ? await readFile(workId, `chapter_${nextNumber - 1}_final.txt`) : '';

  for (let round = 1; round <= MAX_EDIT_ROUNDS; round++) {
    // 如果有上一轮的 edit.txt / edited.txt，先归档为 v{round-1}
    if (round > 1) {
      const prevEditContent = await readFile(workId, `chapter_${nextNumber}_edit.txt`);
      if (prevEditContent) {
        await writeFile(workId, `chapter_${nextNumber}_edit_v${round - 1}.txt`, prevEditContent);
        const prevEditPath = path.join(getWorkDir(workId), `chapter_${nextNumber}_edit.txt`);
        try {
          await fs.promises.access(prevEditPath);
          await fs.promises.rename(
            prevEditPath,
            path.join(getWorkDir(workId), `chapter_${nextNumber}_edit_v${round - 1}.txt`)
          );
        } catch {
          // 本地文件不存在，忽略
        }
      }
      const prevEditedContent = await readFile(workId, `chapter_${nextNumber}_edited.txt`);
      if (prevEditedContent) {
        await writeFile(
          workId,
          `chapter_${nextNumber}_edited_v${round - 1}.txt`,
          prevEditedContent
        );
        const prevEditedPath = path.join(getWorkDir(workId), `chapter_${nextNumber}_edited.txt`);
        try {
          await fs.promises.access(prevEditedPath);
          await fs.promises.rename(
            prevEditedPath,
            path.join(getWorkDir(workId), `chapter_${nextNumber}_edited_v${round - 1}.txt`)
          );
        } catch {
          // 本地文件不存在，忽略
        }
      }
    }

    // 编辑审阅
    const editKey = `edit_${nextNumber}${round > 1 ? '_r' + round : ''}`;
    const editName = `第${nextNumber}章 编辑审阅${round > 1 ? ' (第' + round + '轮)' : ''}`;
    if (callbacks.onStepStart)
      callbacks.onStepStart({ key: editKey, name: editName, model: models.editor });
    const editHistory = await editReviewer.buildEditHistory(workId, nextNumber, round);
    let reviewDims = await buildReviewDimensionsText(style);
    // 输入治理约束：追加 mustKeep / mustAvoid 为强制审查维度
    if (governanceVars) {
      const govConstraints = [];
      if (governanceVars.chapterMustKeep) govConstraints.push(`必须保留：${governanceVars.chapterMustKeep}`);
      if (governanceVars.chapterMustAvoid) govConstraints.push(`必须避免：${governanceVars.chapterMustAvoid}`);
      if (governanceVars.authorLongTermVision) govConstraints.push(`长期愿景对齐：${governanceVars.authorLongTermVision}`);
      if (governanceVars.focusText) govConstraints.push(`当前焦点对齐：${governanceVars.focusText}`);
      if (govConstraints.length) {
        reviewDims += '\n\n【输入治理强制审查】\n请额外检查以下作者意图约束是否被满足（不满足则整章不通过）：\n' +
          govConstraints.map((c, i) => `${i + 1}. ${c}`).join('\n') +
          '\n判定格式同上：[是/否] 判定理由';
      }
    }
    let editorPrompt = await loadPrompt(await resolvePromptName('editor', workId), {
      style,
      nextNumber,
      reviewDimensions: reviewDims,
      prevFinal: prevFinal
        ? '\n上一章内容（供参考连贯性）：\n' +
          prevFinal.substring(0, engineCfg.truncation.previousChapterReference) +
          '\n'
        : '',
      roundLabel: round === 1 ? '初稿' : '第' + (round - 1) + '轮修改稿',
      currentDraft: editReviewer.buildEditorDraftPreview(
        currentDraft,
        engineCfg.truncation.editDraftPreview,
        engineCfg.truncation.editDraftHeadRatio || 0.5
      ),
      editHistory,
    }, meta.language || 'zh');
    if (worldContext) editorPrompt += '\n\n【世界观上下文】\n' + worldContext;
    const editResult = await runStreamChat(
      [{ role: 'user', content: editorPrompt }],
      await resolveRoleModelConfig('editor', models.editor),
      {
        onChunk: (chunk) => {
          if (callbacks.onChunk) callbacks.onChunk(editKey, chunk);
        },
      },
      { workId, agentType: 'editor', promptTemplate: 'editor.md' }
    );
    lastEditResult = editResult;
    await writeFile(workId, `chapter_${nextNumber}_edit.txt`, editResult.content);
    if (callbacks.onStepEnd) callbacks.onStepEnd(editKey, editResult);

    // 双重判定：关键词 + 维度通过率
    const verdict = await editReviewer.parseEditorVerdict(editResult.content);
    const isPass =
      (verdict.hasPassKeyword && verdict.passRate >= 0.8) ||
      (!verdict.hasFailKeyword && verdict.passRate >= 0.8 && verdict.total > 0);
    console.log(
      `[editor] 第${nextNumber}章 第${round}轮评审结果: 关键词通过=${verdict.hasPassKeyword}, 通过率=${(verdict.passRate * 100).toFixed(1)}%, 判定=${isPass ? '通过' : '不通过'}`
    );

    if (isPass) {
      passedRound = round;
      if (round === 1) {
        // 第一轮直接通过，edited = raw
        lastEditedResult = {
          content: currentDraft,
          chars: currentDraft.length,
          chunks: 0,
          durationMs: 0,
        };
        await writeFile(workId, `chapter_${nextNumber}_edited.txt`, currentDraft);
      }
      break;
    }

    // 未通过，且还有修改机会
    if (round < MAX_EDIT_ROUNDS) {
      const editedKey = `edited_${nextNumber}_r${round}`;
      const editedName = `第${nextNumber}章 作者改稿 (第${round}轮)`;
      if (callbacks.onStepStart)
        callbacks.onStepStart({ key: editedKey, name: editedName, model: models.writer });
      const revisePrompt = await loadPrompt('revise', {
        style,
        currentDraft,
        editContent: editResult.content,
        round,
      }, meta.language || 'zh');
      const editedResult = await runStreamChat(
        [{ role: 'user', content: revisePrompt }],
        await resolveWriterModel(nextNumber, models.writer),
        {
          onChunk: (chunk) => {
            if (callbacks.onChunk) callbacks.onChunk(editedKey, chunk);
          },
        },
        { workId, agentType: 'revise', promptTemplate: 'revise.md' }
      );
      lastEditedResult = editedResult;
      currentDraft = editedResult.content;
      await writeFile(workId, `chapter_${nextNumber}_edited.txt`, editedResult.content);
      if (callbacks.onStepEnd) callbacks.onStepEnd(editedKey, editedResult);
    } else {
      // 最后一轮仍未通过，强制以最后一稿进入后续流程
      if (!lastEditedResult) {
        lastEditedResult = {
          content: currentDraft,
          chars: currentDraft.length,
          chunks: 0,
          durationMs: 0,
        };
      }
      await writeFile(workId, `chapter_${nextNumber}_edited.txt`, lastEditedResult.content);
    }
  }

  // 保存 editor 评审结果为 review JSON（供 fitness evaluator 使用）
  if (lastEditResult) {
    const finalVerdict = await editReviewer.parseEditorVerdict(lastEditResult.content);
    await editReviewer.saveEditorReviewAsJson(workId, nextNumber, lastEditResult.content, finalVerdict);
  }
  } // <-- 闭合 stages.editor?.enabled === false 的 else 块

  // 3. 去AI化：风格化
  let humanizedResult;
  if (stages.humanizer?.enabled === false || await shouldAutoSkip(workId, 'humanizer', pipelineCfg.autoSkip, isFreeMode)) {
    console.log(`[pipeline] 第${nextNumber}章 Humanizer 已禁用，跳过`);
    humanizedResult = lastEditedResult;
    await writeFile(workId, `chapter_${nextNumber}_humanized.txt`, humanizedResult.content);
  } else {
    if (callbacks.onStepStart)
      callbacks.onStepStart({
        key: `humanized_${nextNumber}`,
        name: `第${nextNumber}章 去AI化`,
        model: models.humanizer,
      });
    const humanizePrompt = await loadPrompt(await resolvePromptName('humanizer', workId), {
      style,
      content: lastEditedResult.content,
    }, meta.language || 'zh');
    humanizedResult = await runStreamChat(
      [{ role: 'user', content: humanizePrompt }],
      await resolveRoleModelConfig('humanizer', models.humanizer),
      {
        onChunk: (chunk) => {
          if (callbacks.onChunk) callbacks.onChunk(`humanized_${nextNumber}`, chunk);
        },
      },
      { workId, agentType: 'humanizer', promptTemplate: 'humanizer.md' }
    );
    await writeFile(workId, `chapter_${nextNumber}_humanized.txt`, humanizedResult.content);
    if (callbacks.onStepEnd) callbacks.onStepEnd(`humanized_${nextNumber}`, humanizedResult);
  }

  // 5. 校编：校对（自由风跳过，或 pipeline 配置禁用，或 autoSkip）
  let finalResult;
  const skipProofreader = isFreeMode || stages.proofreader?.enabled === false || (stages.proofreader?.skipIfFreeMode && isFreeMode) || await shouldAutoSkip(workId, 'proofreader', pipelineCfg.autoSkip, isFreeMode);
  if (skipProofreader) {
    console.log(`[pipeline] 第${nextNumber}章 Proofreader 已跳过（自由风或禁用）`);
    finalResult = humanizedResult;
    await writeFile(workId, `chapter_${nextNumber}_final.txt`, finalResult.content);
    await appendToFullTxt(workId, `第${nextNumber}章`, finalResult.content);
  } else {
    if (callbacks.onStepStart)
      callbacks.onStepStart({
        key: `final_${nextNumber}`,
        name: `第${nextNumber}章 校编`,
        model: models.proofreader,
      });
    const proofPrompt = await loadPrompt('proofreader', {
      content: humanizedResult.content,
    }, meta.language || 'zh');
    finalResult = await runStreamChat(
      [{ role: 'user', content: proofPrompt }],
      await resolveRoleModelConfig('proofreader', models.proofreader),
      {
        onChunk: (chunk) => {
          if (callbacks.onChunk) callbacks.onChunk(`final_${nextNumber}`, chunk);
        },
      },
      { workId, agentType: 'proofreader', promptTemplate: 'proofreader.md' }
    );
    await writeFile(workId, `chapter_${nextNumber}_final.txt`, finalResult.content);
    await appendToFullTxt(workId, `第${nextNumber}章`, finalResult.content);
    if (callbacks.onStepEnd) callbacks.onStepEnd(`final_${nextNumber}`, finalResult);
  }

  // 6. 读者：反馈
  let feedbackResult;
  if (stages.reader?.enabled === false) {
    console.log(`[pipeline] 第${nextNumber}章 Reader 已禁用，跳过`);
    feedbackResult = { content: '{"skipped":true}' };
    await writeFile(workId, `chapter_${nextNumber}_feedback.json`, feedbackResult.content);
  } else {
    if (callbacks.onStepStart)
      callbacks.onStepStart({
        key: `feedback_${nextNumber}`,
        name: `第${nextNumber}章 读者反馈`,
        model: models.reader,
      });
    feedbackResult = await generateReaderFeedback(finalResult.content, style, models.reader, {
      onChunk: (chunk) => {
        if (callbacks.onChunk) callbacks.onChunk(`feedback_${nextNumber}`, chunk);
      },
    }, workId);
    let feedbackJson = feedbackResult.content;
    // 尝试去掉 markdown 代码块
    feedbackJson = feedbackJson.replace(/```json\s*/i, '').replace(/```\s*$/m, '').trim();
    await writeFile(workId, `chapter_${nextNumber}_feedback.json`, feedbackJson);
    if (callbacks.onStepEnd) callbacks.onStepEnd(`feedback_${nextNumber}`, feedbackResult);
  }

  // 7. 摘要
  let summaryResult;
  if (stages.summarizer?.enabled === false) {
    console.log(`[pipeline] 第${nextNumber}章 Summarizer 已禁用，跳过`);
    summaryResult = { content: `第${nextNumber}章摘要（Summarizer 已禁用）` };
    await writeFile(workId, `chapter_${nextNumber}_summary.txt`, summaryResult.content);
  } else {
    if (callbacks.onStepStart)
      callbacks.onStepStart({
        key: `summary_${nextNumber}`,
        name: `第${nextNumber}章 摘要`,
        model: models.summarizer,
      });
    summaryResult = await generateChapterSummary(finalResult.content, style, models.summarizer, {
      onChunk: (chunk) => {
        if (callbacks.onChunk) callbacks.onChunk(`summary_${nextNumber}`, chunk);
      },
    }, workId);
  }
  await writeFile(workId, `chapter_${nextNumber}_summary.txt`, summaryResult.content);
  if (callbacks.onStepEnd) callbacks.onStepEnd(`summary_${nextNumber}`, summaryResult);

  // 更新智能检索索引
  try {
    await appendChapterToIndex(workId, nextNumber, summaryResult.content, style, models.summarizer);
  } catch (err) {
    console.error('[chapter-writer] 更新智能检索索引失败:', err.message);
  }

  // RAG 向量索引：为章节摘要生成 embedding
  try {
    await indexChapterSummary(workId, nextNumber, summaryResult.content, models.summarizer);
  } catch (err) {
    console.error('[chapter-writer] RAG 摘要索引失败:', err.message);
  }

  // 时序真相数据库：提取 truth delta 并更新
  try {
    const summaryDelta = extractTruthDeltaFromSummary(summaryResult.content, workId, nextNumber);
    if (summaryDelta) {
      await truthManager.applyChapterDelta(workId, nextNumber, summaryDelta);
      console.log(`[truth] 第${nextNumber}章 truth delta 已应用`);
    }
  } catch (err) {
    console.error('[chapter-writer] truth delta 应用失败:', err.message);
  }

  // 声纹字典：从 final 文本提取角色对话声纹
  try {
    await voiceFingerprint.extractFromChapter(workId, nextNumber, finalResult.content);
    console.log(`[voice] 第${nextNumber}章声纹已提取`);
  } catch (err) {
    console.error('[chapter-writer] 声纹提取失败:', err.message);
  }

  // 角色专属记忆：从摘要提取角色经历
  try {
    await characterMemory.extractEpisodesFromSummary(workId, nextNumber, summaryResult.content);
    console.log(`[memory] 第${nextNumber}章角色记忆已更新`);
  } catch (err) {
    console.error('[chapter-writer] 角色记忆提取失败:', err.message);
  }

  // Fitness 评估
  const fitnessResult = await runFitnessEvaluation(workId, nextNumber, finalResult.chars);

  // 输出治理：入队
  try {
    await outputGovernance.enqueueChapter(workId, nextNumber, {
      fitnessScore: fitnessResult?.score,
    });
  } catch (err) {
    console.error('[chapter-writer] 输出治理入队失败:', err.message);
  }

  // Skill 自动萃取：如果 Fitness 足够高，尝试萃取新 Skill
  if (fitnessResult?.score >= 0.85) {
    try {
      const extraction = await skillExtractor.triggerSkillExtraction(workId, {
        minFitness: 0.85,
        minConsecutive: 3,
        model: models.summarizer,
      });
      if (extraction.triggered) {
        console.log(`[skill] 自动萃取 Skill 成功: ${extraction.skill.name}`);
      }
    } catch (err) {
      console.error('[chapter-writer] Skill 萃取失败:', err.message);
    }
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
  const engineCfg = await getConfig('engine');
  const pipelineCfg = engineCfg.pipeline || {};
  const stages = pipelineCfg.stages || {};
  const style =
    (await expandStyle(meta.platformStyle, meta.authorStyle)) || (await expandStyle(meta.style));
  const outlineDetailed = outlineGenerator.getCurrentVolumeOutline(workId, meta);

  // ===== Plan 模式：章节节拍规划 =====
  let chapterPlan = null;
  if (pipelineCfg.plan?.enabled) {
    try {
      chapterPlan = await planChapterBeats(workId, meta, nextNumber, models, callbacks);
      if (chapterPlan) {
        console.log(`[chapter-writer] 第${nextNumber}章 节拍规划完成，beats=${chapterPlan.beats?.length || 0}`);
      }
    } catch (err) {
      console.error(`[chapter-writer] 第${nextNumber}章 节拍规划失败（继续写作）:`, err.message);
    }
  }
  const { fullContext: previousContext } = await contextBuilder.buildSmartContext(
    workId,
    meta,
    nextNumber,
    models,
    {
      onChunk: (chunk) => {
        if (callbacks.onChunk) callbacks.onChunk(`context_${nextNumber}`, chunk);
      },
    }
  );
  const worldContext = await getWorldContextForPrompt(workId, nextNumber);
  const isFreeMode = (await getWritingMode(workId)) === 'free';

  // ===== 输入治理：plan + compose =====
  let governanceVars = null;
  if (engineCfg.inputGovernance?.enabled) {
    try {
      if (engineCfg.inputGovernance?.planBeforeWrite) {
        await inputGovernance.planChapter(workId, nextNumber);
        console.log(`[input-gov] 第${nextNumber}章 plan 完成`);
      }
      if (engineCfg.inputGovernance?.composeContext) {
        await inputGovernance.composeChapter(workId, nextNumber);
        console.log(`[input-gov] 第${nextNumber}章 compose 完成`);
      }
      governanceVars = await inputGovernance.getGovernanceVariables(workId, nextNumber);
    } catch (err) {
      console.error(`[input-gov] 第${nextNumber}章 输入治理失败（继续写作）:`, err.message);
    }
  }

  // 生成正文
  if (callbacks.onStepStart)
    callbacks.onStepStart({
      key: `chapter_${nextNumber}`,
      name: `第${nextNumber}章 正文`,
      model: models.writer,
    });
  const wordVars = await getChapterWordVariables();
  let chapterPrompt = await loadPrompt(await resolvePromptName('chapter', workId), {
    topic: meta.topic,
    style,
    outlineTheme: meta.outlineTheme,
    outlineDetailed,
    previousContext,
    nextNumber,
    ...wordVars,
  }, meta.language || 'zh');
  if (worldContext) chapterPrompt += '\n\n【世界观上下文】\n' + worldContext;

  // 输入治理：注入治理变量
  if (governanceVars && governanceVars.governanceEnabled) {
    const govLines = [];
    if (governanceVars.authorLongTermVision)
      govLines.push(`【长期愿景】${governanceVars.authorLongTermVision}`);
    if (governanceVars.focusText)
      govLines.push(
        `【当前焦点】${governanceVars.focusText}（目标${governanceVars.targetChapters}章内完成）`
      );
    if (governanceVars.chapterMustKeep)
      govLines.push(`【本章必须保留】${governanceVars.chapterMustKeep}`);
    if (governanceVars.chapterMustAvoid)
      govLines.push(`【本章必须避免】${governanceVars.chapterMustAvoid}`);
    if (governanceVars.ruleStackText) govLines.push(`【规则栈】\n${governanceVars.ruleStackText}`);
    if (govLines.length) {
      chapterPrompt +=
        '\n\n========== 输入治理指令 ==========\n' +
        govLines.join('\n\n') +
        '\n========== 输入治理指令结束 ==========';
    }
  }

  // Plan 模式：注入节拍规划到 Writer prompt
  if (chapterPlan && chapterPlan.beats && chapterPlan.beats.length > 0) {
    const beatsText = chapterPlan.beats.map((b, i) =>
      `${i + 1}. [${b.type}] ${b.description}（约${b.estimatedWords || '?'}字）`
    ).join('\n');
    chapterPrompt +=
      '\n\n========== 本章节拍规划 ==========\n' +
      `整体基调：${chapterPlan.overallTone || '未指定'}\n\n` +
      `叙事节拍：\n${beatsText}\n` +
      (chapterPlan.riskFlags?.length ? `\n风险提示：${chapterPlan.riskFlags.join('、')}\n` : '') +
      '========== 本章节拍规划结束 ==========';
  }

  const chapterResult = await runStreamChat(
    [{ role: 'user', content: chapterPrompt }],
    await resolveWriterModel(nextNumber, models.writer),
    {
      onChunk: (chunk) => {
        if (callbacks.onChunk) callbacks.onChunk(`chapter_${nextNumber}`, chunk);
      },
    },
    { workId, agentType: 'chapter', promptTemplate: 'chapter.md' }
  );
  await writeFile(workId, `chapter_${nextNumber}.txt`, chapterResult.content);
  if (callbacks.onStepEnd) callbacks.onStepEnd(`chapter_${nextNumber}`, chapterResult);

  // 润色（自由风跳过，或 pipeline 配置禁用，或 autoSkip）
  let polishResult;
  const skipPolish = isFreeMode || stages.polish?.enabled === false || (stages.polish?.skipIfFreeMode && isFreeMode) || await shouldAutoSkip(workId, 'polish', pipelineCfg.autoSkip, isFreeMode);
  if (skipPolish) {
    console.log(`[pipeline] 第${nextNumber}章 Polish 已跳过（自由风或禁用）`);
    polishResult = chapterResult;
    await writeFile(workId, `chapter_${nextNumber}_polish.txt`, polishResult.content);
    await appendToFullTxt(workId, `第${nextNumber}章`, polishResult.content);
  } else {
    if (callbacks.onStepStart)
      callbacks.onStepStart({
        key: `polish_${nextNumber}`,
        name: `第${nextNumber}章 润色`,
        model: models.polish,
      });
    const polishPrompt = await loadPrompt('polish', {
      style,
      content: chapterResult.content,
    }, meta.language || 'zh');
    polishResult = await runStreamChat(
      [{ role: 'user', content: polishPrompt }],
      await resolveRoleModelConfig('polish', models.polish),
      {
        onChunk: (chunk) => {
          if (callbacks.onChunk) callbacks.onChunk(`polish_${nextNumber}`, chunk);
        },
      },
      { workId, agentType: 'polish', promptTemplate: 'polish.md' }
    );
    await writeFile(workId, `chapter_${nextNumber}_polish.txt`, polishResult.content);
    await appendToFullTxt(workId, `第${nextNumber}章`, polishResult.content);
    if (callbacks.onStepEnd) callbacks.onStepEnd(`polish_${nextNumber}`, polishResult);
  }

  // 读者反馈
  let feedbackResult;
  if (stages.reader?.enabled === false) {
    console.log(`[pipeline] 第${nextNumber}章 Reader 已禁用，跳过`);
    feedbackResult = { content: '{"skipped":true}' };
    await writeFile(workId, `chapter_${nextNumber}_feedback.json`, feedbackResult.content);
  } else {
    if (callbacks.onStepStart)
      callbacks.onStepStart({
        key: `feedback_${nextNumber}`,
        name: `第${nextNumber}章 读者反馈`,
        model: models.reader,
      });
    feedbackResult = await generateReaderFeedback(polishResult.content, style, models.reader, {
      onChunk: (chunk) => {
        if (callbacks.onChunk) callbacks.onChunk(`feedback_${nextNumber}`, chunk);
      },
    }, workId);
    let feedbackJson = feedbackResult.content;
    feedbackJson = feedbackJson.replace(/```json\s*/i, '').replace(/```\s*$/m, '').trim();
    await writeFile(workId, `chapter_${nextNumber}_feedback.json`, feedbackJson);
    if (callbacks.onStepEnd) callbacks.onStepEnd(`feedback_${nextNumber}`, feedbackResult);
  }

  // 摘要
  let summaryResult;
  if (stages.summarizer?.enabled === false) {
    console.log(`[pipeline] 第${nextNumber}章 Summarizer 已禁用，跳过`);
    summaryResult = { content: `第${nextNumber}章摘要（Summarizer 已禁用）` };
    await writeFile(workId, `chapter_${nextNumber}_summary.txt`, summaryResult.content);
  } else {
    if (callbacks.onStepStart)
      callbacks.onStepStart({
        key: `summary_${nextNumber}`,
        name: `第${nextNumber}章 摘要`,
        model: models.summarizer,
      });
    summaryResult = await generateChapterSummary(polishResult.content, style, models.summarizer, {
      onChunk: (chunk) => {
        if (callbacks.onChunk) callbacks.onChunk(`summary_${nextNumber}`, chunk);
      },
    }, workId);
    await writeFile(workId, `chapter_${nextNumber}_summary.txt`, summaryResult.content);
    if (callbacks.onStepEnd) callbacks.onStepEnd(`summary_${nextNumber}`, summaryResult);
  }

  // 更新索引
  try {
    await appendChapterToIndex(workId, nextNumber, summaryResult.content, style, models.summarizer);
  } catch (err) {
    console.error('[chapter-writer] 更新索引失败:', err.message);
  }

  // RAG 向量索引
  try {
    await indexChapterSummary(workId, nextNumber, summaryResult.content, models.summarizer);
  } catch (err) {
    console.error('[chapter-writer] RAG 摘要索引失败:', err.message);
  }

  // 时序真相数据库：提取 truth delta 并更新
  try {
    const summaryDelta = extractTruthDeltaFromSummary(summaryResult.content, workId, nextNumber);
    if (summaryDelta) {
      await truthManager.applyChapterDelta(workId, nextNumber, summaryDelta);
      console.log(`[truth] 第${nextNumber}章 truth delta 已应用`);
    }
  } catch (err) {
    console.error('[chapter-writer] truth delta 应用失败:', err.message);
  }

  // 声纹字典：从 polish 文本提取角色对话声纹
  try {
    await voiceFingerprint.extractFromChapter(workId, nextNumber, polishResult.content);
    console.log(`[voice] 第${nextNumber}章声纹已提取`);
  } catch (err) {
    console.error('[chapter-writer] 声纹提取失败:', err.message);
  }

  // 角色专属记忆：从摘要提取角色经历
  try {
    await characterMemory.extractEpisodesFromSummary(workId, nextNumber, summaryResult.content);
    console.log(`[memory] 第${nextNumber}章角色记忆已更新`);
  } catch (err) {
    console.error('[chapter-writer] 角色记忆提取失败:', err.message);
  }

  // Fitness 评估
  const fitnessResult = await runFitnessEvaluation(workId, nextNumber, polishResult.chars);

  // 输出治理：入队
  try {
    await outputGovernance.enqueueChapter(workId, nextNumber, {
      fitnessScore: fitnessResult?.score,
    });
  } catch (err) {
    console.error('[chapter-writer] 输出治理入队失败:', err.message);
  }

  // Skill 自动萃取
  if (fitnessResult?.score >= 0.85) {
    try {
      const extraction = await skillExtractor.triggerSkillExtraction(workId, {
        minFitness: 0.85,
        minConsecutive: 3,
        model: models.summarizer,
      });
      if (extraction.triggered) {
        console.log(`[skill] 自动萃取 Skill 成功: ${extraction.skill.name}`);
      }
    } catch (err) {
      console.error('[chapter-writer] Skill 萃取失败:', err.message);
    }
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

module.exports = {
  writeChapterMultiAgent,
  writeChapterPipeline,
};
