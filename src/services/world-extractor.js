/**
 * 世界观自动提取服务
 * 从小说大纲中自动提取结构化世界数据并写入数据库
 */

const { loadPrompt } = require('./prompt-loader');
const { runStreamChat } = require('../core/chat');
const { resolveRoleModelConfig } = require('./settings-store');
const {
  sequelize,
  WorldLore,
  Character,
  CharacterRelation,
  PlotLine,
  PlotNode,
  MapRegion,
  MapConnection,
} = require('../models');

/**
 * 从文本中提取 JSON 块（支持被 ```json ... ``` 包裹的情况）
 */
function extractJson(text) {
  if (!text) return null;
  const trimmed = text.trim();

  // 尝试直接解析
  try {
    return JSON.parse(trimmed);
  } catch { /* ignore */ }

  // 尝试提取 ```json ... ``` 块
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch { /* ignore */ }
  }

  // 尝试提取第一个 { ... } 块
  const braceMatch = trimmed.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0]);
    } catch { /* ignore */ }
  }

  return null;
}

/**
 * 从大纲中提取世界数据并写入数据库
 * @param {string} workId
 * @param {string} outlineTheme
 * @param {string} outlineDetailed
 * @param {string} outlineMultivolume
 * @param {string|null} model - 模型覆盖（可选）
 * @param {object|null} callbacks - { onStepStart, onStepEnd, onChunk }
 * @returns {object} 提取统计
 */
