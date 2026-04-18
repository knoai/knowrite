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

let initialized = false;
async function initDb() {
  if (initialized) return;
  await sequelize.sync();
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
};
