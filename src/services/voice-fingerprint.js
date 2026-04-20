/**
 * 人设声纹字典服务
 *
 * 核心职责：
 * 1. extractFromChapter(workId, chapterNumber, chapterText) — 从章节文本提取角色对话声纹
 * 2. getVoiceFingerprintPrompt(workId, charNames) — 生成声纹注入文本
 * 3. buildVoiceFingerprintProjection(workId) — 生成全角色声纹投影文件
 *
 * 声纹维度：
 * - 平均句长、句式模板（陈述/疑问/感叹比例）
 * - 高频词/口头禅（Top-10，含 TF-IDF 权重）
 * - 语气标记（感叹号、问号、省略号比例）
 * - 对话风格（直接/委婉/幽默/冷峻等）
 * - 修辞偏好（比喻、排比、反问等）
 * - 人称使用（我/你/他 比例）
 */

const { Character } = require('../models');
const fileStore = require('./file-store');

// ============ 核心 API ============

async function extractFromChapter(workId, chapterNumber, chapterText) {
  const dialogues = extractDialogues(chapterText);
  const bySpeaker = {};

  for (const { speaker, text } of dialogues) {
    if (!bySpeaker[speaker]) {
      bySpeaker[speaker] = { texts: [], totalLength: 0 };
    }
    bySpeaker[speaker].texts.push(text);
    bySpeaker[speaker].totalLength += text.length;
  }

  const results = [];
  for (const [speaker, data] of Object.entries(bySpeaker)) {
    if (data.texts.length < 2) continue; // 对话太少，不建立声纹
    const fingerprint = analyzeSpeakerVoice(data.texts);
    results.push({ charName: speaker, fingerprint, dialogueCount: data.texts.length });
  }

  // 更新数据库
  for (const r of results) {
    await updateCharacterVoice(workId, r.charName, r.fingerprint, chapterNumber);
  }

  return results;
}

async function updateCharacterVoice(workId, charName, fingerprint, latestChapter) {
  const char = await Character.findOne({ where: { workId, name: charName } });
  if (!char) return; // 只维护已登记角色的声纹

  const existing = char.voiceFingerprint || {};
  const merged = mergeVoiceFingerprint(existing, fingerprint, latestChapter);

  await char.update({ voiceFingerprint: merged });
}

/**
 * 获取指定角色的声纹注入文本
 */
async function getVoiceFingerprintPrompt(workId, charNames = []) {
  const where = { workId };
  if (charNames.length > 0) {
    where.name = charNames;
  }

  const characters = await Character.findAll({ where });
  const withVoice = characters.filter((c) => c.voiceFingerprint && c.voiceFingerprint.avgSentenceLength);

  if (withVoice.length === 0) return '';

  const lines = ['## 角色声纹字典（人设一致性参考）', ''];

  for (const c of withVoice) {
    const v = c.voiceFingerprint;
    lines.push(`### ${c.name}${c.alias ? `（${c.alias}）` : ''}`);
    lines.push(`- 平均句长: ${v.avgSentenceLength?.toFixed(1) || '?'} 字`);
    lines.push(`- 对话风格: ${translateStyle(v.speechStyle)}`);
    if (v.topPhrases?.length) {
      lines.push(`- 口头禅: ${v.topPhrases.slice(0, 5).map((p) => p.phrase).join('、')}`);
    }
    if (v.sentencePatterns?.length) {
      lines.push(`- 典型句式: ${v.sentencePatterns.slice(0, 3).join('、')}`);
    }
    if (v.toneMarkers) {
      const tm = v.toneMarkers;
      const parts = [];
      if (tm.exclamationRatio > 0.3) parts.push('多用感叹');
      if (tm.questionRatio > 0.2) parts.push('反问较多');
      if (tm.ellipsisRatio > 0.15) parts.push('语气迟疑');
      if (parts.length) lines.push(`- 语气特征: ${parts.join('，')}`);
    }
    if (v.rhetoric?.length) {
      lines.push(`- 修辞偏好: ${v.rhetoric.slice(0, 3).join('、')}`);
    }
    lines.push('');
  }

  lines.push('> 写作时，请确保每个角色的对话严格符合其声纹特征，避免不同角色说话风格趋同。');
  return lines.join('\n');
}

