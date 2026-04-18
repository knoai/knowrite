const express = require('express');
const { StoryTemplate } = require('../models');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { scope = 'global', workId } = req.query;
    const where = { scope };
    if (workId) where.workId = workId;
    const items = await StoryTemplate.findAll({
      where,
      order: [['category', 'ASC'], ['name', 'ASC']],
    });
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const item = await StoryTemplate.create(req.body);
    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const [count] = await StoryTemplate.update(req.body, {
      where: { id: req.params.id },
    });
    if (!count) return res.status(404).json({ error: '模版不存在' });
    const item = await StoryTemplate.findByPk(req.params.id);
    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const count = await StoryTemplate.destroy({ where: { id: req.params.id } });
    if (!count) return res.status(404).json({ error: '模版不存在' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 预设套路库（如果为空则自动初始化）
const defaultTemplates = [
  {
    name: '退婚流',
    category: '退婚流',
    description: '主角遭受羞辱性退婚，立誓崛起，最终打脸对方。',
    beatStructure: [
      { beat: '开局困境', chapters: 3, goal: '展示主角当前的困境和退婚羞辱' },
      { beat: '获得机缘', chapters: 5, goal: '主角获得金手指或奇遇，开始崛起' },
      { beat: '快速升级', chapters: 10, goal: '实力快速提升，引起各方注意' },
      { beat: '初次打脸', chapters: 3, goal: '对退婚方进行第一次反击' },
      { beat: '更大舞台', chapters: 15, goal: '进入更大的世界/宗门/城池' },
      { beat: '最终对决', chapters: 5, goal: '与退婚方背后的势力决战' },
    ],
    exampleWorks: '斗破苍穹',
    tags: ['打脸', '升级', '废柴逆袭'],
  },
  {
    name: '系统流',
    category: '系统流',
    description: '主角获得系统，通过完成任务获取奖励不断变强。',
    beatStructure: [
      { beat: '系统觉醒', chapters: 2, goal: '主角获得系统，了解基本功能' },
      { beat: '新手任务', chapters: 3, goal: '完成系统发布的初始任务' },
      { beat: '快速积累', chapters: 10, goal: '利用系统优势快速获得资源' },
      { beat: '系统升级', chapters: 5, goal: '系统功能解锁/升级' },
      { beat: '跨界/跨地图', chapters: 10, goal: '进入更高级的区域' },
      { beat: '终极任务', chapters: 5, goal: '完成系统终极使命' },
    ],
    exampleWorks: '大王饶命',
    tags: ['系统', '任务', '奖励'],
  },
  {
    name: '种田流',
    category: '种田流',
    description: '主角通过经营、发展势力，从弱小逐步建立强大基业。',
    beatStructure: [
      { beat: '落脚安家', chapters: 3, goal: '找到立足之地，初步发展' },
      { beat: '资源积累', chapters: 8, goal: '收集人才、物资、技术' },
      { beat: '势力初成', chapters: 7, goal: '建立核心班底和基本盘' },
      { beat: '对外扩张', chapters: 10, goal: '吞并或联合周边势力' },
      { beat: '危机应对', chapters: 5, goal: '应对外部威胁或天灾' },
      { beat: '霸业初成', chapters: 5, goal: '成为一方霸主' },
    ],
    exampleWorks: '放开那个女巫',
    tags: ['经营', '发展', '基建'],
  },
  {
    name: '凡人流',
    category: '凡人流',
    description: '无背景无天赋的凡人，凭借谨慎和机缘在修仙界步步为营。',
    beatStructure: [
      { beat: '入门', chapters: 5, goal: '进入修仙宗门或获得修炼法门' },
      { beat: '苦修', chapters: 10, goal: '默默修炼，低调积累' },
      { beat: '历练', chapters: 8, goal: '外出历练获取资源' },
      { beat: '危机', chapters: 5, goal: '遭遇生死危机并化解' },
      { beat: '突破', chapters: 5, goal: '境界突破，进入新层次' },
      { beat: '更高层次', chapters: 10, goal: '飞升或进入更高位面' },
    ],
    exampleWorks: '凡人修仙传',
    tags: ['谨慎', ' realistic', '慢热'],
  },
  {
    name: '签到流',
    category: '签到流',
    description: '主角通过每日签到获得奖励，逐步积累无敌实力。',
    beatStructure: [
      { beat: '首次签到', chapters: 2, goal: '获得签到系统，首次奖励' },
      { beat: '持续积累', chapters: 10, goal: '每日签到，实力稳步提升' },
      { beat: '特殊签到点', chapters: 5, goal: '在特殊地点签到获得稀有奖励' },
      { beat: '暴露实力', chapters: 5, goal: '不得不展示部分实力' },
      { beat: '无敌之路', chapters: 10, goal: '签到奖励使主角接近无敌' },
      { beat: '最终揭秘', chapters: 5, goal: '签到系统的最终秘密' },
    ],
    exampleWorks: '开局签到荒古圣体',
    tags: ['签到', '无敌流', '爽文'],
  },
];

async function seedDefaultTemplates() {
  const count = await StoryTemplate.count({ where: { scope: 'global' } });
  if (count === 0) {
    for (const t of defaultTemplates) {
      await StoryTemplate.create({ ...t, scope: 'global' });
    }
  }
}

module.exports = { router, seedDefaultTemplates };
