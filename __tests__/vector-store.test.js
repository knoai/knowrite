const { cosineSimilarity } = require('../src/services/vector-store');

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
