const {
  WorldLore,
  Character,
  CharacterRelation,
  PlotLine,
  PlotNode,
  MapRegion,
  MapConnection,
  StoryTemplate,
  WorkTemplateLink,
} = require('../models');

async function buildWorldContext(workId, options = {}) {
  const { chapterNumber = null, maxLoreItems = 50, maxChars = 8000 } = options;

  const [
    loreItems,
    characters,
    relations,
    plotLines,
    plotNodes,
    mapRegions,
    mapConnections,
    templateLinks,
  ] = await Promise.all([
    WorldLore.findAll({ where: { workId }, order: [['importance', 'DESC'], ['updatedAt', 'DESC']], limit: maxLoreItems }),
    Character.findAll({ where: { workId }, order: [['roleType', 'ASC'], ['name', 'ASC']] }),
    CharacterRelation.findAll({ where: { workId } }),
    PlotLine.findAll({ where: { workId }, order: [['createdAt', 'ASC']] }),
    PlotNode.findAll({ where: { workId }, order: [['position', 'ASC']] }),
    MapRegion.findAll({ where: { workId }, order: [['name', 'ASC']] }),
    MapConnection.findAll({ where: { workId } }),
    WorkTemplateLink.findAll({ where: { workId } }),
  ]);

  const templateIds = templateLinks.map(l => l.templateId);
  const templates = templateIds.length ? await StoryTemplate.findAll({ where: { id: templateIds } }) : [];

  let text = '';

  // 世界观
  if (loreItems.length) {
    text += '=== 世界观设定 ===\n';
    const byCategory = {};
    for (const item of loreItems) {
      const cat = item.category || '其他';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(item);
    }
    for (const [cat, items] of Object.entries(byCategory)) {
      text += `\n【${cat}】\n`;
      for (const item of items) {
        text += `- ${item.title}${item.importance >= 4 ? '（重要）' : ''}: ${item.content}\n`;
      }
    }
    text += '\n';
  }

  // 人物
  if (characters.length) {
    text += '=== 人物设定 ===\n';
    const charMap = {};
    for (const c of characters) {
      charMap[c.id] = c;
      let line = `${c.roleType === '主角' ? '【主角】' : c.roleType === '反派' ? '【反派】' : '【配角】'} ${c.name}`;
      if (c.alias) line += `（${c.alias}）`;
      if (c.status !== '存活') line += ` [状态：${c.status}]`;
      text += line + '\n';
      if (c.appearance) text += `  外貌：${c.appearance}\n`;
      if (c.personality) text += `  性格：${c.personality}\n`;
      if (c.goals) text += `  目标：${c.goals}\n`;
      if (c.background) text += `  背景：${c.background}\n`;
    }
    // 人物关系
    if (relations.length) {
      text += '\n人物关系：\n';
      for (const r of relations) {
        const from = charMap[r.fromCharId];
        const to = charMap[r.toCharId];
        if (!from || !to) continue;
        text += `  ${from.name} → ${to.name}：${r.relationType}${r.strength ? `（强度${r.strength}）` : ''}${r.description ? `，${r.description}` : ''}\n`;
        if (r.bidirectional) {
          text += `  ${to.name} → ${from.name}：${r.relationType}\n`;
        }
      }
    }
    text += '\n';
  }

  // 剧情线
  if (plotLines.length) {
    text += '=== 剧情线 ===\n';
    const nodesByLine = {};
    for (const n of plotNodes) {
      if (!nodesByLine[n.plotLineId]) nodesByLine[n.plotLineId] = [];
      nodesByLine[n.plotLineId].push(n);
    }
    for (const line of plotLines) {
      text += `\n${line.type}「${line.name}」${line.status !== '进行中' ? `[${line.status}]` : ''}\n`;
      const nodes = nodesByLine[line.id] || [];
      for (const n of nodes) {
        const chMark = n.chapterNumber ? `(第${n.chapterNumber}章)` : '';
        text += `  ${n.position + 1}. [${n.nodeType}] ${n.title}${chMark}${n.status !== '待展开' ? ` [${n.status}]` : ''}\n`;
        if (n.description) text += `     ${n.description}\n`;
      }
    }
    text += '\n';
  }

  // 地图
  if (mapRegions.length) {
    text += '=== 地图 ===\n';
    const regionMap = {};
    for (const r of mapRegions) regionMap[r.id] = r;
    for (const r of mapRegions) {
      const parent = r.parentId && regionMap[r.parentId];
      text += `- ${r.name}（${r.regionType}）${parent ? `[隶属于 ${parent.name}]` : ''}\n`;
      if (r.description) text += `  ${r.description}\n`;
    }
    if (mapConnections.length) {
      text += '\n区域连接：\n';
      for (const c of mapConnections) {
        const from = regionMap[c.fromRegionId];
        const to = regionMap[c.toRegionId];
        if (!from || !to) continue;
        text += `  ${from.name} → ${to.name}：${c.connType}${c.travelTime ? `（耗时：${c.travelTime}）` : ''}${c.description ? `，${c.description}` : ''}\n`;
      }
    }
    text += '\n';
  }

  // 套路模版
  if (templates.length) {
    text += '=== 套路模版 ===\n';
    for (const t of templates) {
      text += `\n${t.category}「${t.name}」\n`;
      if (t.description) text += `${t.description}\n`;
      if (t.beatStructure && t.beatStructure.length) {
        for (const beat of t.beatStructure) {
          text += `  [${beat.beat || beat.name || '节拍'}]`;
          if (beat.chapters) text += ` 约${beat.chapters}章`;
          if (beat.goal) text += ` — ${beat.goal}`;
          text += '\n';
        }
      }
    }
    text += '\n';
  }

  // 如果指定了章节号，追加章节相关上下文
  if (chapterNumber && plotNodes.length) {
    const relevantNodes = plotNodes.filter(n => n.chapterNumber === chapterNumber);
    if (relevantNodes.length) {
      text += `=== 第${chapterNumber}章相关剧情节点 ===\n`;
      for (const n of relevantNodes) {
        const line = plotLines.find(l => l.id === n.plotLineId);
        text += `- ${line ? line.name + '：' : ''}[${n.nodeType}] ${n.title}\n`;
        if (n.description) text += `  ${n.description}\n`;
      }
      text += '\n';
    }
  }

  // 截断到 maxChars
  if (text.length > maxChars) {
    text = text.slice(0, maxChars) + '\n\n...[上下文过长，已截断]';
  }

  return text.trim();
}

async function getWorldContextForPrompt(workId, chapterNumber) {
  return buildWorldContext(workId, { chapterNumber, maxLoreItems: 30, maxChars: 6000 });
}

module.exports = {
  getWorldContextForPrompt,
  buildWorldContext,
};
