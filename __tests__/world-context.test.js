const worldContext = require('../src/services/world-context');
const {
  initDb,
  WorldLore,
  Character,
  CharacterRelation,
  PlotLine,
  PlotNode,
  MapRegion,
  MapConnection,
  StoryTemplate,
  WorkTemplateLink,
} = require('../src/models');

describe('world-context', () => {
  const workId = 'test-work-world';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await WorldLore.destroy({ where: { workId } });
    await Character.destroy({ where: { workId } });
    await CharacterRelation.destroy({ where: { workId } });
    await PlotLine.destroy({ where: { workId } });
    await PlotNode.destroy({ where: { workId } });
    await MapRegion.destroy({ where: { workId } });
    await MapConnection.destroy({ where: { workId } });
    await WorkTemplateLink.destroy({ where: { workId } });
    await StoryTemplate.destroy({ where: { workId: null } });
  });

  test('buildWorldContext returns empty string when no data', async () => {
    const ctx = await worldContext.buildWorldContext(workId);
    expect(ctx).toBe('');
  });

  test('buildWorldContext includes lore items', async () => {
    await WorldLore.create({ workId, category: 'magic', title: 'Mana', content: 'Magic energy', importance: 5 });
    await WorldLore.create({ workId, category: 'magic', title: 'Spells', content: 'Spell system', importance: 3 });

    const ctx = await worldContext.buildWorldContext(workId);
    expect(ctx).toContain('世界观设定');
    expect(ctx).toContain('Mana');
    expect(ctx).toContain('Magic energy');
    expect(ctx).toContain('（重要）'); // importance >= 4
  });

  test('buildWorldContext includes characters and relations', async () => {
    const hero = await Character.create({ workId, name: 'Hero', roleType: '主角', personality: 'brave', goals: 'save world' });
    const villain = await Character.create({ workId, name: 'Villain', roleType: '反派', status: '逃亡' });
    await CharacterRelation.create({ workId, fromCharId: hero.id, toCharId: villain.id, relationType: '敌对', strength: 9, description: '宿敌' });

    const ctx = await worldContext.buildWorldContext(workId);
    expect(ctx).toContain('人物设定');
    expect(ctx).toContain('【主角】 Hero');
    expect(ctx).toContain('【反派】 Villain [状态：逃亡]');
    expect(ctx).toContain('性格：brave');
    expect(ctx).toContain('目标：save world');
    expect(ctx).toContain('人物关系');
    expect(ctx).toContain('Hero → Villain：敌对（强度9），宿敌');
  });

  test('buildWorldContext includes plot lines and nodes', async () => {
    const line = await PlotLine.create({ workId, name: 'Main Quest', type: '主线' });
    await PlotNode.create({ workId, plotLineId: line.id, title: 'Start', position: 0, nodeType: '开端', status: '已完成', chapterNumber: 1 });
    await PlotNode.create({ workId, plotLineId: line.id, title: 'Battle', position: 1, nodeType: '高潮', chapterNumber: 5 });

    const ctx = await worldContext.buildWorldContext(workId);
    expect(ctx).toContain('剧情线');
    expect(ctx).toContain('主线「Main Quest」');
    expect(ctx).toContain('[开端] Start(第1章) [已完成]');
    expect(ctx).toContain('[高潮] Battle(第5章)');
  });

  test('buildWorldContext includes map regions and connections', async () => {
    const kingdom = await MapRegion.create({ workId, name: 'Kingdom', regionType: '国家', description: 'Main kingdom' });
    const village = await MapRegion.create({ workId, name: 'Village', regionType: '村庄', parentId: kingdom.id });
    await MapConnection.create({ workId, fromRegionId: kingdom.id, toRegionId: village.id, connType: '道路', travelTime: '2天' });

    const ctx = await worldContext.buildWorldContext(workId);
    expect(ctx).toContain('地图');
    expect(ctx).toContain('Kingdom（国家）');
    expect(ctx).toContain('Village（村庄）[隶属于 Kingdom]');
    expect(ctx).toContain('区域连接');
    expect(ctx).toContain('Kingdom → Village：道路（耗时：2天）');
  });

  test('buildWorldContext includes story templates', async () => {
    const template = await StoryTemplate.create({ scope: 'global', name: 'Hero Journey', category: '经典', description: 'Classic hero arc', beatStructure: [{ beat: 'Call', chapters: 2 }] });
    await WorkTemplateLink.create({ workId, templateId: template.id });

    const ctx = await worldContext.buildWorldContext(workId);
    expect(ctx).toContain('套路模版');
    expect(ctx).toContain('经典「Hero Journey」');
    expect(ctx).toContain('Classic hero arc');
    expect(ctx).toContain('[Call] 约2章');
  });

  test('buildWorldContext truncates when exceeding maxChars', async () => {
    for (let i = 0; i < 20; i++) {
      await WorldLore.create({ workId, category: 'test', title: `Lore${i}`, content: 'A'.repeat(500), importance: 3 });
    }

    const ctx = await worldContext.buildWorldContext(workId, { maxChars: 1000 });
    expect(ctx.length).toBeLessThanOrEqual(1100); // some margin
    expect(ctx).toContain('[上下文过长，已截断]');
  });

  test('getWorldContextForPrompt uses default limits', async () => {
    await WorldLore.create({ workId, category: 'magic', title: 'Mana', content: 'Magic energy', importance: 5 });
    const ctx = await worldContext.getWorldContextForPrompt(workId, 1);
    expect(ctx).toContain('Mana');
  });
});
