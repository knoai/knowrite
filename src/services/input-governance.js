/**
 * 输入治理服务：plan + compose，零 LLM 调用
 */

const { getWorkDir } = require('../core/paths');
const fileStore = require('./file-store');
const { AuthorIntent, CurrentFocus, ChapterIntent, Work } = require('../models');

/**
 * planChapter(workId, chapterNumber) → ChapterIntent
 *
 * 本地编译章节意图，不调用 LLM。
 */
async function planChapter(workId, chapterNumber) {
  const authorIntent = await AuthorIntent.findOne({ where: { workId } });
  const activeFocuses = await CurrentFocus.findAll({
    where: { workId, isActive: true },
    order: [['priority', 'DESC'], ['createdAt', 'DESC']],
  });

  // 从作品 metadata 中提取大纲信息（简化版）
  const work = await Work.findByPk(workId);
  const volumeOutline = work?.outlineDetailed || '';

  const intent = {
    workId,
    chapterNumber,
    mustKeep: compileMustKeep(authorIntent, activeFocuses, volumeOutline, chapterNumber),
    mustAvoid: compileMustAvoid(authorIntent, activeFocuses, volumeOutline, chapterNumber),
    sceneBeats: [],
    conflictResolution: '',
    emotionalGoal: '',
    ruleStack: compileRuleStack(authorIntent, activeFocuses, volumeOutline),
    plannedAt: new Date(),
  };

  await ChapterIntent.upsert(intent);

  const workDir = getWorkDir(workId);
  await fileStore.writeFile(
    `${workDir}/runtime/chapter_${chapterNumber}_intent.json`,
    JSON.stringify(intent, null, 2)
  );

  return intent;
}

/**
 * composeChapter(workId, chapterNumber) → { context, ruleStackText }
 *
 * 基于 ChapterIntent 选择上下文，编译规则栈。
 */
async function composeChapter(workId, chapterNumber) {
  const intent = await ChapterIntent.findOne({ where: { workId, chapterNumber } });
  if (!intent) {
    throw new Error(`ChapterIntent not found for ${workId} ch${chapterNumber}. Run planChapter first.`);
  }

  const truthManager = require('./truth-manager');
  const worldContext = require('./world-context');

  const truthFragments = await truthManager.selectFragmentsForChapter(workId, chapterNumber, intent);
  const worldCtx = await worldContext.buildWorldContext(workId, { chapterNumber: null });
  const ruleStackText = renderRuleStack(intent.ruleStack);

  const composed = {
    intent,
    truthFragments,
    worldContext: worldCtx.substring(0, 4000),
    ruleStackText,
    composedAt: new Date(),
  };

  const workDir = getWorkDir(workId);
  await fileStore.writeFile(
    `${workDir}/runtime/chapter_${chapterNumber}_compose.json`,
    JSON.stringify(composed, null, 2)
  );

  await ChapterIntent.update(
    { composedAt: new Date() },
    { where: { workId, chapterNumber } }
  );

  return composed;
}

/**
 * 获取治理变量（注入 Writer prompt）
 */
async function getGovernanceVariables(workId, chapterNumber) {
  const [authorIntent, focuses, chapterIntent] = await Promise.all([
    AuthorIntent.findOne({ where: { workId } }),
    CurrentFocus.findAll({ where: { workId, isActive: true } }),
    ChapterIntent.findOne({ where: { workId, chapterNumber } }),
  ]);

  const result = {
    governanceEnabled: !!chapterIntent,
  };

  if (authorIntent) {
    result.authorLongTermVision = authorIntent.longTermVision || '';
    result.authorThemes = (authorIntent.themes || []).join('、');
    result.authorConstraints = (authorIntent.constraints || []).join('、');
    result.authorMustKeep = authorIntent.mustKeep || '';
    result.authorMustAvoid = authorIntent.mustAvoid || '';
  }

  if (focuses.length) {
    const focus = focuses[0];
    result.focusText = focus.focusText;
    result.focusMustAvoid = '';
    result.targetChapters = focus.targetChapters;
    result.currentChapterInFocus = 1; // 简化
  }

  if (chapterIntent) {
    result.chapterMustKeep = chapterIntent.mustKeep || '';
    result.chapterMustAvoid = chapterIntent.mustAvoid || '';
    result.sceneBeats = chapterIntent.sceneBeats || [];
    result.conflictResolution = chapterIntent.conflictResolution || '';
    result.emotionalGoal = chapterIntent.emotionalGoal || '';
    result.ruleStackText = renderRuleStack(chapterIntent.ruleStack);
  }

  return result;
}

// ==================== 辅助函数 ====================

function compileMustKeep(authorIntent, activeFocuses, volumeOutline, chapterNumber) {
  const parts = [];
  if (authorIntent?.mustKeep) parts.push(`【长期保留】${authorIntent.mustKeep}`);
  if (authorIntent?.themes?.length) parts.push(`【主题】${authorIntent.themes.join('、')}`);
  for (const focus of activeFocuses) {
    parts.push(`【当前焦点】${focus.focusText}`);
  }
  parts.push(`【进度】第${chapterNumber}章`);
  return parts.join('\n');
}

function compileMustAvoid(authorIntent, activeFocuses, volumeOutline, chapterNumber) {
  const parts = [];
  if (authorIntent?.mustAvoid) parts.push(`【长期避免】${authorIntent.mustAvoid}`);
  if (authorIntent?.constraints?.length) parts.push(`【约束】${authorIntent.constraints.join('、')}`);
  for (const focus of activeFocuses) {
    // CurrentFocus 没有 mustAvoid 字段，简化处理
  }
  return parts.join('\n');
}

function compileRuleStack(authorIntent, activeFocuses, volumeOutline) {
  const stack = [];

  if (authorIntent) {
    stack.push({
      level: 1,
      source: 'author_intent',
      rules: [
        ...(authorIntent.constraints || []),
        authorIntent.mustKeep,
        authorIntent.mustAvoid,
      ].filter(Boolean),
    });
  }

  for (const focus of activeFocuses) {
    stack.push({
      level: 2,
      source: 'current_focus',
      rules: [focus.focusText].filter(Boolean),
    });
  }

  stack.push({
    level: 3,
    source: 'outline',
    rules: [volumeOutline?.substring?.(0, 500) || ''].filter(Boolean),
  });

  stack.push({
    level: 4,
    source: 'default',
    rules: ['遵循平台风格', '保持角色一致性', '控制叙事节奏'],
  });

  return stack;
}

function renderRuleStack(ruleStack) {
  if (!ruleStack || !ruleStack.length) return '';
  return ruleStack.map((layer) => {
    const header = `【优先级 L${layer.level} | ${layer.source}】`;
    const rules = layer.rules.map((r) => `  - ${r}`).join('\n');
    return `${header}\n${rules}`;
  }).join('\n\n');
}

module.exports = {
  planChapter,
  composeChapter,
  getGovernanceVariables,
  compileRuleStack,
  renderRuleStack,
};
