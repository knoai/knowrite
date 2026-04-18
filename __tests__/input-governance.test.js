/**
 * input-governance 测试
 */
const {
  planChapter,
  composeChapter,
  getGovernanceVariables,
  compileRuleStack,
  renderRuleStack,
} = require('../src/services/input-governance');
const {
  AuthorIntent, CurrentFocus, ChapterIntent, Work,
} = require('../src/models');

jest.mock('../src/services/truth-manager', () => ({
  selectFragmentsForChapter: jest.fn().mockResolvedValue(['fragment1', 'fragment2']),
}));

jest.mock('../src/services/world-context', () => ({
  buildWorldContext: jest.fn().mockResolvedValue('世界背景...'),
}));

describe('input-governance', () => {
  const workId = 'gov-test-1';

  beforeEach(async () => {
    const { initDb, sequelize } = require('../src/models');
    await initDb();
    // Clean tables to avoid unique constraint conflicts
    const tables = [
      'author_intents', 'current_focuses', 'chapter_intents', 'works',
    ];
    for (const t of tables) {
      await sequelize.query(`DELETE FROM ${t}`);
    }
  });

  describe('planChapter', () => {
    it('should create ChapterIntent from AuthorIntent and CurrentFocus', async () => {
      await Work.create({
        workId,
        topic: 'Test',
        outlineDetailed: 'Volume outline here',
      });
      await AuthorIntent.create({
        workId,
        longTermVision: 'Build a great story',
        themes: ['theme1', 'theme2'],
        constraints: ['no magic'],
      });
      await CurrentFocus.create({
        workId,
        focusText: 'Focus on character growth',
        targetChapters: 5,
        isActive: true,
      });

      const intent = await planChapter(workId, 3);

      expect(intent.workId).toBe(workId);
      expect(intent.chapterNumber).toBe(3);
      expect(intent.mustKeep).toContain('theme1');
      expect(intent.mustKeep).toContain('Focus on character growth');
      expect(intent.mustKeep).toContain('第3章');
      expect(intent.mustAvoid).toContain('no magic');
      expect(intent.ruleStack).toHaveLength(4);
      expect(intent.ruleStack[0].source).toBe('author_intent');
      expect(intent.ruleStack[3].source).toBe('default');
      expect(intent.plannedAt).toBeInstanceOf(Date);

      // persisted
      const found = await ChapterIntent.findOne({ where: { workId, chapterNumber: 3 } });
      expect(found).toBeTruthy();
      expect(found.mustKeep).toContain('theme1');
    });

    it('should handle missing AuthorIntent gracefully', async () => {
      await Work.create({ workId: 'gov-empty', topic: 'Test' });

      const intent = await planChapter('gov-empty', 1);

      expect(intent.mustKeep).toContain('第1章');
      expect(intent.mustAvoid).toBe('');
      expect(intent.ruleStack).toHaveLength(2); // outline + default
    });
  });

  describe('composeChapter', () => {
    it('should throw if ChapterIntent not found', async () => {
      await expect(composeChapter('missing', 1)).rejects.toThrow('ChapterIntent not found');
    });

    it('should compose context from intent, truth, and world', async () => {
      await Work.create({ workId, topic: 'Test' });
      await ChapterIntent.create({
        workId,
        chapterNumber: 2,
        mustKeep: 'keep this',
        mustAvoid: 'avoid that',
        ruleStack: [{ level: 1, source: 'test', rules: ['rule1'] }],
      });

      const composed = await composeChapter(workId, 2);

      expect(composed.intent.workId).toBe(workId);
      expect(composed.truthFragments).toEqual(['fragment1', 'fragment2']);
      expect(composed.worldContext).toBe('世界背景...');
      expect(composed.ruleStackText).toContain('L1');
      expect(composed.ruleStackText).toContain('rule1');
      expect(composed.composedAt).toBeInstanceOf(Date);

      // updated intent
      const found = await ChapterIntent.findOne({ where: { workId, chapterNumber: 2 } });
      expect(found.composedAt).toBeInstanceOf(Date);
    });
  });

  describe('getGovernanceVariables', () => {
    it('should return all governance variables when data exists', async () => {
      await AuthorIntent.create({
        workId,
        longTermVision: 'Vision text',
        themes: ['t1', 't2'],
        constraints: ['c1'],
        mustKeep: 'keep',
        mustAvoid: 'avoid',
      });
      await CurrentFocus.create({
        workId,
        focusText: 'Current focus',
        targetChapters: 10,
        isActive: true,
      });
      await ChapterIntent.create({
        workId,
        chapterNumber: 5,
        mustKeep: 'chapter keep',
        mustAvoid: 'chapter avoid',
        sceneBeats: ['beat1'],
        conflictResolution: 'resolved',
        emotionalGoal: 'happy',
        ruleStack: [{ level: 1, source: 'x', rules: ['r'] }],
      });

      const vars = await getGovernanceVariables(workId, 5);

      expect(vars.governanceEnabled).toBe(true);
      expect(vars.authorLongTermVision).toBe('Vision text');
      expect(vars.authorThemes).toBe('t1、t2');
      expect(vars.authorConstraints).toBe('c1');
      expect(vars.authorMustKeep).toBe('keep');
      expect(vars.authorMustAvoid).toBe('avoid');
      expect(vars.focusText).toBe('Current focus');
      expect(vars.targetChapters).toBe(10);
      expect(vars.chapterMustKeep).toBe('chapter keep');
      expect(vars.chapterMustAvoid).toBe('chapter avoid');
      expect(vars.sceneBeats).toEqual(['beat1']);
      expect(vars.conflictResolution).toBe('resolved');
      expect(vars.emotionalGoal).toBe('happy');
      expect(vars.ruleStackText).toContain('L1');
    });

    it('should return minimal result when no ChapterIntent', async () => {
      const vars = await getGovernanceVariables('missing', 1);
      expect(vars.governanceEnabled).toBe(false);
      expect(vars.authorLongTermVision).toBeUndefined();
    });
  });

  describe('compileRuleStack', () => {
    it('should build complete rule stack with all levels', () => {
      const stack = compileRuleStack(
        { constraints: ['c1', 'c2'], mustKeep: 'keep', mustAvoid: 'avoid' },
        [{ focusText: 'focus1' }],
        'outline text here'
      );

      expect(stack).toHaveLength(4);
      expect(stack[0]).toEqual({
        level: 1,
        source: 'author_intent',
        rules: ['c1', 'c2', 'keep', 'avoid'],
      });
      expect(stack[1]).toEqual({
        level: 2,
        source: 'current_focus',
        rules: ['focus1'],
      });
      expect(stack[2]).toEqual({
        level: 3,
        source: 'outline',
        rules: ['outline text here'],
      });
      expect(stack[3].level).toBe(4);
      expect(stack[3].source).toBe('default');
      expect(stack[3].rules).toContain('遵循平台风格');
    });

    it('should create multiple focus entries when multiple focuses given', () => {
      const stack = compileRuleStack(
        null,
        [{ focusText: 'a' }, { focusText: 'b' }],
        'outline'
      );
      expect(stack).toHaveLength(4); // 2 focuses + outline + default
      expect(stack[0].level).toBe(2);
      expect(stack[1].level).toBe(2);
    });

    it('should handle null authorIntent', () => {
      const stack = compileRuleStack(null, [], '');
      expect(stack).toHaveLength(2);
      expect(stack[0].level).toBe(3);
    });

    it('should filter out empty outline', () => {
      const stack = compileRuleStack(null, [], '');
      expect(stack[0].rules).toEqual([]);
    });
  });

  describe('renderRuleStack', () => {
    it('should render formatted rule stack', () => {
      const text = renderRuleStack([
        { level: 1, source: 'author', rules: ['rule1', 'rule2'] },
        { level: 2, source: 'outline', rules: ['outline rule'] },
      ]);

      expect(text).toContain('【优先级 L1 | author】');
      expect(text).toContain('  - rule1');
      expect(text).toContain('  - rule2');
      expect(text).toContain('【优先级 L2 | outline】');
      expect(text).toContain('  - outline rule');
    });

    it('should return empty string for empty stack', () => {
      expect(renderRuleStack([])).toBe('');
      expect(renderRuleStack(null)).toBe('');
    });
  });
});
