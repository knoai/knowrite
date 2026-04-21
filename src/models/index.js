const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, '../../data/novel.db'),
  logging: process.env.NODE_ENV === 'development' ? console.log : false,
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
});

const Work = sequelize.define('Work', {
  workId: { type: DataTypes.STRING, primaryKey: true },
  topic: { type: DataTypes.TEXT, allowNull: false },
  style: { type: DataTypes.STRING, defaultValue: '' },
  platformStyle: { type: DataTypes.STRING, defaultValue: '' },
  authorStyle: { type: DataTypes.STRING, defaultValue: '' },
  strategy: { type: DataTypes.STRING, defaultValue: 'pipeline' },
  outlineTheme: { type: DataTypes.TEXT, defaultValue: '' },
  outlineDetailed: { type: DataTypes.TEXT, defaultValue: '' },
  outlineMultivolume: { type: DataTypes.TEXT, defaultValue: '' },
  currentVolume: { type: DataTypes.INTEGER, defaultValue: 1 },
  reviews: { type: DataTypes.JSON, defaultValue: {} },
  fitness: { type: DataTypes.JSON, defaultValue: {} },
  writingMode: { type: DataTypes.STRING, defaultValue: null },
  language: { type: DataTypes.STRING, defaultValue: 'zh' },
  status: { type: DataTypes.STRING, defaultValue: 'idle' },
  pausedAtStep: { type: DataTypes.STRING, defaultValue: '' },
}, {
  tableName: 'works',
  timestamps: true,
  updatedAt: 'updatedAt',
  createdAt: 'createdAt',
});

const Volume = sequelize.define('Volume', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  workId: { type: DataTypes.STRING, allowNull: false },
  number: { type: DataTypes.INTEGER, allowNull: false },
  title: { type: DataTypes.STRING, defaultValue: '' },
  outlineFile: { type: DataTypes.STRING, defaultValue: '' },
  chapterRange: { type: DataTypes.JSON, defaultValue: [] },
  status: { type: DataTypes.STRING, defaultValue: 'outlined' },
}, {
  tableName: 'volumes',
  timestamps: false,
  indexes: [{ unique: true, fields: ['workId', 'number'] }],
});

const Chapter = sequelize.define('Chapter', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  workId: { type: DataTypes.STRING, allowNull: false },
  number: { type: DataTypes.INTEGER, allowNull: false },
  rawFile: { type: DataTypes.STRING, defaultValue: '' },
  editedFile: { type: DataTypes.STRING, defaultValue: '' },
  humanizedFile: { type: DataTypes.STRING, defaultValue: '' },
  finalFile: { type: DataTypes.STRING, defaultValue: '' },
  polishFile: { type: DataTypes.STRING, defaultValue: '' },
  feedbackFile: { type: DataTypes.STRING, defaultValue: '' },
  summaryFile: { type: DataTypes.STRING, defaultValue: '' },
  editFile: { type: DataTypes.STRING, defaultValue: '' },
  repetitionRepairedFile: { type: DataTypes.STRING, defaultValue: '' },
  chars: { type: DataTypes.INTEGER, defaultValue: 0 },
  models: { type: DataTypes.JSON, defaultValue: {} },
}, {
  tableName: 'chapters',
  timestamps: false,
  indexes: [{ unique: true, fields: ['workId', 'number'] }],
});

const WorkFile = sequelize.define('WorkFile', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  workId: { type: DataTypes.STRING, allowNull: false },
  filename: { type: DataTypes.STRING, allowNull: false },
  content: { type: DataTypes.TEXT, defaultValue: '' },
}, {
  tableName: 'work_files',
  timestamps: true,
  updatedAt: 'updatedAt',
  createdAt: 'createdAt',
  indexes: [
    { unique: true, fields: ['workId', 'filename'] },
    { fields: ['workId'] },
  ],
});

Work.hasMany(Volume, { foreignKey: 'workId', sourceKey: 'workId', as: 'volumes' });
Work.hasMany(Chapter, { foreignKey: 'workId', sourceKey: 'workId', as: 'chapters' });
Work.hasMany(WorkFile, { foreignKey: 'workId', sourceKey: 'workId', as: 'files' });

