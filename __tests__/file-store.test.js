const fileStore = require('../src/services/file-store');
const { initDb, WorkFile } = require('../src/models');

describe('file-store', () => {
  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    // Clear cache state between tests for deterministic behavior
    const { invalidateWorkCache } = require('../src/services/file-store');
    invalidateWorkCache('test-work-001');
    invalidateWorkCache('test-work-002');
    // Clean up DB files for test workIds
    await WorkFile.destroy({ where: { workId: ['test-work-001', 'test-work-002'] } });
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

  test('invalidateWorkCache clears all cached files for work', async () => {
    await fileStore.writeFile(workId, 'a.txt', 'A');
    await fileStore.writeFile(workId, 'b.txt', 'B');
    await fileStore.readFile(workId, 'a.txt');
    await fileStore.readFile(workId, 'b.txt');

    fileStore.invalidateWorkCache(workId);

    // Directly update DB
    await WorkFile.update({ content: 'updated' }, { where: { workId } });
    const a = await fileStore.readFile(workId, 'a.txt');
    const b = await fileStore.readFile(workId, 'b.txt');
    expect(a).toBe('updated');
    expect(b).toBe('updated');
  });

  test('readFiles with partial cache hit', async () => {
    await fileStore.writeFile(workId, 'cached.txt', 'cached');
    await fileStore.writeFile(workId, 'db.txt', 'db-only');
    // Populate cache for only one file
    await fileStore.readFile(workId, 'cached.txt');

    const result = await fileStore.readFiles(workId, ['cached.txt', 'db.txt', 'missing.txt']);
    expect(result['cached.txt']).toBe('cached');
    expect(result['db.txt']).toBe('db-only');
    expect(result['missing.txt']).toBe('');
  });

  test('readAllWorkFiles returns all files with caching', async () => {
    await fileStore.writeFile(workId, 'x.txt', 'X');
    await fileStore.writeFile(workId, 'y.txt', 'Y');

    const map = await fileStore.readAllWorkFiles(workId);
    expect(Object.keys(map)).toHaveLength(2);
    expect(map['x.txt']).toBe('X');
    expect(map['y.txt']).toBe('Y');
  });

  test('deleteFile removes file and clears cache', async () => {
    await fileStore.writeFile(workId, 'delete.txt', 'to-delete');
    await fileStore.readFile(workId, 'delete.txt'); // cache

    await fileStore.deleteFile(workId, 'delete.txt');

    const content = await fileStore.readFile(workId, 'delete.txt');
    expect(content).toBe('');
  });

  test('listFiles returns all filenames', async () => {
    await fileStore.writeFile(workId, 'prefix_a.txt', 'A');
    await fileStore.writeFile(workId, 'prefix_b.txt', 'B');
    await fileStore.writeFile(workId, 'other.txt', 'C');

    const all = await fileStore.listFiles(workId);
    expect(all).toContain('prefix_a.txt');
    expect(all).toContain('other.txt');

    const filtered = await fileStore.listFiles(workId, 'prefix_');
    expect(filtered).toHaveLength(2);
    expect(filtered).not.toContain('other.txt');
  });

  test('fileExists checks existence via cache and DB', async () => {
    await fileStore.writeFile(workId, 'exists.txt', 'yes');
    // First call via DB
    expect(await fileStore.fileExists(workId, 'exists.txt')).toBe(true);
    // Second call via cache
    expect(await fileStore.fileExists(workId, 'exists.txt')).toBe(true);
    // Missing file
    expect(await fileStore.fileExists(workId, 'missing.txt')).toBe(false);
  });

  test('fileExists returns false for cached empty string', async () => {
    await fileStore.readFile(workId, 'never-written.txt'); // caches ''
    expect(await fileStore.fileExists(workId, 'never-written.txt')).toBe(false);
  });

  test('writeFile serializes non-string content', async () => {
    await fileStore.writeFile(workId, 'obj.json', { key: 'value' });
    const content = await fileStore.readFile(workId, 'obj.json');
    expect(JSON.parse(content)).toEqual({ key: 'value' });
  });

  test('TTL expiration evicts stale cache entries', async () => {
    await fileStore.writeFile(workId, 'ttl.txt', 'old');
    const first = await fileStore.readFile(workId, 'ttl.txt');
    expect(first).toBe('old');
    // Advance time beyond TTL to evict cache
    const realNow = Date.now;
    global.Date.now = () => realNow() + 31_000;
    // Update DB directly
    await WorkFile.update({ content: 'new' }, { where: { workId, filename: 'ttl.txt' } });
    const second = await fileStore.readFile(workId, 'ttl.txt');
    expect(second).toBe('new'); // TTL expired, read from DB
    global.Date.now = realNow;
  });

  test('LRU eviction removes oldest cached entry when cache is full', async () => {
    // Write enough unique files to exceed CACHE_MAX_SIZE
    const files = [];
    for (let i = 0; i < 202; i++) {
      const fname = `lru_${i}.txt`;
      files.push(fname);
      await fileStore.writeFile(workId, fname, `content ${i}`);
    }

    // Read the first file again — it should have been evicted from cache
    // and re-read from DB
    const content = await fileStore.readFile(workId, files[0]);
    expect(content).toBe('content 0');
  });
});