/**
 * 生成全角色声纹投影文件
 */
async function buildVoiceFingerprintProjection(workId) {
  const prompt = await getVoiceFingerprintPrompt(workId);
  if (!prompt) return;
  await fileStore.writeFile(workId, 'voice_fingerprints.md', prompt);
}

// ============ 声纹分析 ============

function analyzeSpeakerVoice(texts) {
  const allText = texts.join('');
  const sentences = allText.split(/[。！？.!?]+/).filter((s) => s.trim().length > 0);

  // 1. 平均句长
  const avgSentenceLength = sentences.reduce((sum, s) => sum + s.trim().length, 0) / Math.max(1, sentences.length);

  // 2. 句式模板
  const sentencePatterns = detectSentencePatterns(sentences);

  // 3. 高频词 / 口头禅（2-4 字短语）
  const topPhrases = extractTopPhrases(allText, 10);

  // 4. 语气标记
  const exclamationCount = (allText.match(/[！!]/g) || []).length;
  const questionCount = (allText.match(/[？?]/g) || []).length;
  const ellipsisCount = (allText.match(/[…\.]{2,}/g) || []).length;
  const totalPunct = (allText.match(/[。！？.!?]/g) || []).length;
  const toneMarkers = {
    exclamationRatio: totalPunct ? exclamationCount / totalPunct : 0,
    questionRatio: totalPunct ? questionCount / totalPunct : 0,
    ellipsisRatio: totalPunct ? ellipsisCount / totalPunct : 0,
  };

  // 5. 对话风格
  const directMarkers = ['!', '！', '快', '立刻', '必须', '杀', '战'];
  const indirectMarkers = ['或许', '可能', '也许', '如果', '不妨', '倒是'];
  const humorMarkers = ['哈哈', '嘿嘿', '呵', '笑', '打趣', '玩笑'];
  const coldMarkers = ['冷', '哼', '无聊', '无趣', '不过如此'];

  const scores = {
    direct: directMarkers.reduce((s, m) => s + (allText.includes(m) ? 1 : 0), 0),
    indirect: indirectMarkers.reduce((s, m) => s + (allText.includes(m) ? 1 : 0), 0),
    humor: humorMarkers.reduce((s, m) => s + (allText.includes(m) ? 1 : 0), 0),
    cold: coldMarkers.reduce((s, m) => s + (allText.includes(m) ? 1 : 0), 0),
  };

  const dominantStyle = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  const speechStyle = dominantStyle && dominantStyle[1] > 0 ? dominantStyle[0] : 'neutral';

  // 6. 修辞偏好
  const rhetoric = [];
  if (/像|如同|仿佛|好似|宛如/.test(allText)) rhetoric.push('比喻');
  if (/难道|岂|何尝|怎/.test(allText)) rhetoric.push('反问');
  if (/不仅.*而且|一边.*一边|有的.*有的/.test(allText)) rhetoric.push('排比/对偶');
  if (/[一二三四五].*是|首先.*其次/.test(allText)) rhetoric.push('列举');

  return {
    avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
    sentencePatterns,
    topPhrases,
    toneMarkers,
    speechStyle,
    rhetoric,
    sampleCount: texts.length,
    totalLength: allText.length,
  };
}

