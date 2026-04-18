const truthManager = require('../src/services/truth-manager');
const { TruthHook, TruthResource, initDb, sequelize } = require('../src/models');

jest.mock('../src/services/temporal-truth', () => ({
  initializeTruthFiles: jest.fn().mockResolvedValue(true),
  appendEventsFromDelta: jest.fn().mockResolvedValue(5),
  getCurrentState: jest.fn().mockResolvedValue({ characterStates: [] }),
  getCharacterStateAt: jest.fn().mockResolvedValue({ status: 'alive' }),
  getOpenHooks: jest.fn().mockResolvedValue([]),
  getActiveResources: jest.fn().mockResolvedValue([]),
  selectFragmentsForChapter: jest.fn().mockResolvedValue(['fragment1', 'fragment2']),
  regenerateProjections: jest.fn().mockResolvedValue(true),
  analyzeTrends: jest.fn().mockResolvedValue({ trend: 'up' }),
  detectAnomalies: jest.fn().mockResolvedValue([]),
  queryStateAt: jest.fn().mockResolvedValue({ status: 'alive' }),
  traceChanges: jest.fn().mockResolvedValue([{ chapter: 1, type: 'status_change' }]),
  materializeState: jest.fn().mockResolvedValue({ characterStates: [] }),
}));

describe('truth-manager', () => {
  const workId = 'test-work-truth-mgr';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await TruthHook.destroy({ where: { workId } });
    await TruthResource.destroy({ where: { workId } });
  });

  test('initializeTruthFiles delegates to temporal-truth', async () => {
    const temporalTruth = require('../src/services/temporal-truth');
    await truthManager.initializeTruthFiles(workId);
    expect(temporalTruth.initializeTruthFiles).toHaveBeenCalledWith(workId);
  });

  test('applyChapterDelta updates hooks and resources in transaction', async () => {
    await TruthHook.create({ workId, hookId: 'h1', status: 'open', createdChapter: 1 });
    await TruthResource.create({ workId, name: 'sword', owner: 'hero', status: 'active' });

    const delta = {
      characterChanges: [{ charName: 'hero', field: 'status', oldValue: 'alive', newValue: 'injured' }],
      resolvedHooks: [{ hookId: 'h1', resolution: 'revealed' }],
      resourceChanges: [{ name: 'sword', field: 'owner', oldValue: 'hero', newValue: 'villain' }],
    };

    const result = await truthManager.applyChapterDelta(workId, 2, delta);
    expect(result.updated).toBe(true);
    expect(result.eventsAppended).toBe(5);

    const hook = await TruthHook.findOne({ where: { workId, hookId: 'h1' } });
    expect(hook.status).toBe('resolved');
    expect(hook.resolvedChapter).toBe(2);

    const resource = await TruthResource.findOne({ where: { workId, name: 'sword' } });
    expect(resource.owner).toBe('villain');
    expect(resource.transferHistory).toEqual([{ from: 'hero', to: 'villain', chapter: 2, reason: '' }]);
  });

  test('getCurrentState delegates to temporal-truth', async () => {
    const temporalTruth = require('../src/services/temporal-truth');
    await truthManager.getCurrentState(workId);
    expect(temporalTruth.getCurrentState).toHaveBeenCalledWith(workId);
  });

  test('selectFragmentsForChapter delegates with intent', async () => {
    const temporalTruth = require('../src/services/temporal-truth');
    const fragments = await truthManager.selectFragmentsForChapter(workId, 3, 'confrontation');
    expect(temporalTruth.selectFragmentsForChapter).toHaveBeenCalledWith(workId, 3, 'confrontation');
    expect(fragments).toEqual(['fragment1', 'fragment2']);
  });

  test('queryStateAt delegates to temporal-truth', async () => {
    const temporalTruth = require('../src/services/temporal-truth');
    const state = await truthManager.queryStateAt(workId, 5, 'character', 'hero');
    expect(temporalTruth.queryStateAt).toHaveBeenCalledWith(workId, 5, 'character', 'hero');
    expect(state.status).toBe('alive');
  });

  test('traceChanges delegates to temporal-truth', async () => {
    const temporalTruth = require('../src/services/temporal-truth');
    const trace = await truthManager.traceChanges(workId, 'character', 'hero', 1, 5);
    expect(temporalTruth.traceChanges).toHaveBeenCalledWith(workId, 'character', 'hero', 1, 5);
    expect(trace[0].chapter).toBe(1);
  });

  test('applyChapterDelta marks resource as consumed', async () => {
    await TruthResource.create({ workId, name: 'potion', owner: 'hero', status: 'active' });
    const delta = { resourceChanges: [{ name: 'potion', field: 'status', oldValue: 'active', newValue: 'consumed' }] };
    await truthManager.applyChapterDelta(workId, 3, delta);
    const resource = await TruthResource.findOne({ where: { workId, name: 'potion' } });
    expect(resource.status).toBe('consumed');
    expect(resource.consumedChapter).toBe(3);
  });

  test('applyChapterDelta marks resource as lost', async () => {
    await TruthResource.create({ workId, name: 'map', owner: 'hero', status: 'active' });
    const delta = { resourceChanges: [{ name: 'map', field: 'status', oldValue: 'active', newValue: 'lost' }] };
    await truthManager.applyChapterDelta(workId, 4, delta);
    const resource = await TruthResource.findOne({ where: { workId, name: 'map' } });
    expect(resource.status).toBe('lost');
    expect(resource.lostChapter).toBe(4);
  });

  test('getCharacterStateAt delegates to temporal-truth', async () => {
    const temporalTruth = require('../src/services/temporal-truth');
    await truthManager.getCharacterStateAt(workId, 'hero', 5);
    expect(temporalTruth.getCharacterStateAt).toHaveBeenCalledWith(workId, 'hero', 5);
  });

  test('getOpenHooks delegates to temporal-truth', async () => {
    const temporalTruth = require('../src/services/temporal-truth');
    await truthManager.getOpenHooks(workId);
    expect(temporalTruth.getOpenHooks).toHaveBeenCalledWith(workId);
  });

  test('getActiveResources delegates to temporal-truth', async () => {
    const temporalTruth = require('../src/services/temporal-truth');
    await truthManager.getActiveResources(workId);
    expect(temporalTruth.getActiveResources).toHaveBeenCalledWith(workId);
  });

  test('regenerateProjections delegates to temporal-truth', async () => {
    const temporalTruth = require('../src/services/temporal-truth');
    await truthManager.regenerateProjections(workId);
    expect(temporalTruth.regenerateProjections).toHaveBeenCalledWith(workId);
  });

  test('analyzeTrends delegates to temporal-truth', async () => {
    const temporalTruth = require('../src/services/temporal-truth');
    await truthManager.analyzeTrends(workId, 'emotional_arc');
    expect(temporalTruth.analyzeTrends).toHaveBeenCalledWith(workId, 'emotional_arc', undefined);
  });

  test('detectAnomalies delegates to temporal-truth', async () => {
    const temporalTruth = require('../src/services/temporal-truth');
    await truthManager.detectAnomalies(workId);
    expect(temporalTruth.detectAnomalies).toHaveBeenCalledWith(workId);
  });

  test('materializeState delegates to temporal-truth', async () => {
    const temporalTruth = require('../src/services/temporal-truth');
    await truthManager.materializeState(workId, 5);
    expect(temporalTruth.materializeState).toHaveBeenCalledWith(workId, 5);
  });
});
