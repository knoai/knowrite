/**
 * 全维度作者指纹服务
 *
 * 核心职责：
 * 1. analyzeFullFingerprint(text, name) — 全维度分析
 * 2. getCharacterDialogueFingerprint(workId, charName) — 提取角色对话指纹
 * 3. validateAgainstFingerprint(workId, chapterText, fingerprintId) — 验证偏差
 * 4. renderFullFingerprintPrompt(workId) — 生成完整注入文本
 */

const { AuthorFingerprint, WorkStyleLink } = require('../models');

class AuthorFingerprintService {

  /**
   * 全维度分析
   */
  async analyzeFullFingerprint(text, name, description = '') {
    const chapters = this.splitIntoChapters(text);
    const narrativeLayer = this.analyzeNarrativeLayer(chapters);
    const characterLayer = this.analyzeCharacterLayer(chapters);
    const plotLayer = this.analyzePlotLayer(chapters);
    const languageLayer = this.analyzeLanguageLayer(text);
    const worldLayer = this.analyzeWorldLayer(text);

    const fingerprint = await AuthorFingerprint.create({
      name,
      description,
      narrativeLayer,
      characterLayer,
      plotLayer,
      languageLayer,
      worldLayer,
      sampleParagraphs: chapters.slice(0, 3).map((c) => c.substring(0, 500)),
    });

    return fingerprint;
  }

  /**
   * 将指纹注入作品
   */
  async importStyle(fingerprintId, workId, priority = 1) {
    const [link, created] = await WorkStyleLink.findOrCreate({
      where: { workId, fingerprintId },
      defaults: { isActive: true, priority },
    });

    if (!created) {
      await link.update({ isActive: true, priority });
    }

    return link;
  }

  /**
   * 获取作品启用的指纹
   */
  async getActiveFingerprints(workId) {
    const links = await WorkStyleLink.findAll({
      where: { workId, isActive: true },
      order: [['priority', 'ASC']],
    });

    const fingerprints = [];
    for (const link of links) {
      const fp = await AuthorFingerprint.findByPk(link.fingerprintId);
      if (fp) fingerprints.push(fp);
    }
    return fingerprints;
  }

  /**
   * 渲染指纹 prompt 文本（注入 Writer）
   */
  async renderFingerprintPrompt(workId) {
    const fingerprints = await this.getActiveFingerprints(workId);
    if (!fingerprints.length) return '';

    const parts = ['## 作者全维度指纹', ''];

    for (const fp of fingerprints) {
      if (fp.narrativeLayer) {
        const nl = fp.narrativeLayer;
        parts.push('### 叙事风格');
        parts.push(`- 视角: ${this.translatePov(nl.povPreference)}`);
        parts.push(`- 场景切换: ${this.translateTransition(nl.sceneTransitionStyle)}`);
        parts.push(`- 时间处理: ${this.translateTimeHandling(nl.timeHandling)}`);
        parts.push(`- 章节开头: ${this.translateOpening(nl.chapterOpeningStyle)}`);
        parts.push(`- 章节结尾: ${this.translateEnding(nl.chapterEndingStyle)}`);
        parts.push('');
      }

      if (fp.characterLayer?.dialogueFingerprints) {
        parts.push('### 角色声音');
        for (const [name, dfp] of Object.entries(fp.characterLayer.dialogueFingerprints)) {
          parts.push(`**${name}**：${dfp.speechStyle === 'direct' ? '直率果断' : '委婉含蓄'}，平均句长 ${dfp.avgSentenceLength} 字`);
          if (dfp.topWords?.length) {
            parts.push(`  高频词: ${dfp.topWords.map((w) => w.word).join('、')}`);
          }
        }
        parts.push('');
      }

      if (fp.plotLayer) {
        const pl = fp.plotLayer;
        parts.push('### 情节模式');
        parts.push(`- 平均章长: ${pl.avgChapterLength} 字`);
        parts.push(`- 冲突类型: ${(pl.conflictTypes || []).map(this.translateConflictType).join('、')}`);
        parts.push(`- 平均场景数: ${pl.chapterStructure?.avgScenes}`);
        parts.push('');
      }

      if (fp.languageLayer) {
        const ll = fp.languageLayer;
        parts.push('### 语言风格');
        parts.push(`- 平均句长: ${ll.avgSentenceLength?.toFixed(1)} 字`);
        parts.push(`- 对话占比: ${((ll.dialogueRatio || 0) * 100).toFixed(1)}%`);
        parts.push('');
      }
    }

    parts.push('> 写作时请严格遵循以上指纹特征。');
    return parts.join('\n');
  }

