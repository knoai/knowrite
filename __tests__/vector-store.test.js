const {
  cosineSimilarity,
  saveEmbedding,
  searchSimilar,
  listEmbeddings,
  deleteEmbeddingsByWorkId,
  rebuildIndex,
} = require('../src/services/vector-store');

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
    // 插入 3 条 embedding（低于 HNSW INDEX_THRESHOLD=50，走 fallback）
    await saveEmbedding(workId, 1, 'summary', 'c1', 'apple pie', [1, 0, 0, 0], 'm1');
    await saveEmbedding(workId, 2, 'summary', 'c2', 'banana bread', [0, 1, 0, 0], 'm1');
    await saveEmbedding(workId, 3, 'summary', 'c3', 'cherry tart', [0.9, 0.1, 0, 0], 'm1');

    const results = await searchSimilar(workId, [1, 0, 0, 0], { topK: 2, minScore: 0.5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].sourceId).toBe('c1'); // 最相似
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
    // c5 的 chapterNumber=5 >= beforeChapter=5，应被过滤
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

  test('deleteEmbeddingsByWorkId removes all records', async () => {
    await saveEmbedding(workId, 1, 'summary', 'c1', 'content', [1, 0, 0, 0], 'm1');
    await deleteEmbeddingsByWorkId(workId);
    const remaining = await listEmbeddings(workId);
    expect(remaining.length).toBe(0);
  });

  test('rebuildIndex returns null for small dataset', async () => {
    await saveEmbedding(workId, 1, 'summary', 'c1', 'content', [1, 0, 0, 0], 'm1');
    const index = await rebuildIndex(workId);
    // 1 条记录 < INDEX_THRESHOLD(50)，应返回 null
    expect(index).toBeNull();
  });
});
