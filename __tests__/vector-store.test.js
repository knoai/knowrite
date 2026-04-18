const {
  cosineSimilarity,
  saveEmbedding,
  searchSimilar,
  listEmbeddings,
  deleteEmbeddingsByWorkId,
  rebuildIndex,
  generateEmbedding,
} = require('../src/services/vector-store');

jest.mock('../src/services/settings-store', () => ({
  getModelConfig: jest.fn(),
}));

jest.mock('../src/providers/factory', () => ({
  create: jest.fn().mockReturnValue({
    embed: jest.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
  }),
}));

const { getModelConfig } = require('../src/services/settings-store');
const ProviderFactory = require('../src/providers/factory');

describe('vector-store cosineSimilarity', () => {
  test('identical vectors have similarity 1', () => {
    const vec = [1, 2, 3];
    expect(cosineSimilarity(vec, vec)).toBe(1);
  });

  test('orthogonal vectors have similarity 0', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBe(0);
  });

  test('opposite vectors have similarity -1', () => {
    expect(cosineSimilarity([1, 2, 3], [-1, -2, -3])).toBeCloseTo(-1, 5);
  });

  test('null or undefined vectors return -1', () => {
    expect(cosineSimilarity(null, [1, 2])).toBe(-1);
    expect(cosineSimilarity([1, 2], null)).toBe(-1);
  });

  test('different length vectors return -1', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(-1);
  });

  test('zero vector returns 0', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  test('real embedding-like vectors', () => {
    const a = [0.1, 0.2, 0.3, 0.4];
    const b = [0.15, 0.25, 0.35, 0.45];
    const score = cosineSimilarity(a, b);
    expect(score).toBeGreaterThan(0.95);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe('vector-store SQLite persistence', () => {
  const workId = 'test-work-vector';

  beforeEach(async () => {
    await deleteEmbeddingsByWorkId(workId);
  });

  afterAll(async () => {
    await deleteEmbeddingsByWorkId(workId);
  });

  test('saveEmbedding stores record', async () => {
    const embedding = [0.1, 0.2, 0.3, 0.4];
    const record = await saveEmbedding(
      workId,
      1,
      'summary',
      'chapter_1',
      'test content',
      embedding,
      'test-model'
    );
    expect(record).toBeDefined();
    expect(record.workId).toBe(workId);
    expect(record.chapterNumber).toBe(1);
    expect(record.sourceType).toBe('summary');
  });

  test('listEmbeddings returns saved records', async () => {
    await saveEmbedding(workId, 1, 'summary', 'c1', 'content1', [0.1, 0.2, 0.3, 0.4], 'm1');
    await saveEmbedding(workId, 2, 'summary', 'c2', 'content2', [0.2, 0.3, 0.4, 0.5], 'm1');

    const all = await listEmbeddings(workId);
    expect(all.length).toBe(2);

    const summaries = await listEmbeddings(workId, 'summary');
    expect(summaries.length).toBe(2);
  });

  test('searchSimilar fallback returns relevant results', async () => {
    // Insert 3 embeddings (below HNSW INDEX_THRESHOLD=50, uses fallback)
    await saveEmbedding(workId, 1, 'summary', 'c1', 'apple pie', [1, 0, 0, 0], 'm1');
    await saveEmbedding(workId, 2, 'summary', 'c2', 'banana bread', [0, 1, 0, 0], 'm1');
    await saveEmbedding(workId, 3, 'summary', 'c3', 'cherry tart', [0.9, 0.1, 0, 0], 'm1');

    const results = await searchSimilar(workId, [1, 0, 0, 0], { topK: 2, minScore: 0.5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].sourceId).toBe('c1'); // most similar
    expect(results[0].score).toBe(1);
  });

  test('searchSimilar respects beforeChapter filter', async () => {
    await saveEmbedding(workId, 1, 'summary', 'c1', 'early', [1, 0, 0, 0], 'm1');
    await saveEmbedding(workId, 5, 'summary', 'c5', 'late', [0.9, 0.1, 0, 0], 'm1');

    const results = await searchSimilar(workId, [1, 0, 0, 0], {
      topK: 5,
      beforeChapter: 5,
      minScore: 0.5,
    });
    // c5 chapterNumber=5 >= beforeChapter=5, should be filtered
    expect(results.every((r) => r.chapterNumber < 5)).toBe(true);
  });

  test('searchSimilar respects sourceTypes filter', async () => {
    await saveEmbedding(workId, 1, 'summary', 's1', 'summary text', [1, 0, 0, 0], 'm1');
    await saveEmbedding(workId, 1, 'dialog', 'd1', 'dialog text', [0.9, 0.1, 0, 0], 'm1');

    const results = await searchSimilar(workId, [1, 0, 0, 0], {
      topK: 5,
      sourceTypes: ['summary'],
      minScore: 0.5,
    });
    expect(results.length).toBe(1);
    expect(results[0].sourceType).toBe('summary');
  });

  test('searchSimilar filters by minScore', async () => {
    await saveEmbedding(workId, 1, 'summary', 'close', 'close content', [0.99, 0.01, 0, 0], 'm1');
    await saveEmbedding(workId, 2, 'summary', 'far', 'far content', [0, 1, 0, 0], 'm1');

    const results = await searchSimilar(workId, [1, 0, 0, 0], {
      topK: 5,
      minScore: 0.95,
    });
    expect(results.length).toBe(1);
    expect(results[0].sourceId).toBe('close');
  });

  test('deleteEmbeddingsByWorkId removes all records', async () => {
    await saveEmbedding(workId, 1, 'summary', 'c1', 'content', [1, 0, 0, 0], 'm1');
    await deleteEmbeddingsByWorkId(workId);
    const remaining = await listEmbeddings(workId);
    expect(remaining.length).toBe(0);
  });

  test('rebuildIndex returns null for small dataset', async () => {
    await saveEmbedding(workId, 1, 'summary', 'c1', 'content', [1, 0, 0, 0], 'm1');
    const index = await rebuildIndex(workId);
    // 1 record < INDEX_THRESHOLD(50), should return null
    expect(index).toBeNull();
  });

  test('saveEmbedding updates existing record by unique index', async () => {
    await saveEmbedding(workId, 1, 'summary', 'same', 'old content', [1, 0, 0, 0], 'm1');
    const updated = await saveEmbedding(workId, 2, 'summary', 'same', 'new content', [0.9, 0.1, 0, 0], 'm1');
    expect(updated.content).toBe('new content');
    const all = await listEmbeddings(workId);
    expect(all.length).toBe(1);
  });
});

describe('vector-store generateEmbedding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('generateEmbedding calls provider embed with string', async () => {
    getModelConfig.mockResolvedValue({
      embedder: { provider: 'openai', model: 'm1' },
      providers: { openai: {} },
    });
    const result = await generateEmbedding('hello', 'm1');
    expect(result).toEqual([0.1, 0.2, 0.3]);
  });

  test('generateEmbedding handles array input', async () => {
    getModelConfig.mockResolvedValue({
      embedder: { provider: 'openai' },
      providers: { openai: {} },
    });
    const mockEmbed = jest.fn().mockResolvedValue([[0.1], [0.2]]);
    ProviderFactory.create.mockReturnValue({ embed: mockEmbed });
    const result = await generateEmbedding(['a', 'b']);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
  });
});