  /**
   * 验证章节是否符合指纹
   */
  async validateAgainstFingerprint(workId, chapterText, fingerprintId) {
    const fingerprint = await AuthorFingerprint.findByPk(fingerprintId);
    if (!fingerprint) return null;

    const deviations = [];

    if (fingerprint.languageLayer) {
      const currentStats = this.analyzeLanguageLayer(chapterText);
      const target = fingerprint.languageLayer;

      if (target.avgSentenceLength && currentStats.avgSentenceLength) {
        const dev = Math.abs(target.avgSentenceLength - currentStats.avgSentenceLength) / target.avgSentenceLength;
        if (dev > 0.3) deviations.push({ layer: 'language', aspect: 'sentence_length', deviation: dev });
      }

      if (target.dialogueRatio && currentStats.dialogueRatio) {
        const dev = Math.abs(target.dialogueRatio - currentStats.dialogueRatio);
        if (dev > 0.15) deviations.push({ layer: 'language', aspect: 'dialogue_ratio', deviation: dev });
      }
    }

    if (fingerprint.plotLayer) {
      const chapterLength = chapterText.length;
      const targetLength = fingerprint.plotLayer.avgChapterLength;
      if (targetLength && Math.abs(chapterLength - targetLength) / targetLength > 0.3) {
        deviations.push({ layer: 'plot', aspect: 'chapter_length', deviation: Math.abs(chapterLength - targetLength) / targetLength });
      }
    }

    return {
      passed: deviations.length === 0,
      deviationCount: deviations.length,
      deviations: deviations.slice(0, 5),
      overallScore: Math.max(0, 1 - deviations.reduce((s, d) => s + d.deviation, 0) / Math.max(1, deviations.length * 2)),
    };
  }

  // ==================== 各层分析 ====================

  splitIntoChapters(text) {
    const pattern = /第[一二三四五六七八九十百千\d]+章[^\n]*\n/;
    const parts = text.split(pattern).filter(Boolean);
    return parts.length > 1 ? parts : [text];
  }

  analyzeNarrativeLayer(chapters) {
    const povMarkers = {
      first_person: ['我', '我们'],
      third_limited: ['他', '她'],
      third_omniscient: ['与此同时', '没有人知道'],
    };

    let povCounts = { first_person: 0, third_limited: 0, third_omniscient: 0 };
    let povSwitches = 0;
    let lastPov = null;

    for (const chapter of chapters) {
      for (const [pov, markers] of Object.entries(povMarkers)) {
        const count = markers.reduce((sum, m) => sum + (chapter.split(m).length - 1), 0);
        if (count > 5) {
          povCounts[pov]++;
          if (lastPov && lastPov !== pov) povSwitches++;
          lastPov = pov;
          break;
        }
      }
    }

    const dominantPov = Object.entries(povCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'third_limited';

    return {
      povPreference: dominantPov,
      povSwitchFrequency: povSwitches / chapters.length,
      sceneTransitionStyle: this.detectTransitionStyle(chapters),
      timeHandling: this.detectTimeHandling(chapters),
      chapterOpeningStyle: this.detectOpeningStyle(chapters),
      chapterEndingStyle: this.detectEndingStyle(chapters),
    };
  }

  analyzeCharacterLayer(chapters) {
    const dialogueFingerprints = {};

    for (const chapter of chapters) {
      const dialogues = this.extractDialogues(chapter);
      for (const { speaker, text } of dialogues) {
        if (!dialogueFingerprints[speaker]) {
          dialogueFingerprints[speaker] = { texts: [], totalLength: 0 };
        }
        dialogueFingerprints[speaker].texts.push(text);
        dialogueFingerprints[speaker].totalLength += text.length;
      }
    }

    const processed = {};
    for (const [speaker, data] of Object.entries(dialogueFingerprints)) {
      if (data.texts.length < 3) continue;

      const allText = data.texts.join('');
      const sentences = allText.split(/[。！？.!?]+/).filter((s) => s.trim());
      const avgLength = sentences.reduce((sum, s) => sum + s.length, 0) / sentences.length;

      const words = {};
      for (const char of allText) {
        if (/[\u4e00-\u9fa5]/.test(char)) words[char] = (words[char] || 0) + 1;
      }
      const topWords = Object.entries(words)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([w, c]) => ({ word: w, count: c }));

      const directMarkers = ['!', '！', '快', '立刻', '必须'];
      const indirectMarkers = ['或许', '可能', '也许', '如果'];
      const directScore = directMarkers.reduce((sum, m) => sum + (allText.includes(m) ? 1 : 0), 0);
      const indirectScore = indirectMarkers.reduce((sum, m) => sum + (allText.includes(m) ? 1 : 0), 0);
      const speechStyle = directScore > indirectScore ? 'direct' : 'indirect';

      processed[speaker] = {
        avgSentenceLength: Math.round(avgLength * 10) / 10,
        topWords: topWords.slice(0, 5),
        speechStyle,
        dialogueCount: data.texts.length,
        totalLength: data.totalLength,
      };
    }

    return {
      namingStyle: this.detectNamingStyle(chapters),
      entrancePattern: 'gradual',
      dialogueFingerprints: processed,
      relationshipDensity: 0.5,
    };
  }