const Setting = sequelize.define('Setting', {
  key: { type: DataTypes.STRING, primaryKey: true },
  value: { type: DataTypes.TEXT, defaultValue: '{}' },
}, {
  tableName: 'settings',
  timestamps: true,
  updatedAt: 'updatedAt',
  createdAt: 'createdAt',
});

const Prompt = sequelize.define('Prompt', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
  lang: { type: DataTypes.STRING, defaultValue: 'zh' },
  content: { type: DataTypes.TEXT, defaultValue: '' },
}, {
  tableName: 'prompts',
  timestamps: true,
  updatedAt: 'updatedAt',
  createdAt: 'createdAt',
  indexes: [
    { unique: true, fields: ['name', 'lang'] },
    { fields: ['name'] },
  ],
});

// ==================== 五大创作辅助模块模型 ====================

// 1. 世界观记忆库
const WorldLore = sequelize.define('WorldLore', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  workId: { type: DataTypes.STRING, allowNull: false },
  category: { type: DataTypes.STRING, allowNull: false, defaultValue: '其他' },
  title: { type: DataTypes.STRING, allowNull: false },
  content: { type: DataTypes.TEXT, defaultValue: '' },
  tags: { type: DataTypes.JSON, defaultValue: [] },
  importance: { type: DataTypes.INTEGER, defaultValue: 3 },
}, {
  tableName: 'world_lore',
  timestamps: true,
  updatedAt: 'updatedAt',
  createdAt: 'createdAt',
  indexes: [
    { fields: ['workId'] },
    { fields: ['workId', 'category'] },
  ],
});

Work.hasMany(WorldLore, { foreignKey: 'workId', sourceKey: 'workId', as: 'worldLore' });

// 2. 人物
const Character = sequelize.define('Character', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  workId: { type: DataTypes.STRING, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  alias: { type: DataTypes.STRING, defaultValue: '' },
  roleType: { type: DataTypes.STRING, defaultValue: '配角' },
  status: { type: DataTypes.STRING, defaultValue: '存活' },
  appearance: { type: DataTypes.TEXT, defaultValue: '' },
  personality: { type: DataTypes.TEXT, defaultValue: '' },
  goals: { type: DataTypes.TEXT, defaultValue: '' },
  background: { type: DataTypes.TEXT, defaultValue: '' },
  notes: { type: DataTypes.TEXT, defaultValue: '' },
  voiceFingerprint: { type: DataTypes.JSON, allowNull: true },
}, {
  tableName: 'characters',
  timestamps: true,
  updatedAt: 'updatedAt',
  createdAt: 'createdAt',
  indexes: [{ fields: ['workId'] }],
});

Work.hasMany(Character, { foreignKey: 'workId', sourceKey: 'workId', as: 'characters' });

// 3. 人物关系
const CharacterRelation = sequelize.define('CharacterRelation', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  workId: { type: DataTypes.STRING, allowNull: false },
  fromCharId: { type: DataTypes.INTEGER, allowNull: false },
  toCharId: { type: DataTypes.INTEGER, allowNull: false },
  relationType: { type: DataTypes.STRING, allowNull: false, defaultValue: '其他' },
  description: { type: DataTypes.TEXT, defaultValue: '' },
  strength: { type: DataTypes.INTEGER, defaultValue: 5 },
  bidirectional: { type: DataTypes.BOOLEAN, defaultValue: false },
}, {
  tableName: 'character_relations',
  timestamps: true,
  updatedAt: 'updatedAt',
  createdAt: 'createdAt',
  indexes: [
    { fields: ['workId'] },
    { fields: ['fromCharId'] },
    { fields: ['toCharId'] },
  ],
});

Work.hasMany(CharacterRelation, { foreignKey: 'workId', sourceKey: 'workId', as: 'characterRelations' });

// 角色专属记忆（Episodic Memory）
const CharacterMemory = sequelize.define('CharacterMemory', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  workId: { type: DataTypes.STRING, allowNull: false },
  charName: { type: DataTypes.STRING, allowNull: false },
  chapterNumber: { type: DataTypes.INTEGER, allowNull: false },
  episodeType: { type: DataTypes.STRING, defaultValue: 'event' },
  // event, dialogue, relationship_change, emotional_turn, goal_progress, knowledge_gain
  content: { type: DataTypes.TEXT, allowNull: false },
  importance: { type: DataTypes.INTEGER, defaultValue: 3 },
  tags: { type: DataTypes.JSON, defaultValue: [] },
  sourceText: { type: DataTypes.TEXT, allowNull: true },
}, {
  tableName: 'character_memories',
  timestamps: true,
  updatedAt: 'updatedAt',
  createdAt: 'createdAt',
  indexes: [
    { fields: ['workId', 'charName'] },
    { fields: ['workId', 'charName', 'chapterNumber'] },
    { fields: ['workId'] },
  ],
});

