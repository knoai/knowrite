const fileStore = require('../src/services/file-store');
const { initDb } = require('../src/models');

describe('file-store', () => {
  beforeAll(async () => {
    await initDb();
  });

  const workId = 'test-work-001';

  test('writeFile and readFile roundtrip', async () => {
    await fileStore.writeFile(workId, 'test.txt', 'hello world');
    const content = await fileStore.readFile(workId, 'test.txt');
    expect(content).toBe('hello world');
  });

  test('readFile returns empty string for missing file', async () => {
    const content = await fileStore.readFile(workId, 'nonexistent.txt');
    expect(content).toBe('');
  });

  test('cache returns cached value without DB query', async () => {
    await fileStore.writeFile(workId, 'cached.txt', 'cached content');
    const first = await fileStore.readFile(workId, 'cached.txt');
    expect(first).toBe('cached content');
    // second read should hit cache
    const second = await fileStore.readFile(workId, 'cached.txt');
    expect(second).toBe('cached content');
  });

  test('upsert updates existing file', async () => {
    await fileStore.writeFile(workId, 'update.txt', 'v1');
    await fileStore.writeFile(workId, 'update.txt', 'v2');
    const content = await fileStore.readFile(workId, 'update.txt');
    expect(content).toBe('v2');
  });

  test('readFiles batch read', async () => {
    await fileStore.writeFile(workId, 'a.txt', 'A');
    await fileStore.writeFile(workId, 'b.txt', 'B');
    const result = await fileStore.readFiles(workId, ['a.txt', 'b.txt', 'missing.txt']);
    expect(result['a.txt']).toBe('A');
    expect(result['b.txt']).toBe('B');
    expect(result['missing.txt']).toBe('');
  });

  test('appendToFile appends content', async () => {
    await fileStore.writeFile(workId, 'append.txt', 'line1\n');
    await fileStore.appendToFile(workId, 'append.txt', 'line2\n');
    const content = await fileStore.readFile(workId, 'append.txt');
    expect(content).toBe('line1\nline2\n');
  });

  test('invalidateCache forces DB read on next access', async () => {
    await fileStore.writeFile(workId, 'invalidate.txt', 'original');
    await fileStore.readFile(workId, 'invalidate.txt'); // populate cache
    // Directly update DB to simulate external change
    const { WorkFile } = require('../src/models');
    await WorkFile.update(
      { content: 'updated' },
      { where: { workId, filename: 'invalidate.txt' } }
    );
    // Without invalidation, cache still returns old value
    const cached = await fileStore.readFile(workId, 'invalidate.txt');
    expect(cached).toBe('original');

    // After invalidation, should read updated value
    fileStore.invalidateCache(workId, 'invalidate.txt');
    const fresh = await fileStore.readFile(workId, 'invalidate.txt');
    expect(fresh).toBe('updated');
  });
});
