/**
 * 真相文件管理器
 *
 * 基于 temporal-truth.js 时序数据库的上层封装。
 * 对外提供与 v1 设计兼容的 API，内部使用 append-only 事件流。
 */

const temporalTruth = require('./temporal-truth');
const { TruthHook, TruthResource } = require('../models');

/**
 * 初始化 truth 文件（从现有作品数据逆向工程）
 */
async function initializeTruthFiles(workId) {
  return await temporalTruth.initializeTruthFiles(workId);
}

/**
 * 从 Summarizer 输出中提取 delta，更新 truth 文件
 *
 * 调用时机：Summarizer 完成后
 * 输入：Summarizer 输出的结构化 JSON delta
 * 输出：更新的 truth 记录 + 投影文件
 */
async function applyChapterDelta(workId, chapterNumber, summaryDelta) {
  // 1. 批量追加事件到时序数据库
  const eventCount = await temporalTruth.appendEventsFromDelta(workId, chapterNumber, summaryDelta);

  // 2. 更新 TruthHook 状态（从 resolvedHooks）
  for (const resolved of summaryDelta.resolvedHooks || []) {
    await TruthHook.update(
      { status: 'resolved', resolvedChapter: chapterNumber },
      { where: { workId, hookId: resolved.hookId } }
    );
  }

  // 3. 更新 TruthResource（从 resourceChanges）
  for (const change of summaryDelta.resourceChanges || []) {
    const resource = await TruthResource.findOne({ where: { workId, name: change.name } });
    if (resource) {
      const updates = { [change.field]: change.newValue };
      if (change.field === 'status' && change.newValue === 'consumed') {
        updates.consumedChapter = chapterNumber;
      }
      if (change.field === 'status' && change.newValue === 'lost') {
        updates.lostChapter = chapterNumber;
      }
      if (change.field === 'owner') {
        const history = resource.transferHistory || [];
        history.push({
          from: resource.owner,
          to: change.newValue,
          chapter: chapterNumber,
          reason: change.reason || '',
        });
        updates.transferHistory = history;
      }
      await resource.update(updates);
    }
  }

  // 4. 重新生成投影文件
  await temporalTruth.regenerateProjections(workId);

  return { updated: true, eventsAppended: eventCount };
}

/**
 * 获取当前状态（截至最新章节）
 */
async function getCurrentState(workId) {
  return await temporalTruth.getCurrentState(workId);
}

/**
 * 获取角色在指定章节的状态
 */
async function getCharacterStateAt(workId, charName, chapterNumber) {
  return await temporalTruth.getCharacterStateAt(workId, charName, chapterNumber);
}

/**
 * 获取未闭合伏笔
 */
async function getOpenHooks(workId) {
  return await temporalTruth.getOpenHooks(workId);
}

/**
 * 获取活跃资源
 */
async function getActiveResources(workId) {
  return await temporalTruth.getActiveResources(workId);
}

/**
 * 为连续性审计/compose 选择 truth 片段
 */
async function selectFragmentsForChapter(workId, chapterNumber, intent) {
  return await temporalTruth.selectFragmentsForChapter(workId, chapterNumber, intent);
}

/**
 * 重新生成投影文件
 */
async function regenerateProjections(workId) {
  return await temporalTruth.regenerateProjections(workId);
}

/**
 * 趋势分析
 */
async function analyzeTrends(workId, metric, options) {
  return await temporalTruth.analyzeTrends(workId, metric, options);
}

/**
 * 异常检测
 */
async function detectAnomalies(workId) {
  return await temporalTruth.detectAnomalies(workId);
}

/**
 * 时间旅行查询
 */
async function queryStateAt(workId, chapterNumber, subjectType, subjectId) {
  return await temporalTruth.queryStateAt(workId, chapterNumber, subjectType, subjectId);
}

/**
 * 变化追踪
 */
async function traceChanges(workId, subjectType, subjectId, fromChapter, toChapter) {
  return await temporalTruth.traceChanges(workId, subjectType, subjectId, fromChapter, toChapter);
}

/**
 * 物化指定章节的状态
 */
async function materializeState(workId, chapterNumber) {
  return await temporalTruth.materializeState(workId, chapterNumber);
}

module.exports = {
  initializeTruthFiles,
  applyChapterDelta,
  getCurrentState,
  getCharacterStateAt,
  getOpenHooks,
  getActiveResources,
  selectFragmentsForChapter,
  regenerateProjections,
  analyzeTrends,
  detectAnomalies,
  queryStateAt,
  traceChanges,
  materializeState,
};