Work.hasMany(CharacterMemory, { foreignKey: 'workId', sourceKey: 'workId', as: 'characterMemories' });

// 4. 剧情线
const PlotLine = sequelize.define('PlotLine', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  workId: { type: DataTypes.STRING, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  type: { type: DataTypes.STRING, defaultValue: '主线' },
  status: { type: DataTypes.STRING, defaultValue: '进行中' },
  color: { type: DataTypes.STRING, defaultValue: '#3b82f6' },
}, {
  tableName: 'plot_lines',
  timestamps: true,
  updatedAt: 'updatedAt',
  createdAt: 'createdAt',
  indexes: [{ fields: ['workId'] }],
});

Work.hasMany(PlotLine, { foreignKey: 'workId', sourceKey: 'workId', as: 'plotLines' });

// 5. 剧情节点
const PlotNode = sequelize.define('PlotNode', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  workId: { type: DataTypes.STRING, allowNull: false },
  plotLineId: { type: DataTypes.INTEGER, allowNull: false },
  chapterNumber: { type: DataTypes.INTEGER, defaultValue: null },
  title: { type: DataTypes.STRING, defaultValue: '' },
  description: { type: DataTypes.TEXT, defaultValue: '' },
  nodeType: { type: DataTypes.STRING, defaultValue: '发展' },
  position: { type: DataTypes.INTEGER, defaultValue: 0 },
  status: { type: DataTypes.STRING, defaultValue: '待展开' },
}, {
  tableName: 'plot_nodes',
  timestamps: true,
  updatedAt: 'updatedAt',
  createdAt: 'createdAt',
  indexes: [
    { fields: ['workId'] },
    { fields: ['plotLineId'] },
    { fields: ['workId', 'chapterNumber'] },
  ],
});

PlotLine.hasMany(PlotNode, { foreignKey: 'plotLineId', as: 'nodes' });
Work.hasMany(PlotNode, { foreignKey: 'workId', sourceKey: 'workId', as: 'plotNodes' });

// 6. 地图区域
const MapRegion = sequelize.define('MapRegion', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  workId: { type: DataTypes.STRING, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  regionType: { type: DataTypes.STRING, defaultValue: '城市' },
  parentId: { type: DataTypes.INTEGER, defaultValue: null },
  description: { type: DataTypes.TEXT, defaultValue: '' },
  coordinates: { type: DataTypes.JSON, defaultValue: null },
  tags: { type: DataTypes.JSON, defaultValue: [] },
}, {
  tableName: 'map_regions',
  timestamps: true,
  updatedAt: 'updatedAt',
  createdAt: 'createdAt',
  indexes: [{ fields: ['workId'] }],
});

Work.hasMany(MapRegion, { foreignKey: 'workId', sourceKey: 'workId', as: 'mapRegions' });

// 7. 区域连接
const MapConnection = sequelize.define('MapConnection', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  workId: { type: DataTypes.STRING, allowNull: false },
  fromRegionId: { type: DataTypes.INTEGER, allowNull: false },
  toRegionId: { type: DataTypes.INTEGER, allowNull: false },
  connType: { type: DataTypes.STRING, defaultValue: '道路' },
  description: { type: DataTypes.TEXT, defaultValue: '' },
  travelTime: { type: DataTypes.STRING, defaultValue: '' },
}, {
  tableName: 'map_connections',
  timestamps: true,
  updatedAt: 'updatedAt',
  createdAt: 'createdAt',
  indexes: [
    { fields: ['workId'] },
    { fields: ['fromRegionId'] },
    { fields: ['toRegionId'] },
  ],
});

Work.hasMany(MapConnection, { foreignKey: 'workId', sourceKey: 'workId', as: 'mapConnections' });