  analyzePlotLayer(chapters) {
    const chapterStructures = chapters.map((ch) => ({
      paragraphs: ch.split(/\n\n+/).length,
      scenes: this.detectScenes(ch).length,
      length: ch.length,
    }));

    const avgParagraphs = chapterStructures.reduce((s, c) => s + c.paragraphs, 0) / chapters.length;
    const avgScenes = chapterStructures.reduce((s, c) => s + c.scenes, 0) / chapters.length;
    const avgLength = chapterStructures.reduce((s, c) => s + c.length, 0) / chapters.length;

    const text = chapters.join('');
    const conflictTypes = [];
    if (/战斗|对决|冲突|厮杀/.test(text)) conflictTypes.push('physical');
    if (/争吵|对峙|谈判|博弈/.test(text)) conflictTypes.push('interpersonal');
    if (/挣扎|犹豫|痛苦|迷茫/.test(text)) conflictTypes.push('internal');
    if (/灾难|危机|危险|追杀/.test(text)) conflictTypes.push('environmental');

    return {
      chapterStructure: {
        avgParagraphs: Math.round(avgParagraphs),
        avgScenes: Math.round(avgScenes * 10) / 10,
        sceneDistribution: [0.3, 0.5, 0.2],
      },
      conflictTypes: conflictTypes.length ? conflictTypes : ['interpersonal'],
      turningPointDistribution: [0.2, 0.5, 0.3],
      hookDensity: 2.0,
      avgChapterLength: Math.round(avgLength),
    };
  }

