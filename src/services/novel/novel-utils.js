/**
 * Novel Utils — 纯工具函数
 *
 * 从 novel-engine.js 提取，避免循环依赖。
 */

const { getAuthorStyle, getPlatformStyle, getChapterConfig, getWritingMode } = require('../settings-store');
const { loadPromptRaw } = require('../prompt-loader');

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
      await loadPromptRaw(freeName);
      return freeName;
    } catch {
      // 自由风模板不存在，回退到工业风
      return baseName;
    }
  }
  return baseName;
}

module.exports = {
  expandAuthorStyle,
  expandPlatformStyle,
  expandStyle,
  getChapterWordVariables,
  resolvePromptName,
};