// 8. 套路模版（全局+作品级）
const StoryTemplate = sequelize.define('StoryTemplate', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  scope: { type: DataTypes.STRING, defaultValue: 'global' },
  workId: { type: DataTypes.STRING, defaultValue: null },
  name: { type: DataTypes.STRING, allowNull: false },
  category: { type: DataTypes.STRING, defaultValue: '其他' },
  description: { type: DataTypes.TEXT, defaultValue: '' },
  beatStructure: { type: DataTypes.JSON, defaultValue: [] },
  exampleWorks: { type: DataTypes.TEXT, defaultValue: '' },
  tags: { type: DataTypes.JSON, defaultValue: [] },
}, {
  tableName: 'story_templates',
  timestamps: true,
  updatedAt: 'updatedAt',
  createdAt: 'createdAt',
  indexes: [
    { fields: ['scope'] },
    { fields: ['workId'] },
  ],
});

// 9. 作品-套路关联
const WorkTemplateLink = sequelize.define('WorkTemplateLink', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  workId: { type: DataTypes.STRING, allowNull: false },
  templateId: { type: DataTypes.INTEGER, allowNull: false },
}, {
  tableName: 'work_template_links',
  timestamps: true,
  updatedAt: 'updatedAt',
  createdAt: 'createdAt',
  indexes: [
    { unique: true, fields: ['workId', 'templateId'] },
    { fields: ['workId'] },
    { fields: ['templateId'] },
  ],
});

Work.belongsToMany(StoryTemplate, { through: WorkTemplateLink, foreignKey: 'workId', as: 'linkedTemplates' });
StoryTemplate.belongsToMany(Work, { through: WorkTemplateLink, foreignKey: 'templateId', as: 'linkedWorks' });

// 10. 向量嵌入（RAG 检索用）
const Embedding = sequelize.define('Embedding', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  workId: { type: DataTypes.STRING, allowNull: false },
  chapterNumber: { type: DataTypes.INTEGER, defaultValue: null },
  sourceType: { type: DataTypes.STRING, allowNull: false },
  sourceId: { type: DataTypes.STRING, defaultValue: '' },
  content: { type: DataTypes.TEXT, defaultValue: '' },
  embedding: { type: DataTypes.TEXT, defaultValue: '' },
  model: { type: DataTypes.STRING, defaultValue: '' },
}, {
  tableName: 'embeddings',
  timestamps: true,
  updatedAt: 'updatedAt',
  createdAt: 'createdAt',
  indexes: [
    { fields: ['workId'] },
    { fields: ['workId', 'sourceType'] },
    { unique: true, fields: ['workId', 'sourceType', 'sourceId'] },
  ],
});

Work.hasMany(Embedding, { foreignKey: 'workId', sourceKey: 'workId', as: 'embeddings' });

// ==================== 时序真相数据库模型 ====================

// 1. 真相事件流（不可变）
const TruthEvent = sequelize.define('TruthEvent', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  workId: { type: DataTypes.STRING, allowNull: false },
  chapterNumber: { type: DataTypes.INTEGER, allowNull: false },
  eventSequence: { type: DataTypes.INTEGER, allowNull: false },
  eventType: {
    type: DataTypes.STRING, allowNull: false,
    // char_location_change, char_health_change, char_mood_change,
    // char_relationship_change, char_knowledge_gain, char_goal_change,
    // world_location_change, world_event_start, world_event_end, world_weather_change,
    // hook_created, hook_progressed, hook_resolved, hook_abandoned,
    // resource_acquired, resource_consumed, resource_transferred, resource_lost
  },
  subjectType: { type: DataTypes.STRING, allowNull: false },
  subjectId: { type: DataTypes.STRING, allowNull: false },
  payload: { type: DataTypes.JSON, allowNull: false },
  sourceChapter: { type: DataTypes.INTEGER, allowNull: false },
  sourceText: { type: DataTypes.TEXT, allowNull: true },
  extractedBy: { type: DataTypes.STRING, defaultValue: 'summarizer' },
  confidence: { type: DataTypes.FLOAT, defaultValue: 1.0 },
}, {
  tableName: 'truth_events',
  timestamps: true,
  updatedAt: false,
  createdAt: 'createdAt',
  indexes: [
    { fields: ['workId', 'chapterNumber', 'eventSequence'] },
    { fields: ['workId', 'subjectType', 'subjectId'] },
    { fields: ['workId', 'eventType'] },
    { fields: ['workId', 'chapterNumber'] },
    { fields: ['workId'] },
  ],
});