  analyzeLanguageLayer(text) {
    const sentences = text.split(/[。！？.!?]+/).filter((s) => s.trim());
    const lengths = sentences.map((s) => s.length);
    const avgLength = lengths.reduce((s, l) => s + l, 0) / sentences.length;

    const dialogueMatches = text.match(/[""。"""「」『』]/g) || [];
    const dialogueRatio = dialogueMatches.length * 2 / text.length;

    const chars = text.split('');
    const charCount = {};
    for (const c of chars) {
      if (/[\u4e00-\u9fa5]/.test(c)) charCount[c] = (charCount[c] || 0) + 1;
    }
    const topWords = Object.entries(charCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([char, count]) => ({ char, count }));

    const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0);
    const paraLengths = paragraphs.map((p) => p.trim().length);

    return {
      avgSentenceLength: avgLength,
      sentenceLengthDistribution: this.buildDistribution(lengths, [0, 10, 30, 60, 100]),
      topWords,
      punctuationRatio: (text.match(/[，。！？、；：""''（）【】「」『』]/g) || []).length / text.length,
      paragraphAvgLength: paraLengths.length ? paraLengths.reduce((a, b) => a + b, 0) / paraLengths.length : 0,
      dialogueRatio: Math.min(1, dialogueRatio),
    };
  }

  analyzeWorldLayer(text) {
    if (/修仙|修真|功法|灵气/.test(text)) return { settingType: 'xianxia' };
    if (/魔法|斗气|魔兽|法师/.test(text)) return { settingType: 'xuanhuan' };
    if (/都市|公司|总裁|校园/.test(text)) return { settingType: 'urban' };
    return { settingType: 'general' };
  }

  // ==================== 辅助方法 ====================

  extractDialogues(text) {
    const dialogues = [];
    const pattern = /([^""\n]{1,10})[说喊道叫嚷][道着]*[""""]([^""""]+)[""""]/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      dialogues.push({ speaker: match[1].trim(), text: match[2] });
    }
    return dialogues;
  }

  detectScenes(text) {
    const transitions = ['与此同时', '另一边', '不久之后', '几天后', '数日后'];
    const scenes = [text];
    for (const t of transitions) {
      const newScenes = [];
      for (const scene of scenes) {
        const parts = scene.split(t);
        newScenes.push(...parts);
      }
      scenes.length = 0;
      scenes.push(...newScenes);
    }
    return scenes.filter((s) => s.length > 100);
  }

  detectTransitionStyle(chapters) {
    const hardCuts = chapters.filter((c) => /\n\n+/.test(c)).length;
    return hardCuts > chapters.length * 0.7 ? 'hard_cut' : 'transition_sentence';
  }

  detectTimeHandling(chapters) {
    const flashbacks = chapters.filter((c) => /回忆|想起|往事/.test(c)).length;
    return flashbacks > chapters.length * 0.3 ? 'flashback' : 'linear';
  }

  detectOpeningStyle(chapters) {
    const inMediaRes = chapters.filter((c) => /^[""。"""」』]/.test(c.trim())).length;
    return inMediaRes > chapters.length * 0.3 ? 'in_media_res' : 'slow_build';
  }

  detectEndingStyle(chapters) {
    const cliffhangers = chapters.filter((c) => /究竟|到底|竟然|谁知/.test(c.slice(-200))).length;
    return cliffhangers > chapters.length * 0.3 ? 'cliffhanger' : 'resolution';
  }

  detectNamingStyle(chapters) {
    const names = [];
    const pattern = /[\u4e00-\u9fa5]{2,3}/g;
    for (const chapter of chapters) {
      const matches = chapter.match(pattern) || [];
      names.push(...matches);
    }
    const twoChar = names.filter((n) => n.length === 2).length;
    return twoChar > names.length * 0.6 ? 'two_char' : 'three_char';
  }

  buildDistribution(values, bins) {
    const distribution = [];
    for (let i = 0; i < bins.length; i++) {
      const min = bins[i];
      const max = bins[i + 1] || Infinity;
      const count = values.filter((v) => v >= min && v < max).length;
      const label = max === Infinity ? `${min}+` : `${min}-${max - 1}`;
      distribution.push({ range: label, count });
    }
    return distribution;
  }

  // 翻译方法
  translatePov(pov) {
    const map = { first_person: '第一人称', third_limited: '第三人称有限', third_omniscient: '第三人称全知' };
    return map[pov] || pov;
  }
  translateTransition(t) {
    const map = { hard_cut: '硬切', transition_sentence: '过渡句' };
    return map[t] || t;
  }
  translateTimeHandling(t) {
    const map = { linear: '线性叙事', flashback: '频繁插叙' };
    return map[t] || t;
  }
  translateOpening(o) {
    const map = { in_media_res: '开门见山', slow_build: '渐入佳境' };
    return map[o] || o;
  }
  translateEnding(e) {
    const map = { cliffhanger: '悬念收尾', resolution: '圆满收尾' };
    return map[e] || e;
  }
  translateConflictType(c) {
    const map = { physical: '肢体冲突', interpersonal: '人际冲突', internal: '内心冲突', environmental: '环境危机' };
    return map[c] || c;
  }
}

module.exports = new AuthorFingerprintService();