function mergeVoiceFingerprint(existing, incoming, latestChapter) {
  const weightOld = Math.min(0.8, (existing.sampleCount || 1) / ((existing.sampleCount || 1) + incoming.sampleCount));
  const weightNew = 1 - weightOld;

  const merged = {
    avgSentenceLength: round(
      (existing.avgSentenceLength || incoming.avgSentenceLength) * weightOld +
      incoming.avgSentenceLength * weightNew
    ),
    speechStyle: incoming.speechStyle || existing.speechStyle || 'neutral',
    toneMarkers: mergeToneMarkers(existing.toneMarkers, incoming.toneMarkers, weightOld, weightNew),
    sampleCount: (existing.sampleCount || 0) + incoming.sampleCount,
    totalLength: (existing.totalLength || 0) + incoming.totalLength,
    latestChapter,
  };

  // 合并口头禅：按频率加权
  const phraseMap = new Map();
  for (const p of existing.topPhrases || []) phraseMap.set(p.phrase, { count: p.count * weightOld, phrase: p.phrase });
  for (const p of incoming.topPhrases || []) {
    const prev = phraseMap.get(p.phrase);
    if (prev) prev.count += p.count * weightNew;
    else phraseMap.set(p.phrase, { count: p.count * weightNew, phrase: p.phrase });
  }
  merged.topPhrases = Array.from(phraseMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // 合并句式模板
  const patternSet = new Set([...(existing.sentencePatterns || []), ...incoming.sentencePatterns]);
  merged.sentencePatterns = Array.from(patternSet).slice(0, 5);

  // 合并修辞偏好
  const rhetoricSet = new Set([...(existing.rhetoric || []), ...incoming.rhetoric]);
  merged.rhetoric = Array.from(rhetoricSet).slice(0, 5);

  return merged;
}

function mergeToneMarkers(oldTM, newTM, wOld, wNew) {
  if (!oldTM) return newTM;
  if (!newTM) return oldTM;
  return {
    exclamationRatio: round(oldTM.exclamationRatio * wOld + newTM.exclamationRatio * wNew),
    questionRatio: round(oldTM.questionRatio * wOld + newTM.questionRatio * wNew),
    ellipsisRatio: round(oldTM.ellipsisRatio * wOld + newTM.ellipsisRatio * wNew),
  };
}

// ============ 文本提取 ============

function extractDialogues(text) {
  const dialogues = [];
  // 支持多种中文对话格式
  const patterns = [
    /([^""\n]{1,10})[说喊道叫嚷吼骂叱][道着]*[""""""]([^""""""]+)[""""""]/g,
    /([^""\n]{1,10})[说喊道叫嚷吼骂叱][道着]*[「『]([^」』]+)[」』]/g,
    /[「『]([^」』]+)[」』]([^""\n]{1,10})[说喊道]/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      let speaker, content;
      if (match[2] && match[2].length > match[1].length) {
        speaker = match[1].trim();
        content = match[2];
      } else {
        speaker = match[2]?.trim() || '未知';
        content = match[1];
      }
      dialogues.push({ speaker, text: content });
    }
  }

  return dialogues;
}

function detectSentencePatterns(sentences) {
  const patterns = [];
  const samples = sentences.slice(0, 20);

  const imperative = samples.filter((s) => /^[快立刻马上必须给我]/.test(s)).length;
  const rhetorical = samples.filter((s) => /[难道岂怎何尝]$/.test(s)).length;
  const exclamatory = samples.filter((s) => /[啊啊呢吧嘛]$/.test(s)).length;
  const declarative = samples.filter((s) => /[了着过]$/.test(s)).length;

  if (imperative >= 2) patterns.push('命令式');
  if (rhetorical >= 2) patterns.push('反问式');
  if (exclamatory >= 3) patterns.push('感叹式');
  if (declarative >= 5) patterns.push('陈述式');

  return patterns;
}

function extractTopPhrases(text, topN) {
  // 提取 2-4 字短语
  const phraseCount = {};
  for (let len = 2; len <= 4; len++) {
    for (let i = 0; i <= text.length - len; i++) {
      const phrase = text.slice(i, i + len);
      if (!/[\u4e00-\u9fa5]/.test(phrase)) continue;
      // 过滤常见虚词开头/结尾
      if (/^[的了着过在是都也而但]$/.test(phrase[0])) continue;
      if (/^[的了着过在是都也而但]$/.test(phrase[phrase.length - 1])) continue;
      phraseCount[phrase] = (phraseCount[phrase] || 0) + 1;
    }
  }

  return Object.entries(phraseCount)
    .filter(([_, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([phrase, count]) => ({ phrase, count }));
}

// ============ 工具 ============

function round(n) {
  return Math.round(n * 1000) / 1000;
}

function translateStyle(style) {
  const map = {
    direct: '直率果断',
    indirect: '委婉含蓄',
    humor: '幽默风趣',
    cold: '冷峻淡漠',
    neutral: '平实自然',
  };
  return map[style] || style;
}

module.exports = {
  extractFromChapter,
  updateCharacterVoice,
  getVoiceFingerprintPrompt,
  buildVoiceFingerprintProjection,
};