Work.hasMany(TruthEvent, { foreignKey: 'workId', sourceKey: 'workId', as: 'truthEvents' });

// 2. 真相状态（物化视图，从事件流计算）
const TruthState = sequelize.define('TruthState', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  workId: { type: DataTypes.STRING, allowNull: false },
  chapterNumber: { type: DataTypes.INTEGER, allowNull: false },
  characterStates: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
  worldState: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
  emotionalArcs: { type: DataTypes.JSON, allowNull: true, defaultValue: [] },
  isMaterialized: { type: DataTypes.BOOLEAN, defaultValue: true },
  lastEventId: { type: DataTypes.INTEGER, allowNull: true },
  computedAt: { type: DataTypes.DATE, allowNull: true },
  statsSnapshot: { type: DataTypes.JSON, allowNull: true },
}, {
  tableName: 'truth_states',
  timestamps: true,
  updatedAt: 'updatedAt',
  createdAt: 'createdAt',
  indexes: [
    { fields: ['workId', 'chapterNumber'], unique: true },
    { fields: ['workId'] },
  ],
});

Work.hasMany(TruthState, { foreignKey: 'workId', sourceKey: 'workId', as: 'truthStates' });

// 3. 伏笔追踪
const TruthHook = sequelize.define('TruthHook', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  workId: { type: DataTypes.STRING, allowNull: false },
  hookId: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: false },
  type: { type: DataTypes.STRING, defaultValue: 'foreshadow' },
  createdChapter: { type: DataTypes.INTEGER, allowNull: false },
  targetChapter: { type: DataTypes.INTEGER, allowNull: true },
  resolvedChapter: { type: DataTypes.INTEGER, allowNull: true },
  status: { type: DataTypes.STRING, defaultValue: 'open' },
  importance: { type: DataTypes.STRING, defaultValue: 'major' },
  relatedCharacters: { type: DataTypes.JSON, defaultValue: [] },
  notes: { type: DataTypes.TEXT, allowNull: true },
}, {
  tableName: 'truth_hooks',
  timestamps: true,
  updatedAt: 'updatedAt',
  createdAt: 'createdAt',
  indexes: [
    { fields: ['workId', 'hookId'], unique: true },
    { fields: ['workId', 'status'] },
    { fields: ['workId'] },
  ],
});

Work.hasMany(TruthHook, { foreignKey: 'workId', sourceKey: 'workId', as: 'truthHooks' });

// 4. 资源追踪
const TruthResource = sequelize.define('TruthResource', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  workId: { type: DataTypes.STRING, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  category: { type: DataTypes.STRING, allowNull: true },
  owner: { type: DataTypes.STRING, allowNull: true },
  quantity: { type: DataTypes.INTEGER, defaultValue: 1 },
  description: { type: DataTypes.TEXT, allowNull: true },
  acquiredChapter: { type: DataTypes.INTEGER, allowNull: true },
  consumedChapter: { type: DataTypes.INTEGER, allowNull: true },
  lostChapter: { type: DataTypes.INTEGER, allowNull: true },
  status: { type: DataTypes.STRING, defaultValue: 'active' },
  transferHistory: { type: DataTypes.JSON, defaultValue: [] },
}, {
  tableName: 'truth_resources',
  timestamps: true,
  updatedAt: 'updatedAt',
  createdAt: 'createdAt',
  indexes: [
    { fields: ['workId', 'name'] },
    { fields: ['workId', 'status'] },
    { fields: ['workId'] },
  ],
});

Work.hasMany(TruthResource, { foreignKey: 'workId', sourceKey: 'workId', as: 'truthResources' });

// ==================== Phase 2: 全维度作者指纹 ====================

const AuthorFingerprint = sequelize.define('AuthorFingerprint', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  narrativeLayer: { type: DataTypes.JSON, allowNull: true },
  characterLayer: { type: DataTypes.JSON, allowNull: true },
  plotLayer: { type: DataTypes.JSON, allowNull: true },
  languageLayer: { type: DataTypes.JSON, allowNull: true },
  worldLayer: { type: DataTypes.JSON, allowNull: true },
  sampleParagraphs: { type: DataTypes.JSON, defaultValue: [] },
  styleGuide: { type: DataTypes.TEXT, allowNull: true },
}, {
  tableName: 'author_fingerprints',
  timestamps: true,
  updatedAt: 'updatedAt',
  createdAt: 'createdAt',
  indexes: [{ fields: ['name'] }],
});