describe('vector-store HNSW index path', () => {
  const workId = 'test-work-hnsw';

  beforeEach(async () => {
    await deleteEmbeddingsByWorkId(workId);
  });

  afterAll(async () => {
    await deleteEmbeddingsByWorkId(workId);
  });

  test('searchSimilar uses HNSW when enough embeddings exist', async () => {
    // Insert 52 embeddings to exceed INDEX_THRESHOLD=50
    const promises = [];
    for (let i = 0; i < 52; i++) {
      const vec = Array(4).fill(0);
      vec[0] = i / 52;
      promises.push(saveEmbedding(workId, i + 1, 'summary', `c${i}`, `content ${i}`, vec, 'm1'));
    }
    await Promise.all(promises);

    const results = await searchSimilar(workId, [1, 0, 0, 0], { topK: 3, minScore: 0.5 });
    expect(results.length).toBeGreaterThan(0);
    // The most similar to [1,0,0,0] should have high first component
    expect(results[0].score).toBeGreaterThan(0.5);
  });

  test('rebuildIndex builds HNSW when threshold met', async () => {
    const promises = [];
    for (let i = 0; i < 52; i++) {
      const vec = Array(4).fill(0).map((_, j) => (j === i % 4 ? 1 : 0));
      promises.push(saveEmbedding(workId, i + 1, 'summary', `c${i}`, `content`, vec, 'm1'));
    }
    await Promise.all(promises);

    const index = await rebuildIndex(workId);
    expect(index).not.toBeNull();
    expect(index.count).toBe(52);
  });
});
