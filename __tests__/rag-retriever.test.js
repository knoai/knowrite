const ragRetriever = require('../src/services/rag-retriever');

// Mock vector-store to avoid real LLM calls
jest.mock('../src/services/vector-store', () => {
  const { cosineSimilarity } = jest.requireActual('../src/services/vector-store');
  return {
    generateEmbedding: jest.fn().mockImplementation((text) => {
      // Return deterministic but varying vectors based on input text
      const seed = typeof text === 'string' ? text : JSON.stringify(text);
      const hash = seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
      const vec = [
        (hash % 100) / 100,
        ((hash * 7) % 100) / 100,
        ((hash * 13) % 100) / 100,
        ((hash * 31) % 100) / 100,
      ];
      return Promise.resolve(vec);
    }),
    saveEmbedding: jest.fn().mockResolvedValue({ id: 1 }),
    searchSimilar: jest.fn().mockResolvedValue([
      { content: 'chapter 1 summary', score: 0.95, chapterNumber: 1 },
      { content: 'chapter 2 summary', score: 0.88, chapterNumber: 2 },
    ]),
    cosineSimilarity,
  };
});

jest.mock('../src/models', () => {
  const { Sequelize, DataTypes } = require('sequelize');
  const sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });

  const Character = sequelize.define('Character', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    workId: DataTypes.STRING,
    name: DataTypes.STRING,
    roleType: DataTypes.STRING,
    description: DataTypes.TEXT,
  }, { tableName: 'characters', timestamps: true });

  const WorldLore = sequelize.define('WorldLore', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    workId: DataTypes.STRING,
    title: DataTypes.STRING,
    content: DataTypes.TEXT,
    category: DataTypes.STRING,
    importance: DataTypes.INTEGER,
  }, { tableName: 'world_lores', timestamps: true });

  let initialized = false;
  async function initDb() {
    if (!initialized) {
      await sequelize.sync({ force: true });
      initialized = true;
    }
  }

  return { sequelize, initDb, Character, WorldLore };
});

describe('rag-retriever', () => {
  const workId = 'test-work-rag';
  const { initDb, Character, WorldLore } = require('../src/models');

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await Character.destroy({ where: { workId } });
    await WorldLore.destroy({ where: { workId } });
    jest.clearAllMocks();
  });

  test('indexChapterSummary saves embedding', async () => {
    const { saveEmbedding } = require('../src/services/vector-store');
    await ragRetriever.indexChapterSummary(workId, 1, 'test summary', 'test-model');
    expect(saveEmbedding).toHaveBeenCalled();
    const call = saveEmbedding.mock.calls[0];
    expect(call[0]).toBe(workId);
    expect(call[1]).toBe(1);
    expect(call[2]).toBe('summary');
  });

  test('indexCharacter saves character embedding', async () => {
    const { saveEmbedding } = require('../src/services/vector-store');
    const character = { name: 'hero', alias: 'H', personality: 'brave', background: 'village', goals: 'save world' };
    await ragRetriever.indexCharacter(workId, character);
    expect(saveEmbedding).toHaveBeenCalled();
    const call = saveEmbedding.mock.calls[0];
    expect(call[0]).toBe(workId);
    expect(call[2]).toBe('character');
    expect(call[3]).toBe('hero');
  });

  test('indexWorldLore saves lore embedding', async () => {
    const { saveEmbedding } = require('../src/services/vector-store');
    const lore = { id: 1, title: 'magic system', content: 'mana based', chapterNumber: 2 };
    await ragRetriever.indexWorldLore(workId, lore);
    expect(saveEmbedding).toHaveBeenCalled();
    const call = saveEmbedding.mock.calls[0];
    expect(call[0]).toBe(workId);
    expect(call[2]).toBe('lore');
    expect(call[3]).toBe('magic system');
  });

  test('buildRagContext returns context string', async () => {
    const ctx = await ragRetriever.buildRagContext(workId, 'test outline', 3);
    expect(typeof ctx).toBe('string');
  });

  test('retrieveRelevantSummaries returns summary list', async () => {
    const results = await ragRetriever.retrieveRelevantSummaries(workId, 'test outline', 3);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toBeDefined();
  });

  test('retrieveRelevantSummaries returns empty for empty outline', async () => {
    const results = await ragRetriever.retrieveRelevantSummaries(workId, '', 3);
    expect(results).toEqual([]);
  });

  test('retrieveRelevantCharacters returns matching characters', async () => {
    await Character.create({ workId, name: 'Hero', alias: 'H', personality: 'brave', background: 'village', goals: 'save world' });
    await Character.create({ workId, name: 'Villain', alias: 'V', personality: 'evil', background: 'dark', goals: 'destroy' });

    const results = await ragRetriever.retrieveRelevantCharacters(workId, 'test outline');
    expect(Array.isArray(results)).toBe(true);
  });

  test('retrieveRelevantCharacters returns empty when no characters', async () => {
    const results = await ragRetriever.retrieveRelevantCharacters(workId, 'test outline');
    expect(results).toEqual([]);
  });

  test('retrieveRelevantCharacters returns empty for empty outline', async () => {
    await Character.create({ workId, name: 'Hero' });
    const results = await ragRetriever.retrieveRelevantCharacters(workId, '');
    expect(results).toEqual([]);
  });

  test('retrieveRelevantLore returns matching lore', async () => {
    await WorldLore.create({ workId, title: 'Magic', content: 'mana system', category: 'magic', importance: 5 });
    await WorldLore.create({ workId, title: 'History', content: 'ancient war', category: 'history', importance: 3 });

    const results = await ragRetriever.retrieveRelevantLore(workId, 'test outline');
    expect(Array.isArray(results)).toBe(true);
  });

  test('retrieveRelevantLore returns empty when no lore', async () => {
    const results = await ragRetriever.retrieveRelevantLore(workId, 'test outline');
    expect(results).toEqual([]);
  });

  test('retrieveRelevantLore returns empty for empty outline', async () => {
    await WorldLore.create({ workId, title: 'Magic', content: 'mana' });
    const results = await ragRetriever.retrieveRelevantLore(workId, '');
    expect(results).toEqual([]);
  });

  test('buildRagContext returns empty when no results', async () => {
    const { searchSimilar } = require('../src/services/vector-store');
    searchSimilar.mockResolvedValueOnce([]);
    const ctx = await ragRetriever.buildRagContext(workId, 'outline with no matches', 99);
    expect(ctx).toBe('');
  });

  test('indexChapterSummary handles null summary', async () => {
    const { saveEmbedding } = require('../src/services/vector-store');
    await ragRetriever.indexChapterSummary(workId, 1, null, 'model');
    expect(saveEmbedding).not.toHaveBeenCalled();
  });

  test('indexCharacter handles null character', async () => {
    const { saveEmbedding } = require('../src/services/vector-store');
    await ragRetriever.indexCharacter(workId, null);
    expect(saveEmbedding).not.toHaveBeenCalled();
  });

  test('indexWorldLore handles null lore', async () => {
    const { saveEmbedding } = require('../src/services/vector-store');
    await ragRetriever.indexWorldLore(workId, null);
    expect(saveEmbedding).not.toHaveBeenCalled();
  });
});