const WorkStyleLink = sequelize.define('WorkStyleLink', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  workId: { type: DataTypes.STRING, allowNull: false },
  fingerprintId: { type: DataTypes.INTEGER, allowNull: false },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
  priority: { type: DataTypes.INTEGER, defaultValue: 1 },
}, {
  tableName: 'work_style_links',
  timestamps: true,
  updatedAt: 'updatedAt',
  createdAt: 'createdAt',
  indexes: [
    { fields: ['workId', 'fingerprintId'], unique: true },
    { fields: ['workId'] },
  ],
});

Work.hasMany(WorkStyleLink, { foreignKey: 'workId', sourceKey: 'workId', as: 'styleLinks' });

// ==================== Phase 3: 输出治理 ====================

const OutputQueue = sequelize.define('OutputQueue', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  workId: { type: DataTypes.STRING, allowNull: false },
  chapterNumber: { type: DataTypes.INTEGER, allowNull: false },
  enqueuedAt: { type: DataTypes.DATE, allowNull: false },
  priority: { type: DataTypes.INTEGER, defaultValue: 5 },
  fitnessScore: { type: DataTypes.FLOAT, allowNull: true },
  status: { type: DataTypes.STRING, defaultValue: 'pending' },
  // pending / l1_validating / l1_failed / l2_validating / l2_failed / human_reviewing / human_rejected / released
  l1Result: { type: DataTypes.JSON, allowNull: true },
  l2Result: { type: DataTypes.JSON, allowNull: true },
  humanReview: { type: DataTypes.JSON, allowNull: true },
  releasedAt: { type: DataTypes.DATE, allowNull: true },
  releasedBy: { type: DataTypes.STRING, allowNull: true },
}, {
  tableName: 'output_queue',
  timestamps: true,
  updatedAt: 'updatedAt',
  createdAt: 'createdAt',
  indexes: [
    { fields: ['workId', 'chapterNumber'], unique: true },
    { fields: ['status'] },
    { fields: ['priority', 'enqueuedAt'] },
  ],
});

const OutputValidationRule = sequelize.define('OutputValidationRule', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
  level: { type: DataTypes.STRING, allowNull: false },
  category: { type: DataTypes.STRING, allowNull: false },
  condition: { type: DataTypes.JSON, allowNull: false },
  action: { type: DataTypes.STRING, defaultValue: 'block' },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
  description: { type: DataTypes.TEXT, allowNull: true },
}, {
  tableName: 'output_validation_rules',
  timestamps: true,
  updatedAt: 'updatedAt',
  createdAt: 'createdAt',
  indexes: [{ fields: ['level', 'isActive'] }],
});

// ==================== Phase 4: 输入治理 ====================

const AuthorIntent = sequelize.define('AuthorIntent', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  workId: { type: DataTypes.STRING, allowNull: false, unique: true },
  longTermVision: { type: DataTypes.TEXT, allowNull: true },
  tone: { type: DataTypes.STRING, allowNull: true },
  themes: { type: DataTypes.JSON, allowNull: true, defaultValue: [] },
  constraints: { type: DataTypes.JSON, allowNull: true, defaultValue: [] },
  mustKeep: { type: DataTypes.TEXT, allowNull: true },
  mustAvoid: { type: DataTypes.TEXT, allowNull: true },
  notes: { type: DataTypes.TEXT, allowNull: true },
}, {
  tableName: 'author_intents',
  timestamps: true,
  updatedAt: 'updatedAt',
  createdAt: 'createdAt',
  indexes: [{ fields: ['workId'] }],
});

const CurrentFocus = sequelize.define('CurrentFocus', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  workId: { type: DataTypes.STRING, allowNull: false },
  focusText: { type: DataTypes.TEXT, allowNull: false },
  targetChapters: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 3 },
  priority: { type: DataTypes.STRING, defaultValue: 'medium' },
  expiresAt: { type: DataTypes.DATE, allowNull: true },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
}, {
  tableName: 'current_focuses',
  timestamps: true,
  updatedAt: 'updatedAt',
  createdAt: 'createdAt',
  indexes: [
    { fields: ['workId'] },
    { fields: ['workId', 'isActive'] },
  ],
});

