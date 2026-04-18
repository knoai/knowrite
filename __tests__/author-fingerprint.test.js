/**
 * author-fingerprint 测试
 */
const service = require('../src/services/author-fingerprint');
const { AuthorFingerprint, WorkStyleLink } = require('../src/models');

describe('author-fingerprint', () => {
  beforeEach(async () => {
    const { initDb, sequelize } = require('../src/models');
    await initDb();
    for (const t of ['author_fingerprints', 'work_style_links']) {
      await sequelize.query(`DELETE FROM ${t}`);
    }
  });

  // ==================== 数据库操作 ====================

  describe('analyzeFullFingerprint', () => {
    it('should analyze and persist a full fingerprint', async () => {
      const text = '第一章\n这是修仙故事。修炼功法，吸收灵气。\n\n'
        + '第二章\n与此同时，主角开始了新的冒险。战斗！厮杀！\n'
        + '他说道："我要变强！"\n'
        + '她回答道："我们一起努力。"\n'
        + '究竟结局会如何？';

      const fp = await service.analyzeFullFingerprint(text, 'Test Author', 'A test fingerprint');

      expect(fp.id).toBeDefined();
      expect(fp.name).toBe('Test Author');
      expect(fp.description).toBe('A test fingerprint');
      expect(fp.narrativeLayer).toBeDefined();
      expect(fp.characterLayer).toBeDefined();
      expect(fp.plotLayer).toBeDefined();
      expect(fp.languageLayer).toBeDefined();
      expect(fp.worldLayer).toBeDefined();
      expect(Array.isArray(fp.sampleParagraphs)).toBe(true);
    });

    it('should handle plain text without chapter markers', async () => {
      const text = '这是一个普通的故事段落。没有章节标记。'
        + '回忆往事， linear narrative。';

      const fp = await service.analyzeFullFingerprint(text, 'Plain');
      expect(fp.narrativeLayer).toBeDefined();
      expect(fp.plotLayer.avgChapterLength).toBeGreaterThan(0);
    });
  });

  describe('importStyle / getActiveFingerprints', () => {
    it('should create a new link on first import', async () => {
      const fp = await AuthorFingerprint.create({
        name: 'Style A',
        narrativeLayer: { povPreference: 'third_limited' },
      });

      const link = await service.importStyle(fp.id, 'work-1', 2);
      expect(link.isActive).toBe(true);

      const active = await service.getActiveFingerprints('work-1');
      expect(active).toHaveLength(1);
      expect(active[0].name).toBe('Style A');
    });

    it('should update existing link on re-import', async () => {
      const fp = await AuthorFingerprint.create({ name: 'Style B' });
      await service.importStyle(fp.id, 'work-2', 1);

      const link = await service.importStyle(fp.id, 'work-2', 3);
      expect(link.priority).toBe(3);

      const active = await service.getActiveFingerprints('work-2');
      expect(active).toHaveLength(1);
    });

    it('should return empty array when no active fingerprints', async () => {
      const active = await service.getActiveFingerprints('no-such-work');
      expect(active).toEqual([]);
    });
  });

  describe('renderFingerprintPrompt', () => {
    it('should return empty string when no fingerprints', async () => {
      const prompt = await service.renderFingerprintPrompt('empty-work');
      expect(prompt).toBe('');
    });

    it('should render fingerprint prompt with all layers', async () => {
      const fp = await AuthorFingerprint.create({
        name: 'Full Style',
        narrativeLayer: {
          povPreference: 'first_person',
          sceneTransitionStyle: 'hard_cut',
          timeHandling: 'linear',
          chapterOpeningStyle: 'in_media_res',
          chapterEndingStyle: 'cliffhanger',
        },
        characterLayer: {
          dialogueFingerprints: {
            主角: { speechStyle: 'direct', avgSentenceLength: 12, topWords: [{ word: '我', count: 10 }] },
          },
        },
        plotLayer: {
          avgChapterLength: 3000,
          conflictTypes: ['physical', 'interpersonal'],
          chapterStructure: { avgScenes: 3 },
        },
        languageLayer: {
          avgSentenceLength: 25.5,
          dialogueRatio: 0.3,
        },
      });
      await service.importStyle(fp.id, 'work-render', 1);

      const prompt = await service.renderFingerprintPrompt('work-render');

      expect(prompt).toContain('作者全维度指纹');
      expect(prompt).toContain('第一人称');
      expect(prompt).toContain('硬切');
      expect(prompt).toContain('角色声音');
      expect(prompt).toContain('主角');
      expect(prompt).toContain('肢体冲突');
      expect(prompt).toContain('平均句长');
      expect(prompt).toContain('写作时请严格遵循以上指纹特征');
    });
  });

  describe('validateAgainstFingerprint', () => {
    it('should return null for missing fingerprint', async () => {
      const result = await service.validateAgainstFingerprint('w', 'text', 999);
      expect(result).toBeNull();
    });

    it('should pass when chapter matches fingerprint', async () => {
      const text = '这是一个测试。句子长度适中。没有对话。'.repeat(50);
      const stats = service.analyzeLanguageLayer(text);

      const fp = await AuthorFingerprint.create({
        name: 'Match',
        languageLayer: {
          avgSentenceLength: stats.avgSentenceLength,
          dialogueRatio: stats.dialogueRatio,
        },
        plotLayer: { avgChapterLength: text.length },
      });

      const result = await service.validateAgainstFingerprint('w', text, fp.id);

      expect(result.passed).toBe(true);
      expect(result.deviationCount).toBe(0);
    });

    it('should detect deviations when chapter differs significantly', async () => {
      const fp = await AuthorFingerprint.create({
        name: 'Mismatch',
        languageLayer: { avgSentenceLength: 100, dialogueRatio: 0.8 },
        plotLayer: { avgChapterLength: 10000 },
      });

      const text = '短。'.repeat(10); // very short sentences, no dialogue, short chapter
      const result = await service.validateAgainstFingerprint('w', text, fp.id);

      expect(result.passed).toBe(false);
      expect(result.deviationCount).toBeGreaterThan(0);
      expect(result.overallScore).toBeLessThan(1);
      expect(result.deviations.length).toBeGreaterThan(0);
    });
  });

  // ==================== 纯文本分析（无需 DB）====================

  describe('splitIntoChapters', () => {
    it('should split by Chinese chapter markers', () => {
      const text = '第一章 开篇\ncontent1\n第二章 发展\ncontent2';
      const chapters = service.splitIntoChapters(text);
      expect(chapters.length).toBeGreaterThanOrEqual(1);
    });

    it('should return whole text when no markers', () => {
      const text = 'just plain text';
      const chapters = service.splitIntoChapters(text);
      expect(chapters).toEqual([text]);
    });
  });

  describe('analyzeNarrativeLayer', () => {
    it('should detect first person POV', () => {
      const chapters = ['我走进了房间。我们一起去吧。'];
      const layer = service.analyzeNarrativeLayer(chapters);
      expect(layer.povPreference).toBe('first_person');
    });

    it('should detect third limited POV with enough markers', () => {
      const chapters = ['他他他他他他他他他他她她她她她她她她她她。'];
      const layer = service.analyzeNarrativeLayer(chapters);
      expect(layer.povPreference).toBe('third_limited');
    });

    it('should detect flashback time handling', () => {
      const chapters = ['回忆往事。想起小时候。'];
      const layer = service.analyzeNarrativeLayer(chapters);
      expect(layer.timeHandling).toBe('flashback');
    });

    it('should detect cliffhanger ending', () => {
      const chapters = ['到底发生了什么？竟然是这样！'];
      const layer = service.analyzeNarrativeLayer(chapters);
      expect(layer.chapterEndingStyle).toBe('cliffhanger');
    });
  });

  describe('analyzeCharacterLayer', () => {
    it('should extract dialogue fingerprints', () => {
      // Pattern requires: speaker + [说喊道叫嚷] + [道着]* + "dialogue"
      // No colon allowed between 道 and opening quote
      const chapters = [
        '主角说"我要变强！"主角喊"立刻行动！"主角叫"必须成功！"',
      ];
      const layer = service.analyzeCharacterLayer(chapters);
      expect(Object.keys(layer.dialogueFingerprints)).toContain('主角');
      const dfp = layer.dialogueFingerprints['主角'];
      expect(dfp.speechStyle).toBe('direct');
      expect(dfp.dialogueCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('analyzePlotLayer', () => {
    it('should detect physical conflict', () => {
      const chapters = ['战斗开始了。对决！厮杀！'];
      const layer = service.analyzePlotLayer(chapters);
      expect(layer.conflictTypes).toContain('physical');
    });

    it('should default to interpersonal when no conflicts', () => {
      const chapters = ['平静的日常生活。'];
      const layer = service.analyzePlotLayer(chapters);
      expect(layer.conflictTypes).toContain('interpersonal');
    });
  });

  describe('analyzeLanguageLayer', () => {
    it('should compute sentence length and dialogue ratio', () => {
      const text = '他说："你好。"她说："再见。"然后他们都离开了。';
      const layer = service.analyzeLanguageLayer(text);
      expect(layer.avgSentenceLength).toBeGreaterThan(0);
      expect(layer.dialogueRatio).toBeGreaterThan(0);
      expect(layer.punctuationRatio).toBeGreaterThan(0);
      expect(Array.isArray(layer.topWords)).toBe(true);
    });
  });

  describe('analyzeWorldLayer', () => {
    it('should detect xianxia setting', () => {
      expect(service.analyzeWorldLayer('修仙之路，功法传承')).toEqual({ settingType: 'xianxia' });
    });

    it('should detect xuanhuan setting', () => {
      expect(service.analyzeWorldLayer('魔法学院，斗气修炼')).toEqual({ settingType: 'xuanhuan' });
    });

    it('should detect urban setting', () => {
      expect(service.analyzeWorldLayer('都市生活，总裁办公室')).toEqual({ settingType: 'urban' });
    });

    it('should default to general', () => {
      expect(service.analyzeWorldLayer('random text')).toEqual({ settingType: 'general' });
    });
  });

  describe('extractDialogues', () => {
    it('should extract speaker and dialogue text', () => {
      // Pattern: speaker[说喊道叫嚷][道着]*"dialogue"
      const text = '小明说"今天天气真好。"小红叫"是啊！"';
      const dialogues = service.extractDialogues(text);
      expect(dialogues.length).toBeGreaterThanOrEqual(1);
      expect(dialogues[0].speaker).toBe('小明');
      expect(dialogues[0].text).toBe('今天天气真好。');
    });
  });

  describe('detectScenes', () => {
    it('should split text by transition markers', () => {
      const longScene = '场景A开始。' + '这里有很长的描述内容。'.repeat(20);
      const text = longScene + '与此同时' + '场景B也很长。'.repeat(20);
      const scenes = service.detectScenes(text);
      expect(scenes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('buildDistribution', () => {
    it('should build histogram with bins', () => {
      const values = [5, 15, 25, 35, 55, 85];
      const dist = service.buildDistribution(values, [0, 10, 30, 60, 100]);
      expect(dist).toHaveLength(5);
      expect(dist[0].range).toBe('0-9');
      expect(dist[1].range).toBe('10-29');
      expect(dist[4].range).toBe('100+');
    });
  });

  describe('translation helpers', () => {
    it('should translate POV values', () => {
      expect(service.translatePov('first_person')).toBe('第一人称');
      expect(service.translatePov('third_limited')).toBe('第三人称有限');
      expect(service.translatePov('unknown')).toBe('unknown');
    });

    it('should translate conflict types', () => {
      expect(service.translateConflictType('physical')).toBe('肢体冲突');
      expect(service.translateConflictType('internal')).toBe('内心冲突');
    });

    it('should translate transition styles', () => {
      expect(service.translateTransition('hard_cut')).toBe('硬切');
      expect(service.translateTransition('transition_sentence')).toBe('过渡句');
    });
  });
});