async function extractWorldFromOutlines(workId, outlineTheme, outlineDetailed, outlineMultivolume, model, callbacks) {
  if (callbacks?.onStepStart) {
    callbacks.onStepStart({ key: 'extract_world', name: '提取世界观数据', model: model || '(默认)' });
  }

  // 1. 构建 Prompt
  const prompt = await loadPrompt('extract-world', {
    outlineTheme: outlineTheme || '',
    outlineDetailed: outlineDetailed || '',
    outlineMultivolume: outlineMultivolume || '',
  });

  // 2. 调用 LLM
  const result = await runStreamChat(
    [{ role: 'user', content: prompt }],
    await resolveRoleModelConfig('outline', model),
    {
      onChunk: (chunk) => { if (callbacks?.onChunk) callbacks.onChunk('extract_world', chunk); },
    },
    { workId, agentType: 'worldExtractor', promptTemplate: 'extract-world' }
  );

  // 3. 解析 JSON
  const data = extractJson(result.content);
  if (!data) {
    console.error('[world-extractor] LLM 返回内容无法解析为 JSON:', result.content.substring(0, 500));
    if (callbacks?.onStepEnd) {
      callbacks.onStepEnd('extract_world', { ...result, error: 'JSON 解析失败' });
    }
    throw new Error('世界观提取失败：LLM 返回格式不正确');
  }

  // 4. 写入数据库（事务）
  const stats = await sequelize.transaction(async (t) => {
    // 先清空该 workId 下已有数据
    await CharacterRelation.destroy({ where: { workId }, transaction: t });
    await PlotNode.destroy({ where: { workId }, transaction: t });
    await MapConnection.destroy({ where: { workId }, transaction: t });
    await Character.destroy({ where: { workId }, transaction: t });
    await PlotLine.destroy({ where: { workId }, transaction: t });
    await MapRegion.destroy({ where: { workId }, transaction: t });
    await WorldLore.destroy({ where: { workId }, transaction: t });

    const stats = {
      worldLore: 0,
      characters: 0,
      characterRelations: 0,
      plotLines: 0,
      plotNodes: 0,
      mapRegions: 0,
      mapConnections: 0,
    };

    // 4.1 世界观设定
    const loreItems = Array.isArray(data.worldLore) ? data.worldLore : [];
    for (const item of loreItems) {
      if (!item.title) continue;
      await WorldLore.create({
        workId,
        category: item.category || '其他',
        title: item.title,
        content: item.content || '',
        tags: Array.isArray(item.tags) ? item.tags : [],
        importance: typeof item.importance === 'number' ? Math.max(1, Math.min(5, item.importance)) : 3,
      }, { transaction: t });
      stats.worldLore++;
    }

    // 4.2 人物
    const characters = Array.isArray(data.characters) ? data.characters : [];
    const charNameToId = {};
    for (const c of characters) {
      if (!c.name) continue;
      const created = await Character.create({
        workId,
        name: c.name,
        alias: c.alias || '',
        roleType: ['主角', '配角', '反派'].includes(c.roleType) ? c.roleType : '配角',
        status: c.status || '存活',
        appearance: c.appearance || '',
        personality: c.personality || '',
        goals: c.goals || '',
        background: c.background || '',
        notes: c.notes || '',
      }, { transaction: t });
      charNameToId[c.name] = created.id;
      stats.characters++;
    }

    // 4.3 人物关系
    const relations = Array.isArray(data.characterRelations) ? data.characterRelations : [];
    for (const r of relations) {
      if (!r.fromName || !r.toName) continue;
      const fromId = charNameToId[r.fromName];
      const toId = charNameToId[r.toName];
      if (!fromId || !toId) {
        console.warn(`[world-extractor] 人物关系引用不存在的人物: ${r.fromName} → ${r.toName}`);
        continue;
      }
      await CharacterRelation.create({
        workId,
        fromCharId: fromId,
        toCharId: toId,
        relationType: r.relationType || '其他',
        description: r.description || '',
        strength: typeof r.strength === 'number' ? Math.max(1, Math.min(10, r.strength)) : 5,
        bidirectional: !!r.bidirectional,
      }, { transaction: t });
      stats.characterRelations++;
    }

    // 4.4 剧情线 + 节点
    const plotLines = Array.isArray(data.plotLines) ? data.plotLines : [];
    for (const line of plotLines) {
      if (!line.name) continue;
      const createdLine = await PlotLine.create({
        workId,
        name: line.name,
        type: ['主线', '支线'].includes(line.type) ? line.type : '支线',
        status: line.status || '进行中',
        color: line.color || '#3b82f6',
      }, { transaction: t });
      stats.plotLines++;

      const nodes = Array.isArray(line.nodes) ? line.nodes : [];
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        await PlotNode.create({
          workId,
          plotLineId: createdLine.id,
          chapterNumber: n.chapterNumber || null,
          title: n.title || '',
          description: n.description || '',
          nodeType: ['开端', '发展', '高潮', '结局'].includes(n.nodeType) ? n.nodeType : '发展',
          position: typeof n.position === 'number' ? n.position : i,
          status: n.status || '待展开',
        }, { transaction: t });
        stats.plotNodes++;
      }
    }

    // 4.5 地图区域 + 连接
    const mapRegions = Array.isArray(data.mapRegions) ? data.mapRegions : [];
    const regionNameToId = {};
    // 第一轮：创建所有区域（不处理 parent）
    for (const r of mapRegions) {
      if (!r.name) continue;
      const created = await MapRegion.create({
        workId,
        name: r.name,
        regionType: r.regionType || '其他',
        parentId: null, // 第二轮再更新
        description: r.description || '',
        tags: Array.isArray(r.tags) ? r.tags : [],
      }, { transaction: t });
      regionNameToId[r.name] = created.id;
      stats.mapRegions++;
    }
    // 第二轮：更新 parentId
    for (const r of mapRegions) {
      if (r.parentName && regionNameToId[r.parentName] && regionNameToId[r.name]) {
        await MapRegion.update(
          { parentId: regionNameToId[r.parentName] },
          { where: { id: regionNameToId[r.name], workId }, transaction: t }
        );
      }
    }

    // 4.6 地图连接
    const connections = Array.isArray(data.mapConnections) ? data.mapConnections : [];
    for (const c of connections) {
      if (!c.fromName || !c.toName) continue;
      const fromId = regionNameToId[c.fromName];
      const toId = regionNameToId[c.toName];
      if (!fromId || !toId) {
        console.warn(`[world-extractor] 地图连接引用不存在的区域: ${c.fromName} → ${c.toName}`);
        continue;
      }
      await MapConnection.create({
        workId,
        fromRegionId: fromId,
        toRegionId: toId,
        connType: c.connType || '道路',
        description: c.description || '',
        travelTime: c.travelTime || '',
      }, { transaction: t });
      stats.mapConnections++;
    }

    return stats;
  });

  console.log(`[world-extractor] 作品 ${workId} 提取完成:`, stats);

  if (callbacks?.onStepEnd) {
    callbacks.onStepEnd('extract_world', { ...result, stats });
  }

  return { stats, content: result.content };
}

module.exports = {
  extractWorldFromOutlines,
  extractJson,
};