const ChapterIntent = sequelize.define('ChapterIntent', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  workId: { type: DataTypes.STRING, allowNull: false },
  chapterNumber: { type: DataTypes.INTEGER, allowNull: false },
  mustKeep: { type: DataTypes.TEXT, allowNull: true },
  mustAvoid: { type: DataTypes.TEXT, allowNull: true },
  sceneBeats: { type: DataTypes.JSON, allowNull: true, defaultValue: [] },
  conflictResolution: { type: DataTypes.TEXT, allowNull: true },
  emotionalGoal: { type: DataTypes.TEXT, allowNull: true },
  ruleStack: { type: DataTypes.JSON, allowNull: true, defaultValue: [] },
  plannedAt: { type: DataTypes.DATE, allowNull: true },
  composedAt: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'chapter_intents',
  timestamps: true,
  updatedAt: 'updatedAt',
  createdAt: 'createdAt',
  indexes: [
    { fields: ['workId', 'chapterNumber'], unique: true },
    { fields: ['workId'] },
  ],
});

Work.hasMany(AuthorIntent, { foreignKey: 'workId', sourceKey: 'workId', as: 'authorIntents' });
Work.hasMany(CurrentFocus, { foreignKey: 'workId', sourceKey: 'workId', as: 'currentFocuses' });
Work.hasMany(ChapterIntent, { foreignKey: 'workId', sourceKey: 'workId', as: 'chapterIntents' });

let initialized = false;

