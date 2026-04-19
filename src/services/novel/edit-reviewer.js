/**
 * 编辑评审模块
 * 负责编辑历史构建、评审解析、评审结果保存
 */

const path = require('path');
const fs = require('fs');
const engineCfg = require('../../../config/engine.json');
const { getWorkDir } = require('../../core/paths');
const fileStore = require('../file-store');

/**
 * 构建编辑历史记录
 */
async function buildEditHistory(workId, chapterNumber, currentRound) {
  const histories = [];
  const maxCharsPerRound = 1500;
  for (let r = 1; r < currentRound; r++) {
    const content = await fileStore.readFile(workId, `chapter_${chapterNumber}_edit_v${r}.txt`);
    if (content) {
      const truncated = content.substring(0, maxCharsPerRound);
      histories.push(`【第${r}轮评审意见】\n${truncated}${content.length > maxCharsPerRound ? '\n...(已截断)' : ''}`);
    }
  }
  if (histories.length === 0) return '';
  return '\n\n========== 历史评审记录 ==========\n' + histories.join('\n\n') + '\n\n========== 以上为之前各轮的评审意见，供你对比参考 ==========\n';
}

/**
 * 构建 editor 审阅用的 draft 预览文本。
 * 当文本超过截断长度时，采用头尾组合截取，让 editor 看到开头和结尾。
 */
function buildEditorDraftPreview(text, maxChars, headRatio = 0.5) {
  if (!text || text.length <= maxChars) return text;
  const headChars = Math.floor(maxChars * headRatio);
  const tailChars = maxChars - headChars - 20; // 预留省略标记长度
  const head = text.substring(0, headChars);
  const tail = text.substring(text.length - tailChars);
  return `${head}\n\n【……中间省略 ${text.length - headChars - tailChars} 字……】\n\n${tail}`;
}

/**
 * 解析编辑评审结果
 */
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

/**
 * 保存编辑评审结果为 JSON
 */
async function saveEditorReviewAsJson(workId, chapterNumber, content, verdict) {
  const reviewDir = path.join(getWorkDir(workId), `review_chapter_${chapterNumber}`);
  await fs.promises.mkdir(reviewDir, { recursive: true });

  const scores = {};
  for (const dim of verdict.dimensions || []) {
    scores[dim.name] = { score: dim.passed ? 10 : 0, reason: dim.reason };
  }
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

module.exports = {
  buildEditHistory,
  buildEditorDraftPreview,
  parseEditorVerdict,
  saveEditorReviewAsJson,
};
