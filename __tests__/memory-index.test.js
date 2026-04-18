/**
 * memory-index 测试
 */
const fs = require('fs');
const path = require('path');
const { getWorkDir } = require('../src/core/paths');
const {
  appendChapterToIndex,
  buildAntiRepetitionReminder,
  checkContentRepetition,
  repairContentRepetition,
} = require('../src/services/memory-index');

jest.mock('../src/core/chat', () => ({
  runStreamChat: jest.fn(),
}));

jest.mock('../src/services/settings-store', () => ({
  resolveRoleModelConfig: jest.fn().mockResolvedValue({ model: 'gpt-4' }),
  getChapterConfig: jest.fn().mockResolvedValue({ targetWords: 2000, minWords: 1800, maxWords: 2200 }),
}));

jest.mock('../src/services/novel-engine', () => ({
  appendToFullTxt: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/services/file-store', () => ({
  readFile: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
}));

const fileStore = require('../src/services/file-store');
const { runStreamChat } = require('../src/core/chat');

describe('memory-index', () => {
  const workId = 'mem-test-1';
  let workDir;

  beforeAll(() => {
    workDir = getWorkDir(workId);
    fs.mkdirSync(workDir, { recursive: true });
  });

  afterAll(() => {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
  });

  beforeEach(() => {
    jest.clearAllMocks();
    fileStore.readFile.mockResolvedValue(null);
    runStreamChat.mockResolvedValue({ content: '{"entities":[],"plot_threads":[],"rules":[]}', chars: 100, durationMs: 500 });
  });

  describe('appendChapterToIndex', () => {
    it('should create new index from scratch', async () => {
      runStreamChat.mockResolvedValue({
        content: JSON.stringify({ entities: ['主角', '宝剑'], plot_threads: ['复仇'], rules: ['修炼体系'] }),
        chars: 50,
        durationMs: 100,
      });

      const index = await appendChapterToIndex(workId, 1, 'summary', 'style', null, {});

      expect(index.entities).toBeDefined();
      expect(index.entities['主角']).toContain(1);
      expect(index.entities['宝剑']).toContain(1);
      expect(index.plot_threads['复仇']).toContain(1);
      expect(index.rules['修炼体系']).toContain(1);
      expect(fileStore.writeFile).toHaveBeenCalled();
    });

    it('should merge with existing index', async () => {
      fileStore.readFile.mockImplementation((wid, fname) => {
        if (fname === 'memory_index.json') {
          return JSON.stringify({
            entities: { 主角: [1] },
            plot_threads: { 复仇: [1] },
            rules: {},
            lastUpdated: '2024-01-01T00:00:00Z',
          });
        }
        return null;
      });
      runStreamChat.mockResolvedValue({
        content: JSON.stringify({ entities: ['主角', '反派'], plot_threads: ['复仇'], rules: ['宗门规矩'] }),
        chars: 50,
        durationMs: 100,
      });

      const index = await appendChapterToIndex(workId, 2, 'summary', 'style', null, {});

      expect(index.entities['主角']).toEqual([1, 2]);
      expect(index.entities['反派']).toEqual([2]);
      expect(index.plot_threads['复仇']).toEqual([1, 2]);
      expect(index.rules['宗门规矩']).toEqual([2]);
    });

    it('should deduplicate chapter numbers for same term', async () => {
      fileStore.readFile.mockImplementation((wid, fname) => {
        if (fname === 'memory_index.json') {
          return JSON.stringify({ entities: { 主角: [1] }, plot_threads: {}, rules: {} });
        }
        return null;
      });
      runStreamChat.mockResolvedValue({
        content: JSON.stringify({ entities: ['主角'], plot_threads: [], rules: [] }),
        chars: 50,
        durationMs: 100,
      });

      const index = await appendChapterToIndex(workId, 1, 'summary', 'style', null, {});
      expect(index.entities['主角']).toEqual([1]); // not [1, 1]
    });

    it('should handle empty extraction result', async () => {
      runStreamChat.mockResolvedValue({
        content: 'invalid json',
        chars: 20,
        durationMs: 100,
      });

      const index = await appendChapterToIndex(workId, 3, 'summary', 'style', null, {});
      expect(index.entities).toEqual({});
      expect(index.plot_threads).toEqual({});
      expect(index.rules).toEqual({});
    });

    it('should handle parse error in existing index', async () => {
      fileStore.readFile.mockImplementation((wid, fname) => {
        if (fname === 'memory_index.json') return 'not-json';
        return null;
      });
      runStreamChat.mockResolvedValue({
        content: JSON.stringify({ entities: ['A'], plot_threads: [], rules: [] }),
        chars: 20,
        durationMs: 100,
      });

      const index = await appendChapterToIndex(workId, 4, 'summary', 'style', null, {});
      expect(index.entities['A']).toContain(4);
    });
  });

  describe('buildAntiRepetitionReminder', () => {
    it('should return empty when index is empty', async () => {
      const reminder = await buildAntiRepetitionReminder(workId, 'outline', 5, 10);
      expect(reminder).toBe('');
    });

    it('should return empty when outline has no matching terms', async () => {
      fileStore.readFile.mockImplementation((wid, fname) => {
        if (fname === 'memory_index.json') {
          return JSON.stringify({
            entities: { 主角: [1, 2] },
            plot_threads: {},
            rules: {},
          });
        }
        return null;
      });

      const reminder = await buildAntiRepetitionReminder(workId, 'unrelated outline', 5, 10);
      expect(reminder).toBe('');
    });

    it('should generate reminders for known terms in outline', async () => {
      fileStore.readFile.mockImplementation((wid, fname) => {
        if (fname === 'memory_index.json') {
          return JSON.stringify({
            entities: { 主角: [1, 3], 宝剑: [2] },
            plot_threads: { 复仇线: [1, 2, 3] },
            rules: {},
          });
        }
        return null;
      });

      const reminder = await buildAntiRepetitionReminder(workId, '主角踏上复仇线', 5, 10);
      expect(reminder).toContain('防重复提醒');
      expect(reminder).toContain('主角');
      expect(reminder).toContain('复仇线');
      expect(reminder).not.toContain('宝剑'); // only appears once
    });

    it('should skip terms with only one mention', async () => {
      fileStore.readFile.mockImplementation((wid, fname) => {
        if (fname === 'memory_index.json') {
          return JSON.stringify({
            entities: { 主角: [1] }, // only once
            plot_threads: {},
            rules: {},
          });
        }
        return null;
      });

      const reminder = await buildAntiRepetitionReminder(workId, '主角出现', 5, 10);
      expect(reminder).toBe(''); // need >= 2 mentions
    });

    it('should skip terms whose last mention is within window', async () => {
      fileStore.readFile.mockImplementation((wid, fname) => {
        if (fname === 'memory_index.json') {
          return JSON.stringify({
            entities: { 主角: [1, 6] }, // last at 6, window starts at 5
            plot_threads: {},
            rules: {},
          });
        }
        return null;
      });

      const reminder = await buildAntiRepetitionReminder(workId, '主角出现', 5, 10);
      expect(reminder).toBe(''); // lastMention (6) >= windowStart (5)
    });
  });

  describe('checkContentRepetition', () => {
    it('should return no repetition when index is empty', async () => {
      const result = await checkContentRepetition(workId, 5, 'chapter text', 'style', null, {});
      expect(result.repetitive).toBe(false);
      expect(result.severity).toBe('low');
      expect(result.issues).toEqual([]);
    });

    it('should check against known items and save result', async () => {
      fileStore.readFile.mockImplementation((wid, fname) => {
        if (fname === 'memory_index.json') {
          return JSON.stringify({
            entities: { 主角: [1, 2] },
            plot_threads: { 复仇线: [1, 3] },
            rules: { 修炼体系: [1, 2] },
          });
        }
        return null;
      });
      runStreamChat.mockResolvedValue({
        content: JSON.stringify({ repetitive: true, severity: 'medium', issues: ['重复解释'], suggestions: ['精简'] }),
        chars: 200,
        durationMs: 1000,
      });

      const result = await checkContentRepetition(workId, 5, 'chapter text here', 'style', null, {});

      expect(result.repetitive).toBe(true);
      expect(result.severity).toBe('medium');
      expect(fileStore.writeFile).toHaveBeenCalledWith(
        workId,
        'chapter_5_repetition.json',
        expect.stringContaining('medium')
      );
    });

    it('should handle malformed LLM response gracefully', async () => {
      fileStore.readFile.mockImplementation((wid, fname) => {
        if (fname === 'memory_index.json') {
          return JSON.stringify({
            entities: { 主角: [1, 2] },
            plot_threads: {},
            rules: {},
          });
        }
        return null;
      });
      runStreamChat.mockResolvedValue({ content: 'bad response', chars: 10, durationMs: 100 });

      const result = await checkContentRepetition(workId, 5, 'text', 'style', null, {});
      expect(result.repetitive).toBe(false);
      expect(result.severity).toBe('low');
    });

    it('should invoke callbacks when provided', async () => {
      fileStore.readFile.mockImplementation((wid, fname) => {
        if (fname === 'memory_index.json') {
          return JSON.stringify({ entities: { A: [1, 2] }, plot_threads: {}, rules: {} });
        }
        return null;
      });
      runStreamChat.mockResolvedValue({
        content: JSON.stringify({ repetitive: false, severity: 'low', issues: [], suggestions: [] }),
        chars: 100,
        durationMs: 500,
      });

      const callbacks = {
        onStepStart: jest.fn(),
        onStepEnd: jest.fn(),
        onChunk: jest.fn(),
      };

      await checkContentRepetition(workId, 5, 'text', 'style', null, callbacks);

      expect(callbacks.onStepStart).toHaveBeenCalled();
      expect(callbacks.onStepEnd).toHaveBeenCalled();
    });
  });

  describe('repairContentRepetition', () => {
    it('should repair chapter and save result', async () => {
      runStreamChat.mockResolvedValue({
        content: '修复后的章节内容\n【修复说明】删除了重复描述',
        chars: 1500,
        durationMs: 2000,
      });

      const result = await repairContentRepetition(
        workId,
        5,
        '原始章节内容',
        { issues: ['重复解释'], suggestions: ['精简'] },
        'style',
        null,
        {}
      );

      expect(result.content).toContain('修复后的章节内容');
      expect(result.filename).toBe('chapter_5_repetition_repaired.txt');
      expect(fileStore.writeFile).toHaveBeenCalledWith(
        workId,
        'chapter_5_repetition_repaired.txt',
        expect.stringContaining('修复后的章节内容')
      );
    });

    it('should update existing repetition result file', async () => {
      fileStore.readFile.mockImplementation((wid, fname) => {
        if (fname === 'chapter_5_repetition.json') {
          return JSON.stringify({ repetitive: true, severity: 'high' });
        }
        return null;
      });
      runStreamChat.mockResolvedValue({ content: 'repaired', chars: 100, durationMs: 100 });

      await repairContentRepetition(workId, 5, 'text', { issues: [], suggestions: [] }, 'style', null, {});

      expect(fileStore.writeFile).toHaveBeenCalledWith(
        workId,
        'chapter_5_repetition.json',
        expect.stringContaining('repaired')
      );
    });

    it('should handle missing issues/suggestions', async () => {
      runStreamChat.mockResolvedValue({ content: 'repaired', chars: 100, durationMs: 100 });

      const result = await repairContentRepetition(workId, 5, 'text', {}, 'style', null, {});
      expect(result.content).toBe('repaired');
    });

    it('should invoke callbacks when provided', async () => {
      runStreamChat.mockResolvedValue({ content: 'repaired', chars: 100, durationMs: 100 });

      const callbacks = {
        onStepStart: jest.fn(),
        onStepEnd: jest.fn(),
        onChunk: jest.fn(),
      };

      await repairContentRepetition(workId, 5, 'text', { issues: [], suggestions: [] }, 'style', null, callbacks);

      expect(callbacks.onStepStart).toHaveBeenCalled();
      expect(callbacks.onStepEnd).toHaveBeenCalled();
    });
  });
});
