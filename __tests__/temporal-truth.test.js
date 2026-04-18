const temporalTruth = require('../src/services/temporal-truth');
const { TruthEvent, TruthState, TruthHook, TruthResource, Work, Character, initDb } = require('../src/models');
const fileStore = require('../src/services/file-store');

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
    await Work.destroy({ where: { workId } });
    await Character.destroy({ where: { workId } });
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

  describe('getCharacterStateAt', () => {
    test('returns character state at or before chapter', async () => {
      await temporalTruth.appendEventsFromDelta(workId, 1, {
        characterChanges: [{ charName: 'hero', field: 'status', oldValue: 'alive', newValue: 'injured' }],
      });
      await temporalTruth.materializeState(workId, 1);

      const state = await temporalTruth.getCharacterStateAt(workId, 'hero', 1);
      expect(state).toBeDefined();
      expect(state.status).toBe('injured');
    });

    test('returns null when no state exists', async () => {
      const state = await temporalTruth.getCharacterStateAt(workId, 'nobody', 1);
      expect(state).toBeNull();
    });
  });

  describe('getOpenHooks', () => {
    test('returns open and progressing hooks', async () => {
      await TruthHook.bulkCreate([
        { workId, hookId: 'h1', status: 'open', createdChapter: 1, description: 'mystery', importance: 'major' },
        { workId, hookId: 'h2', status: 'resolved', createdChapter: 1, description: 'secret', resolvedChapter: 2, importance: 'minor' },
        { workId, hookId: 'h3', status: 'progressing', createdChapter: 2, description: 'clue', importance: 'major' },
      ]);

      const hooks = await temporalTruth.getOpenHooks(workId);
      expect(hooks.length).toBe(2);
      const ids = hooks.map((h) => h.hookId).sort();
      expect(ids).toEqual(['h1', 'h3']);
    });

    test('returns empty when no hooks', async () => {
      const hooks = await temporalTruth.getOpenHooks('no-hooks-work');
      expect(hooks).toEqual([]);
    });
  });

  describe('getActiveResources', () => {
    test('returns active resources', async () => {
      await TruthResource.bulkCreate([
        { workId, name: 'sword', type: 'weapon', owner: 'hero', status: 'active' },
        { workId, name: 'shield', type: 'armor', owner: 'hero', status: 'lost' },
      ]);

      const resources = await temporalTruth.getActiveResources(workId);
      expect(resources.length).toBe(1);
      expect(resources[0].name).toBe('sword');
    });

    test('returns empty when no active resources', async () => {
      const resources = await temporalTruth.getActiveResources('no-res-work');
      expect(resources).toEqual([]);
    });
  });

  describe('getMaxChapter', () => {
    test('returns max chapter number with events', async () => {
      await temporalTruth.appendEventsFromDelta(workId, 3, {
        characterChanges: [{ charName: 'hero', field: 'status', oldValue: 'alive', newValue: 'injured' }],
      });

      const max = await temporalTruth.getMaxChapter(workId);
      expect(max).toBe(3);
    });

    test('returns 0 when no events', async () => {
      const max = await temporalTruth.getMaxChapter('no-events-work');
      expect(max).toBe(0);
    });
  });

  describe('analyzeTrends', () => {
    test('emotional_arc returns arcs grouped by character', async () => {
      await TruthEvent.create({ workId, chapterNumber: 2, eventType: 'char_mood_change', subjectType: 'character', subjectId: 'hero', payload: {}, eventSequence: 1 });
      await TruthState.bulkCreate([
        { workId, chapterNumber: 1, emotionalArcs: [{ charName: 'hero', emotion: 'sad', intensity: 0.8 }] },
        { workId, chapterNumber: 2, emotionalArcs: [{ charName: 'hero', emotion: 'angry', intensity: 0.9 }] },
      ]);

      const arcs = await temporalTruth.analyzeTrends(workId, 'emotional_arc');
      expect(arcs.hero).toBeDefined();
      expect(arcs.hero.length).toBe(2);
      expect(arcs.hero[0].emotion).toBe('sad');
    });

    test('character_presence counts chapters per character', async () => {
      await TruthEvent.bulkCreate([
        { workId, chapterNumber: 1, eventType: 'char_location_change', subjectType: 'character', subjectId: 'hero', payload: { to: 'forest' }, eventSequence: 1 },
        { workId, chapterNumber: 2, eventType: 'char_status_change', subjectType: 'character', subjectId: 'hero', payload: { to: 'injured' }, eventSequence: 1 },
        { workId, chapterNumber: 2, eventType: 'char_location_change', subjectType: 'character', subjectId: 'villain', payload: { to: 'castle' }, eventSequence: 1 },
      ]);

      const presence = await temporalTruth.analyzeTrends(workId, 'character_presence');
      expect(presence.length).toBe(2);
      const hero = presence.find((p) => p.character === 'hero');
      expect(hero.chapterCount).toBe(2);
    });

    test('hook_lifecycle returns hook metadata', async () => {
      await TruthHook.bulkCreate([
        { workId, hookId: 'h1', status: 'open', createdChapter: 1, description: 'mystery', importance: 'major' },
        { workId, hookId: 'h2', status: 'resolved', createdChapter: 2, description: 'secret', resolvedChapter: 5, importance: 'minor' },
      ]);

      const lifecycle = await temporalTruth.analyzeTrends(workId, 'hook_lifecycle');
      expect(lifecycle.length).toBe(2);
      const resolved = lifecycle.find((h) => h.hookId === 'h2');
      expect(resolved.lifecycle).toBe(3);
    });

    test('event_density counts events per chapter', async () => {
      await TruthEvent.bulkCreate([
        { workId, chapterNumber: 1, eventType: 'char_location_change', subjectType: 'character', subjectId: 'hero', payload: {}, eventSequence: 1 },
        { workId, chapterNumber: 1, eventType: 'char_status_change', subjectType: 'character', subjectId: 'hero', payload: {}, eventSequence: 2 },
        { workId, chapterNumber: 2, eventType: 'char_location_change', subjectType: 'character', subjectId: 'hero', payload: {}, eventSequence: 1 },
      ]);

      const density = await temporalTruth.analyzeTrends(workId, 'event_density');
      expect(density.length).toBe(2);
      const ch1 = density.find((d) => d.chapter === 1);
      expect(ch1.eventCount).toBe(2);
    });

    test('unknown metric returns null', async () => {
      const result = await temporalTruth.analyzeTrends(workId, 'unknown_metric');
      expect(result).toBeNull();
    });
  });

  describe('detectAnomalies', () => {
    test('returns empty when max chapter < 3', async () => {
      await TruthEvent.bulkCreate([
        { workId, chapterNumber: 1, eventType: 'char_location_change', subjectType: 'character', subjectId: 'hero', payload: {}, eventSequence: 1 },
        { workId, chapterNumber: 2, eventType: 'char_location_change', subjectType: 'character', subjectId: 'hero', payload: {}, eventSequence: 1 },
      ]);

      const anomalies = await temporalTruth.detectAnomalies(workId);
      expect(anomalies).toEqual([]);
    });

    test('detects character disappearance gap > 5 chapters', async () => {
      await TruthEvent.bulkCreate([
        { workId, chapterNumber: 1, eventType: 'char_location_change', subjectType: 'character', subjectId: 'hero', payload: {}, eventSequence: 1 },
        { workId, chapterNumber: 8, eventType: 'char_location_change', subjectType: 'character', subjectId: 'hero', payload: {}, eventSequence: 1 },
      ]);

      const anomalies = await temporalTruth.detectAnomalies(workId);
      const disappearance = anomalies.find((a) => a.type === 'character_disappearance');
      expect(disappearance).toBeDefined();
      expect(disappearance.subject).toBe('hero');
    });

    test('detects hook backlog > 10 open hooks', async () => {
      await TruthEvent.create({ workId, chapterNumber: 3, eventType: 'char_location_change', subjectType: 'character', subjectId: 'hero', payload: {}, eventSequence: 1 });
      const hooks = Array.from({ length: 12 }, (_, i) => ({
        workId,
        hookId: `h${i}`,
        status: 'open',
        createdChapter: 1,
        description: `hook ${i}`,
        importance: i < 4 ? 'critical' : 'major',
      }));
      await TruthHook.bulkCreate(hooks);

      const anomalies = await temporalTruth.detectAnomalies(workId);
      const backlog = anomalies.find((a) => a.type === 'hook_backlog');
      expect(backlog).toBeDefined();
      expect(backlog.severity).toBe('critical');
    });

    test('detects event burst when chapter exceeds 3x average', async () => {
      // 5 chapters with low density, 1 chapter with high density
      const events = [];
      for (let ch = 1; ch <= 6; ch++) {
        const count = ch === 6 ? 15 : 1;
        for (let i = 0; i < count; i++) {
          events.push({
            workId,
            chapterNumber: ch,
            eventType: 'char_location_change',
            subjectType: 'character',
            subjectId: 'hero',
            payload: {},
            eventSequence: i + 1,
          });
        }
      }
      await TruthEvent.bulkCreate(events);

      const anomalies = await temporalTruth.detectAnomalies(workId);
      const burst = anomalies.find((a) => a.type === 'event_burst');
      expect(burst).toBeDefined();
      expect(burst.chapter).toBe(6);
    });
  });

  describe('initializeTruthFiles', () => {
    test('initializes truth files from work data', async () => {
      await Work.create({ workId, title: 'Test Novel', writingMode: 'novel' });
      await Character.bulkCreate([
        { workId, name: 'hero', goals: 'save the world' },
        { workId, name: 'villain', goals: 'destroy the world' },
      ]);

      const result = await temporalTruth.initializeTruthFiles(workId);
      expect(result.initialized).toBe(true);

      const state = await TruthState.findOne({ where: { workId, chapterNumber: 0 } });
      expect(state).toBeDefined();
      expect(state.characterStates.length).toBe(2);
      expect(fileStore.writeFile).toHaveBeenCalled();
    });

    test('extracts hooks from work outlines', async () => {
      const outlines = {
        detailed: {
          chapters: [
            { number: 1, hooks: [{ description: 'mystery', targetChapter: 5, importance: 'major' }] },
          ],
        },
      };
      await Work.create({ workId, title: 'Test Novel', writingMode: 'novel', outlineDetailed: JSON.stringify(outlines) });
      await Character.create({ workId, name: 'hero' });

      await temporalTruth.initializeTruthFiles(workId);

      const hooks = await TruthHook.findAll({ where: { workId } });
      expect(hooks.length).toBe(1);
      expect(hooks[0].description).toBe('mystery');
    });

    test('throws when work not found', async () => {
      await expect(temporalTruth.initializeTruthFiles('nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('regenerateProjections', () => {
    test('writes projection files when state exists', async () => {
      await TruthState.create({
        workId,
        chapterNumber: 1,
        characterStates: [{ charName: 'hero', location: 'forest', health: 'healthy', mood: 'brave' }],
        worldState: { currentLocation: 'forest', weather: 'sunny' },
      });

      fileStore.writeFile.mockClear();
      await temporalTruth.regenerateProjections(workId);

      expect(fileStore.writeFile).toHaveBeenCalledWith(workId, 'truth/current_state.md', expect.any(String));
      expect(fileStore.writeFile).toHaveBeenCalledWith(workId, 'truth/pending_hooks.md', expect.any(String));
      expect(fileStore.writeFile).toHaveBeenCalledWith(workId, 'truth/resource_ledger.md', expect.any(String));
    });

    test('skips current_state when no state exists', async () => {
      fileStore.writeFile.mockClear();
      await temporalTruth.regenerateProjections(workId);

      expect(fileStore.writeFile).not.toHaveBeenCalledWith(workId, 'truth/current_state.md', expect.any(String));
      expect(fileStore.writeFile).toHaveBeenCalledWith(workId, 'truth/pending_hooks.md', expect.any(String));
      expect(fileStore.writeFile).toHaveBeenCalledWith(workId, 'truth/resource_ledger.md', expect.any(String));
    });
  });

  describe('queryStateAt fallback', () => {
    test('computes state from events when no materialized state', async () => {
      await TruthEvent.bulkCreate([
        { workId, chapterNumber: 1, eventType: 'char_location_change', subjectType: 'character', subjectId: 'hero', payload: { to: 'forest' }, eventSequence: 1 },
        { workId, chapterNumber: 2, eventType: 'char_status_change', subjectType: 'character', subjectId: 'hero', payload: { to: 'injured' }, eventSequence: 1 },
      ]);

      const state = await temporalTruth.queryStateAt(workId, 2, 'character', 'hero');
      expect(state).toBeDefined();
      expect(state.location).toBe('forest');
      expect(state.status).toBe('injured');
    });
  });

  describe('applyEvents edge cases', () => {
    test('handles world_event_start and world_event_end', async () => {
      await TruthEvent.bulkCreate([
        { workId, chapterNumber: 1, eventType: 'world_event_start', subjectType: 'world', subjectId: 'world', payload: { to: 'storm' }, eventSequence: 1 },
        { workId, chapterNumber: 2, eventType: 'world_event_end', subjectType: 'world', subjectId: 'world', payload: { from: 'storm' }, eventSequence: 1 },
      ]);
      await temporalTruth.materializeState(workId, 2);

      const state = await temporalTruth.getCurrentState(workId);
      expect(state.worldState.activeEvents).toEqual([]);
    });

    test('handles char_relationship_change and char_knowledge_gain', async () => {
      await TruthEvent.bulkCreate([
        { workId, chapterNumber: 1, eventType: 'char_location_change', subjectType: 'character', subjectId: 'hero', payload: { to: 'forest' }, eventSequence: 1 },
        { workId, chapterNumber: 1, eventType: 'char_relationship_change', subjectType: 'character', subjectId: 'hero', payload: { withChar: 'villain', type: 'enemy', strength: 'strong' }, eventSequence: 2 },
        { workId, chapterNumber: 1, eventType: 'char_knowledge_gain', subjectType: 'character', subjectId: 'hero', payload: { to: 'secret plan' }, eventSequence: 3 },
      ]);
      await temporalTruth.materializeState(workId, 1);

      const state = await temporalTruth.getCurrentState(workId);
      const hero = state.characterStates.find((c) => c.charName === 'hero');
      expect(hero.relationships).toEqual([{ withChar: 'villain', type: 'enemy', strength: 'strong' }]);
      expect(hero.knownInfo).toContain('secret plan');
    });

    test('handles generic world field changes', async () => {
      await TruthEvent.bulkCreate([
        { workId, chapterNumber: 1, eventType: 'world_political_change', subjectType: 'world', subjectId: 'world', payload: { to: 'war' }, eventSequence: 1 },
        { workId, chapterNumber: 1, eventType: 'world_weather_change', subjectType: 'world', subjectId: 'world', payload: { to: 'rainy' }, eventSequence: 2 },
      ]);
      await temporalTruth.materializeState(workId, 1);

      const state = await temporalTruth.getCurrentState(workId);
      expect(state.worldState.political).toBe('war');
      expect(state.worldState.weather).toBe('rainy');
    });
  });
});
