const temporalTruth = require('../src/services/temporal-truth');
const { TruthEvent, TruthState, TruthHook, TruthResource, initDb } = require('../src/models');

jest.mock('../src/services/file-store', () => ({
  writeFile: jest.fn().mockResolvedValue(true),
  readFile: jest.fn().mockResolvedValue(null),
}));

describe('temporal-truth', () => {
  const workId = 'test-work-truth';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await TruthEvent.destroy({ where: { workId } });
    await TruthState.destroy({ where: { workId } });
    await TruthHook.destroy({ where: { workId } });
    await TruthResource.destroy({ where: { workId } });
  });

  describe('appendEvent', () => {
    test('appends single event with auto-increment sequence', async () => {
      const event = {
        workId,
        chapterNumber: 1,
        eventType: 'char_status_change',
        subjectType: 'character',
        subjectId: 'hero',
        payload: { from: 'alive', to: 'injured' },
        sourceChapter: 1,
        extractedBy: 'test',
      };
      const record = await temporalTruth.appendEvent(event);
      expect(record.eventSequence).toBe(1);
      expect(record.subjectId).toBe('hero');
    });

    test('increments sequence for same chapter', async () => {
      const base = {
        workId,
        chapterNumber: 1,
        eventType: 'char_status_change',
        subjectType: 'character',
        subjectId: 'hero',
        payload: {},
        sourceChapter: 1,
        extractedBy: 'test',
      };
      await temporalTruth.appendEvent(base);
      const second = await temporalTruth.appendEvent({ ...base, payload: { from: 'injured', to: 'dead' } });
      expect(second.eventSequence).toBe(2);
    });
  });

  describe('appendEventsFromDelta', () => {
    test('converts delta to events and returns count', async () => {
      const delta = {
        characterChanges: [
          { charName: 'hero', field: 'status', oldValue: 'alive', newValue: 'injured' },
        ],
        worldChanges: [
          { field: 'location', oldValue: 'village', newValue: 'castle' },
        ],
        emotionalChanges: [
          { charName: 'hero', emotion: 'angry', intensity: 8, reason: 'betrayal' },
        ],
        newHooks: [
          { hookId: 'h1', description: 'mysterious letter', targetChapter: 5 },
        ],
        resolvedHooks: [
          { hookId: 'h2', resolution: 'revealed as ally' },
        ],
        newResources: [
          { name: 'sword', type: 'weapon', owner: 'hero' },
        ],
        resourceChanges: [
          { name: 'sword', field: 'owner', oldValue: 'hero', newValue: 'villain' },
        ],
      };

      const count = await temporalTruth.appendEventsFromDelta(workId, 1, delta);
      expect(count).toBe(7);

      const events = await TruthEvent.findAll({ where: { workId, chapterNumber: 1 } });
      expect(events.length).toBe(7);

      const charEvent = events.find((e) => e.eventType === 'char_status_change');
      expect(charEvent.subjectId).toBe('hero');

      const worldEvent = events.find((e) => e.eventType === 'world_location_change');
      expect(worldEvent.subjectType).toBe('world');

      const hookEvent = events.find((e) => e.eventType === 'hook_created');
      expect(hookEvent.subjectId).toBe('h1');
    });

    test('returns 0 for null delta', async () => {
      const count = await temporalTruth.appendEventsFromDelta(workId, 1, null);
      expect(count).toBe(0);
    });
  });

  describe('materializeState', () => {
    test('computes state from events', async () => {
      await temporalTruth.appendEventsFromDelta(workId, 1, {
        characterChanges: [
          { charName: 'hero', field: 'status', oldValue: 'alive', newValue: 'injured' },
          { charName: 'hero', field: 'location', oldValue: 'village', newValue: 'castle' },
        ],
        worldChanges: [
          { field: 'political', oldValue: 'peace', newValue: 'war' },
        ],
      });

      const state = await temporalTruth.materializeState(workId, 1);
      expect(state).toBeDefined();
      expect(state.characterStates).toBeDefined();

      const hero = state.characterStates.find((c) => c.charName === 'hero');
      expect(hero).toBeDefined();
      expect(hero.status).toBe('injured');
      expect(hero.location).toBe('castle');

      const materialized = await TruthState.findOne({ where: { workId, chapterNumber: 1 } });
      expect(materialized).toBeDefined();
      expect(materialized.isMaterialized).toBe(true);
    });

    test('returns null when no events', async () => {
      const state = await temporalTruth.materializeState(workId, 99);
      expect(state).toBeNull();
    });
  });

  describe('getCurrentState', () => {
    test('returns latest materialized state', async () => {
      await temporalTruth.appendEventsFromDelta(workId, 1, {
        characterChanges: [{ charName: 'hero', field: 'status', oldValue: 'alive', newValue: 'injured' }],
      });
      await temporalTruth.materializeState(workId, 1);

      await temporalTruth.appendEventsFromDelta(workId, 2, {
        characterChanges: [{ charName: 'hero', field: 'status', oldValue: 'injured', newValue: 'dead' }],
      });
      await temporalTruth.materializeState(workId, 2);

      const current = await temporalTruth.getCurrentState(workId);
      expect(current).toBeDefined();
      const hero = current.characterStates.find((c) => c.charName === 'hero');
      expect(hero.status).toBe('dead');
    });
  });

  describe('selectFragmentsForChapter', () => {
    test('returns relevant fragments based on intent', async () => {
      await temporalTruth.appendEventsFromDelta(workId, 1, {
        characterChanges: [
          { charName: 'hero', field: 'status', oldValue: 'alive', newValue: 'injured' },
        ],
        worldChanges: [
          { field: 'location', oldValue: 'village', newValue: 'castle' },
        ],
        newHooks: [
          { hookId: 'h1', description: 'mysterious letter from the king', targetChapter: 5 },
        ],
      });
      await temporalTruth.materializeState(workId, 1);

      const fragments = await temporalTruth.selectFragmentsForChapter(workId, 2, 'hero confronts the king');
      expect(Array.isArray(fragments)).toBe(true);
      expect(fragments.length).toBeGreaterThan(0);
    });
  });

  describe('queryStateAt', () => {
    test('queries character state at specific chapter', async () => {
      await temporalTruth.appendEventsFromDelta(workId, 1, {
        characterChanges: [{ charName: 'hero', field: 'status', oldValue: 'alive', newValue: 'injured' }],
      });
      await temporalTruth.materializeState(workId, 1);

      const state = await temporalTruth.queryStateAt(workId, 1, 'character', 'hero');
      expect(state).toBeDefined();
      expect(state.status).toBe('injured');
    });
  });

  describe('traceChanges', () => {
    test('traces changes for a character across chapters', async () => {
      await temporalTruth.appendEventsFromDelta(workId, 1, {
        characterChanges: [{ charName: 'hero', field: 'status', oldValue: 'alive', newValue: 'injured' }],
      });
      await temporalTruth.appendEventsFromDelta(workId, 2, {
        characterChanges: [{ charName: 'hero', field: 'status', oldValue: 'injured', newValue: 'dead' }],
      });

      const trace = await temporalTruth.traceChanges(workId, 'character', 'hero', 1, 2);
      expect(trace).toBeDefined();
      expect(Array.isArray(trace)).toBe(true);
      expect(trace.length).toBeGreaterThan(0);
      expect(trace[0].chapter).toBeDefined();
    });
  });
});
