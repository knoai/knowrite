/**
 * 输出治理服务 - 生产者-消费者模式
 *
 * 核心职责：
 * 1. enqueueChapter(workId, chapterNumber, metadata) — 将章节推入队列
 * 2. processQueue() — 消费队列，按优先级处理
 * 3. runL1Validation(queueItem) — 自动规则验证
 * 4. runL2Validation(queueItem) — LLM 深度验证
 * 5. submitHumanReview(queueItem, decision, notes) — 人工审核
 * 6. releaseChapter(queueItem) — 发布章节
 */

const { OutputQueue, OutputValidationRule, Chapter } = require('../models');
const fileStore = require('./file-store');
const { getWorkDir } = require('../core/paths');

class OutputGovernanceService {
  constructor() {
    this.processing = false;
    this.rulesCache = null;
    this.rulesCacheTime = 0;
  }

  async enqueueChapter(workId, chapterNumber, metadata = {}) {
    const { fitnessScore } = metadata;
    const priority = fitnessScore ? Math.round(fitnessScore * 10) : 5;

    const [queueItem] = await OutputQueue.findOrCreate({
      where: { workId, chapterNumber },
      defaults: {
        enqueuedAt: new Date(),
        priority,
        fitnessScore,
        status: 'pending',
      },
    });

    if (!queueItem.isNewRecord) {
      await queueItem.update({
        priority,
        fitnessScore,
        status: 'pending',
        enqueuedAt: new Date(),
      });
    }

    this.triggerQueueProcessing();
    return queueItem;
  }

  async processQueue() {
    if (this.processing) return;
    this.processing = true;

    try {
      while (true) {
        const item = await OutputQueue.findOne({
          where: { status: 'pending' },
          order: [['priority', 'DESC'], ['enqueuedAt', 'ASC']],
        });

        if (!item) break;

        await this.runL1Validation(item);
        if (item.status === 'l1_failed') continue;

        await this.runL2Validation(item);
        if (item.status === 'l2_failed') continue;

        if (await this.requiresHumanReview(item)) {
          await item.update({ status: 'human_reviewing' });
          continue;
        }

        await this.releaseChapter(item, 'system');
      }
    } finally {
      this.processing = false;
    }
  }

  async runL1Validation(item) {
    await item.update({ status: 'l1_validating' });
    const results = [];
    const rules = await this.loadActiveRules('l1');

    for (const rule of rules) {
      const result = await this.evaluateRule(rule, item);
      results.push(result);
      if (result.passed === false && rule.action === 'block') {
        await item.update({
          status: 'l1_failed',
          l1Result: { passed: false, results, failedRule: rule.name },
        });
        return;
      }
    }

    await item.update({
      status: 'l2_validating',
      l1Result: { passed: true, results },
    });
  }

  async runL2Validation(item) {
    await item.update({ status: 'l2_validating' });
    const chapterText = await this.loadChapterText(item.workId, item.chapterNumber);
    const styleFingerprint = require('./author-fingerprint');
    const fingerprints = await styleFingerprint.getActiveFingerprints(item.workId);
    const truthManager = require('./truth-manager');
    const truthState = await truthManager.getCurrentState(item.workId);

    const deviations = [];
    for (const fp of fingerprints) {
      const validation = await styleFingerprint.validateAgainstFingerprint(item.workId, chapterText, fp.id);
      if (validation && !validation.passed) {
        deviations.push({ fingerprint: fp.name, score: validation.overallScore });
      }
    }

    const passed = deviations.length === 0 || deviations.every((d) => d.score >= 0.6);

    if (!passed) {
      await item.update({
        status: 'l2_failed',
        l2Result: { passed: false, deviations },
      });
      return;
    }

    await item.update({
      status: 'human_reviewing',
      l2Result: { passed: true, deviations },
    });
  }

  async requiresHumanReview(item) {
    if (item.fitnessScore && item.fitnessScore < 0.5) return true;
    if (item.chapterNumber % 10 === 0) return true;

    const truthManager = require('./truth-manager');
    const anomalies = await truthManager.detectAnomalies(item.workId);
    const chapterAnomalies = anomalies.filter((a) => a.chapter === item.chapterNumber);
    if (chapterAnomalies.some((a) => a.severity === 'critical')) return true;

    return false;
  }

  async releaseChapter(item, releasedBy) {
    await item.update({
      status: 'released',
      releasedAt: new Date(),
      releasedBy,
    });
  }

  async submitHumanReview(queueId, decision, notes = '') {
    const item = await OutputQueue.findByPk(queueId);
    if (!item || item.status !== 'human_reviewing') {
      throw new Error('Queue item not found or not in human_reviewing state');
    }

    if (decision === 'approve') {
      await item.update({
        humanReview: { decision, notes, reviewedAt: new Date() },
      });
      await this.releaseChapter(item, 'human');
    } else if (decision === 'reject') {
      await item.update({
        status: 'human_rejected',
        humanReview: { decision, notes, reviewedAt: new Date() },
      });
    } else if (decision === 'revise') {
      await item.update({
        status: 'pending',
        humanReview: { decision, notes, reviewedAt: new Date() },
      });
    }

    return item;
  }

  // ==================== 规则评估 ====================

  async evaluateRule(rule, item) {
    const { condition } = rule;

    switch (condition.type) {
      case 'min_word_count': {
        const text = await this.loadChapterText(item.workId, item.chapterNumber);
        const count = text.replace(/\s/g, '').length;
        return { rule: rule.name, passed: count >= condition.value, actual: count };
      }
      case 'max_style_deviation': {
        const styleService = require('./author-fingerprint');
        const text = await this.loadChapterText(item.workId, item.chapterNumber);
        const fingerprints = await styleService.getActiveFingerprints(item.workId);
        if (!fingerprints.length) return { rule: rule.name, passed: true };
        const validation = await styleService.validateAgainstFingerprint(item.workId, text, fingerprints[0].id);
        const deviation = 1 - (validation?.overallScore || 1);
        return { rule: rule.name, passed: deviation <= condition.value, actual: deviation };
      }
      case 'min_fitness_score': {
        return { rule: rule.name, passed: (item.fitnessScore || 0) >= condition.value, actual: item.fitnessScore };
      }
      case 'format_compliance': {
        const text = await this.loadChapterText(item.workId, item.chapterNumber);
        const hasChapterTitle = /^第[一二三四五六七八九十百千]+章/.test(text) || /^第\d+章/.test(text);
        return { rule: rule.name, passed: hasChapterTitle };
      }
      default:
        return { rule: rule.name, passed: true, note: 'Unknown rule type' };
    }
  }

  // ==================== 辅助方法 ====================

  async loadActiveRules(level) {
    const now = Date.now();
    if (!this.rulesCache || now - this.rulesCacheTime > 60000) {
      this.rulesCache = await OutputValidationRule.findAll({ where: { isActive: true } });
      this.rulesCacheTime = now;
    }
    return this.rulesCache.filter((r) => r.level === level);
  }

  async loadChapterText(workId, chapterNumber) {
    const chapter = await Chapter.findOne({ where: { workId, number: chapterNumber } });
    if (!chapter) return '';
    return await fileStore.readFile(workId, chapter.finalFile || chapter.rawFile) || '';
  }

  triggerQueueProcessing() {
    setImmediate(() => this.processQueue().catch((err) => {
      console.error('[output-governance] Queue processing error:', err.message);
    }));
  }

  async getQueueForWork(workId) {
    return await OutputQueue.findAll({
      where: { workId },
      order: [['chapterNumber', 'DESC']],
    });
  }
}

module.exports = new OutputGovernanceService();
