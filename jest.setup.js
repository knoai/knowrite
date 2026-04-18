/**
 * Jest 全局设置
 * 使用内存 SQLite 进行测试
 */
const path = require('path');

// 重定向数据库到内存模式
process.env.NODE_ENV = 'test';

// 覆盖 models 的 sequelize 配置为内存数据库
jest.mock('./src/models', () => {
  const { Sequelize, DataTypes } = require('sequelize');
  const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: ':memory:',
    logging: false,
  });

  // 重新定义所有模型（简化版，只包含测试需要的字段）
  const Work = sequelize.define('Work', {
    workId: { type: DataTypes.STRING, primaryKey: true },
    topic: DataTypes.TEXT,
    style: DataTypes.STRING,
    platformStyle: DataTypes.STRING,
    authorStyle: DataTypes.STRING,
    strategy: DataTypes.STRING,
    outlineTheme: DataTypes.TEXT,
    outlineDetailed: DataTypes.TEXT,
    writingMode: DataTypes.STRING,
  }, { tableName: 'works', timestamps: true });

  const Chapter = sequelize.define('Chapter', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    workId: DataTypes.STRING,
    number: DataTypes.INTEGER,
    rawFile: DataTypes.STRING,
    finalFile: DataTypes.STRING,
    polishFile: DataTypes.STRING,
    chars: DataTypes.INTEGER,
  }, { tableName: 'chapters', timestamps: false });

  const WorkFile = sequelize.define('WorkFile', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    workId: DataTypes.STRING,
    filename: DataTypes.STRING,
    content: DataTypes.TEXT,
  }, { tableName: 'work_files', timestamps: true });

  const TruthEvent = sequelize.define('TruthEvent', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    workId: DataTypes.STRING,
    chapterNumber: DataTypes.INTEGER,
    eventType: DataTypes.STRING,
    subjectType: DataTypes.STRING,
    subjectId: DataTypes.STRING,
    payload: DataTypes.JSON,
    eventSequence: DataTypes.INTEGER,
  }, { tableName: 'truth_events', timestamps: true });

  const TruthState = sequelize.define('TruthState', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    workId: DataTypes.STRING,
    chapterNumber: DataTypes.INTEGER,
    characterStates: DataTypes.JSON,
    worldState: DataTypes.JSON,
    emotionalArcs: DataTypes.JSON,
    isMaterialized: DataTypes.BOOLEAN,
  }, { tableName: 'truth_states', timestamps: true });

  const TruthHook = sequelize.define('TruthHook', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    workId: DataTypes.STRING,
    hookId: DataTypes.STRING,
    status: DataTypes.STRING,
    resolvedChapter: DataTypes.INTEGER,
    importance: { type: DataTypes.INTEGER, defaultValue: 5 },
    createdChapter: DataTypes.INTEGER,
    description: DataTypes.TEXT,
    targetChapter: DataTypes.INTEGER,
  }, { tableName: 'truth_hooks', timestamps: true });

  const TruthResource = sequelize.define('TruthResource', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    workId: DataTypes.STRING,
    name: DataTypes.STRING,
    owner: DataTypes.STRING,
    quantity: DataTypes.INTEGER,
    status: { type: DataTypes.STRING, defaultValue: 'active' },
    transferHistory: DataTypes.JSON,
    consumedChapter: DataTypes.INTEGER,
    lostChapter: DataTypes.INTEGER,
  }, { tableName: 'truth_resources', timestamps: true });

  const AuthorIntent = sequelize.define('AuthorIntent', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    workId: { type: DataTypes.STRING, unique: true },
    longTermVision: DataTypes.TEXT,
    themes: DataTypes.JSON,
    constraints: DataTypes.JSON,
    mustKeep: DataTypes.TEXT,
    mustAvoid: DataTypes.TEXT,
  }, { tableName: 'author_intents', timestamps: true });

  const CurrentFocus = sequelize.define('CurrentFocus', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    workId: DataTypes.STRING,
    focusText: DataTypes.TEXT,
    targetChapters: DataTypes.INTEGER,
    isActive: DataTypes.BOOLEAN,
    priority: DataTypes.INTEGER,
  }, { tableName: 'current_focuses', timestamps: true });

  const ChapterIntent = sequelize.define('ChapterIntent', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    workId: DataTypes.STRING,
    chapterNumber: DataTypes.INTEGER,
    mustKeep: DataTypes.TEXT,
    mustAvoid: DataTypes.TEXT,
    sceneBeats: DataTypes.JSON,
    conflictResolution: DataTypes.TEXT,
    emotionalGoal: DataTypes.TEXT,
    ruleStack: DataTypes.JSON,
    plannedAt: DataTypes.DATE,
    composedAt: DataTypes.DATE,
  }, { tableName: 'chapter_intents', timestamps: true });

  const OutputQueue = sequelize.define('OutputQueue', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    workId: DataTypes.STRING,
    chapterNumber: DataTypes.INTEGER,
    status: DataTypes.STRING,
    priority: DataTypes.INTEGER,
    fitnessScore: DataTypes.FLOAT,
    enqueuedAt: DataTypes.DATE,
    l1Result: DataTypes.JSON,
    l2Result: DataTypes.JSON,
    humanReview: DataTypes.JSON,
    releasedAt: DataTypes.DATE,
    releasedBy: DataTypes.STRING,
  }, { tableName: 'output_queues', timestamps: true });

  const OutputValidationRule = sequelize.define('OutputValidationRule', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: DataTypes.STRING,
    level: DataTypes.STRING,
    category: DataTypes.STRING,
    condition: DataTypes.JSON,
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
    action: { type: DataTypes.STRING, defaultValue: 'warn' },
  }, { tableName: 'output_validation_rules', timestamps: true });

  const AuthorFingerprint = sequelize.define('AuthorFingerprint', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: DataTypes.STRING,
    description: DataTypes.TEXT,
    narrativeLayer: DataTypes.JSON,
    characterLayer: DataTypes.JSON,
    plotLayer: DataTypes.JSON,
    languageLayer: DataTypes.JSON,
    worldLayer: DataTypes.JSON,
    sampleParagraphs: DataTypes.JSON,
  }, { tableName: 'author_fingerprints', timestamps: true });

  const WorkStyleLink = sequelize.define('WorkStyleLink', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    workId: DataTypes.STRING,
    fingerprintId: DataTypes.INTEGER,
    isActive: DataTypes.BOOLEAN,
    priority: DataTypes.INTEGER,
  }, { tableName: 'work_style_links', timestamps: true });

  const Embedding = sequelize.define('Embedding', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    workId: { type: DataTypes.STRING, allowNull: false },
    chapterNumber: DataTypes.INTEGER,
    sourceType: { type: DataTypes.STRING, allowNull: false },
    sourceId: DataTypes.STRING,
    content: DataTypes.TEXT,
    embedding: DataTypes.TEXT,
    model: DataTypes.STRING,
  }, {
    tableName: 'embeddings',
    timestamps: true,
    indexes: [
      { fields: ['workId'] },
      { fields: ['workId', 'sourceType'] },
      { unique: true, fields: ['workId', 'sourceType', 'sourceId'] },
    ],
  });

  const Setting = sequelize.define('Setting', {
    key: { type: DataTypes.STRING, primaryKey: true },
    value: { type: DataTypes.TEXT, defaultValue: '{}' },
  }, { tableName: 'settings', timestamps: true });

  const WorldLore = sequelize.define('WorldLore', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    workId: DataTypes.STRING,
    category: { type: DataTypes.STRING, defaultValue: '其他' },
    title: DataTypes.STRING,
    content: DataTypes.TEXT,
    tags: DataTypes.JSON,
    importance: { type: DataTypes.INTEGER, defaultValue: 3 },
  }, { tableName: 'world_lore', timestamps: true });

  const Character = sequelize.define('Character', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    workId: DataTypes.STRING,
    name: DataTypes.STRING,
    alias: DataTypes.STRING,
    roleType: { type: DataTypes.STRING, defaultValue: '配角' },
    status: { type: DataTypes.STRING, defaultValue: '存活' },
    appearance: DataTypes.TEXT,
    personality: DataTypes.TEXT,
    goals: DataTypes.TEXT,
    background: DataTypes.TEXT,
  }, { tableName: 'characters', timestamps: true });

  const CharacterRelation = sequelize.define('CharacterRelation', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    workId: DataTypes.STRING,
    fromCharId: DataTypes.INTEGER,
    toCharId: DataTypes.INTEGER,
    relationType: { type: DataTypes.STRING, defaultValue: '其他' },
    description: DataTypes.TEXT,
    strength: { type: DataTypes.INTEGER, defaultValue: 5 },
    bidirectional: { type: DataTypes.BOOLEAN, defaultValue: false },
  }, { tableName: 'character_relations', timestamps: true });

  const PlotLine = sequelize.define('PlotLine', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    workId: DataTypes.STRING,
    name: DataTypes.STRING,
    type: { type: DataTypes.STRING, defaultValue: '主线' },
    status: { type: DataTypes.STRING, defaultValue: '进行中' },
  }, { tableName: 'plot_lines', timestamps: true });

  const PlotNode = sequelize.define('PlotNode', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    workId: DataTypes.STRING,
    plotLineId: DataTypes.INTEGER,
    chapterNumber: DataTypes.INTEGER,
    title: DataTypes.STRING,
    description: DataTypes.TEXT,
    nodeType: { type: DataTypes.STRING, defaultValue: '发展' },
    position: { type: DataTypes.INTEGER, defaultValue: 0 },
    status: { type: DataTypes.STRING, defaultValue: '待展开' },
  }, { tableName: 'plot_nodes', timestamps: true });

  const MapRegion = sequelize.define('MapRegion', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    workId: DataTypes.STRING,
    name: DataTypes.STRING,
    regionType: { type: DataTypes.STRING, defaultValue: '城市' },
    parentId: DataTypes.INTEGER,
    description: DataTypes.TEXT,
  }, { tableName: 'map_regions', timestamps: true });

  const MapConnection = sequelize.define('MapConnection', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    workId: DataTypes.STRING,
    fromRegionId: DataTypes.INTEGER,
    toRegionId: DataTypes.INTEGER,
    connType: { type: DataTypes.STRING, defaultValue: '道路' },
    description: DataTypes.TEXT,
    travelTime: DataTypes.STRING,
  }, { tableName: 'map_connections', timestamps: true });

  const StoryTemplate = sequelize.define('StoryTemplate', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    scope: { type: DataTypes.STRING, defaultValue: 'global' },
    workId: DataTypes.STRING,
    name: DataTypes.STRING,
    category: { type: DataTypes.STRING, defaultValue: '其他' },
    description: DataTypes.TEXT,
    beatStructure: DataTypes.JSON,
  }, { tableName: 'story_templates', timestamps: true });

  const WorkTemplateLink = sequelize.define('WorkTemplateLink', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    workId: DataTypes.STRING,
    templateId: DataTypes.INTEGER,
  }, { tableName: 'work_template_links', timestamps: true });

  // 基础关联
  Work.hasMany(Chapter, { foreignKey: 'workId' });
  PlotLine.hasMany(PlotNode, { as: 'nodes', foreignKey: 'plotLineId' });
  PlotNode.belongsTo(PlotLine, { as: 'plotLine', foreignKey: 'plotLineId' });

  let initialized = false;
  async function initDb() {
    if (initialized) return;
    await sequelize.sync({ force: true });
    initialized = true;
  }

  return {
    sequelize,
    initDb,
    Work, Chapter, WorkFile,
    TruthEvent, TruthState, TruthHook, TruthResource,
    AuthorIntent, CurrentFocus, ChapterIntent,
    OutputQueue, OutputValidationRule,
    AuthorFingerprint, WorkStyleLink,
    Embedding, Setting,
    WorldLore, Character, CharacterRelation,
    PlotLine, PlotNode, MapRegion, MapConnection,
    StoryTemplate, WorkTemplateLink,
  };
});