async function runMigrations() {
  // 1. 检查并添加缺失列
  const columns = await sequelize.query("PRAGMA table_info(characters)", { type: sequelize.QueryTypes.SELECT });
  const columnNames = columns.map((c) => c.name);
  if (!columnNames.includes('voiceFingerprint')) {
    await sequelize.query("ALTER TABLE characters ADD COLUMN voiceFingerprint JSON");
    console.log('[migration] 已添加 characters.voiceFingerprint 列');
  }

  // 2. 修复 work_files filename 全局 UNIQUE（旧 schema 遗留问题）
  const [wfIndexes] = await sequelize.query("PRAGMA index_list('work_files')");
  const filenameUniqueIndex = wfIndexes.find((i) => i.unique === 1 && i.origin === 'u');
  if (filenameUniqueIndex) {
    const [indexInfo] = await sequelize.query(`PRAGMA index_info('${filenameUniqueIndex.name}')`);
    const indexColumns = indexInfo.map((i) => i.name);
    if (indexColumns.length === 1 && indexColumns[0] === 'filename') {
      console.log('[migration] 检测到 work_files.filename 全局 UNIQUE，开始重建表...');
      await sequelize.transaction(async (t) => {
        await sequelize.query(`
          CREATE TABLE work_files_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workId VARCHAR(255) NOT NULL,
            filename VARCHAR(255) NOT NULL,
            content TEXT DEFAULT '',
            createdAt DATETIME NOT NULL,
            updatedAt DATETIME NOT NULL
          )
        `, { transaction: t });
        await sequelize.query(`
          INSERT INTO work_files_new (id, workId, filename, content, createdAt, updatedAt)
          SELECT id, workId, filename, content, createdAt, updatedAt FROM work_files
        `, { transaction: t });
        await sequelize.query(`DROP TABLE work_files`, { transaction: t });
        await sequelize.query(`ALTER TABLE work_files_new RENAME TO work_files`, { transaction: t });
        await sequelize.query(`CREATE UNIQUE INDEX work_files_work_id_filename ON work_files (workId, filename)`, { transaction: t });
        await sequelize.query(`CREATE INDEX work_files_work_id ON work_files (workId)`, { transaction: t });
      });
      console.log('[migration] work_files 重建完成');
    }
  }

  // 3. 修复 volumes workId/number 全局 UNIQUE（旧 schema 遗留问题）
  const [volIndexes] = await sequelize.query("PRAGMA index_list('volumes')");
  const volUniqueIndexes = volIndexes.filter((i) => i.unique === 1 && i.origin === 'u');
  if (volUniqueIndexes.length > 0) {
    const needsRebuild = volUniqueIndexes.some((idx) => {
      // 简单检查：如果存在 origin='u' 的唯一索引，说明有旧 schema 问题
      return true;
    });
    if (needsRebuild) {
      console.log('[migration] 检测到 volumes 旧 UNIQUE 约束，开始重建表...');
      await sequelize.transaction(async (t) => {
        await sequelize.query(`
          CREATE TABLE volumes_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workId VARCHAR(255) NOT NULL,
            number INTEGER NOT NULL,
            title VARCHAR(255) DEFAULT '',
            outlineFile VARCHAR(255) DEFAULT '',
            chapterRange JSON DEFAULT '[]',
            status VARCHAR(255) DEFAULT 'outlined'
          )
        `, { transaction: t });
        await sequelize.query(`
          INSERT INTO volumes_new (id, workId, number, title, outlineFile, chapterRange, status)
          SELECT id, workId, number, title, outlineFile, chapterRange, status FROM volumes
        `, { transaction: t });
        await sequelize.query(`DROP TABLE volumes`, { transaction: t });
        await sequelize.query(`ALTER TABLE volumes_new RENAME TO volumes`, { transaction: t });
        await sequelize.query(`CREATE UNIQUE INDEX volumes_work_id_number ON volumes (workId, number)`, { transaction: t });
      });
      console.log('[migration] volumes 重建完成');
    }
  }

  // 4. 修复 chapters workId/number 全局 UNIQUE（旧 schema 遗留问题）
  const [chIndexes] = await sequelize.query("PRAGMA index_list('chapters')");
  const chUniqueIndexes = chIndexes.filter((i) => i.unique === 1 && i.origin === 'u');
  if (chUniqueIndexes.length > 0) {
    console.log('[migration] 检测到 chapters 旧 UNIQUE 约束，开始重建表...');
    await sequelize.transaction(async (t) => {
      await sequelize.query(`
        CREATE TABLE chapters_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workId VARCHAR(255) NOT NULL,
          number INTEGER NOT NULL,
          rawFile VARCHAR(255) DEFAULT '',
          editedFile VARCHAR(255) DEFAULT '',
          humanizedFile VARCHAR(255) DEFAULT '',
          finalFile VARCHAR(255) DEFAULT '',
          polishFile VARCHAR(255) DEFAULT '',
          feedbackFile VARCHAR(255) DEFAULT '',
          summaryFile VARCHAR(255) DEFAULT '',
          editFile VARCHAR(255) DEFAULT '',
          repetitionRepairedFile VARCHAR(255) DEFAULT '',
          chars INTEGER DEFAULT 0,
          models JSON DEFAULT '{}'
        )
      `, { transaction: t });
      await sequelize.query(`
        INSERT INTO chapters_new (id, workId, number, rawFile, editedFile, humanizedFile, finalFile, polishFile, feedbackFile, summaryFile, editFile, repetitionRepairedFile, chars, models)
        SELECT id, workId, number, rawFile, editedFile, humanizedFile, finalFile, polishFile, feedbackFile, summaryFile, editFile, repetitionRepairedFile, chars, models FROM chapters
      `, { transaction: t });
      await sequelize.query(`DROP TABLE chapters`, { transaction: t });
      await sequelize.query(`ALTER TABLE chapters_new RENAME TO chapters`, { transaction: t });
      await sequelize.query(`CREATE UNIQUE INDEX chapters_work_id_number ON chapters (workId, number)`, { transaction: t });
    });
    console.log('[migration] chapters 重建完成');
  }
}

async function initDb() {
  if (initialized) return;
  await sequelize.sync();
  await runMigrations();
  initialized = true;
}

module.exports = {
  sequelize,
  initDb,
  Work,
  Volume,
  Chapter,
  WorkFile,
  Setting,
  WorldLore,
  Character,
  CharacterRelation,
  PlotLine,
  PlotNode,
  MapRegion,
  MapConnection,
  StoryTemplate,
  WorkTemplateLink,
  Embedding,
  TruthEvent,
  TruthState,
  TruthHook,
  TruthResource,
  AuthorFingerprint,
  WorkStyleLink,
  OutputQueue,
  OutputValidationRule,
  AuthorIntent,
  CurrentFocus,
  ChapterIntent,
  Prompt,
  CharacterMemory,
};
