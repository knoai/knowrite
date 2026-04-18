/**
 * 时序真相数据库服务
 *
 * 核心职责：
 * 1. appendEvent(event) — 追加事件（唯一写入入口）
 * 2. appendEventsFromDelta(workId, chapterNumber, delta) — 从 Summarizer 批量转换
 * 3. materializeState(workId, chapterNumber) — 从事件流计算物化视图
 * 4. queryStateAt(workId, chapterNumber, subjectType, subjectId) — 时间旅行查询
 * 5. traceChanges(workId, subjectType, subjectId, fromChapter, toChapter) — 变化追踪
 * 6. analyzeTrends(workId, metric, options) — 趋势分析
 * 7. detectAnomalies(workId) — 异常检测
 */

const { Op } = require('sequelize');
const { TruthEvent, TruthState, TruthHook, TruthResource, Character, Work, sequelize } = require('../models');
const fileStore = require('./file-store');
const { getWorkDir } = require('../core/paths');

class TemporalTruthService {

  /**
   * 追加事件（唯一写入入口）
   */
  async appendEvent(event, options = {}) {
    const { transaction } = options;
    const lastEvent = await TruthEvent.findOne({
      where: { workId: event.workId, chapterNumber: event.chapterNumber },
      order: [['eventSequence', 'DESC']],
      transaction,
    });
    const nextSequence = (lastEvent?.eventSequence || 0) + 1;

    const record = await TruthEvent.create({
      ...event,
      eventSequence: nextSequence,
    }, { transaction });

    // 事务内不触发异步物化，由调用方统一处理
    if (!transaction) {
      setImmediate(() => {
        this.materializeState(event.workId, event.chapterNumber).catch((err) => {
          console.error('[temporal-truth] materializeState failed:', err.message);
        });
      });
    }

    return record;
  }

  /**
   * 批量追加事件（Summarizer delta 转换）
   */
  async appendEventsFromDelta(workId, chapterNumber, delta) {
    if (!delta) return 0;
    const events = [];

    // characterChanges → char_*_change 事件
    for (const change of delta.characterChanges || []) {
      const eventType = `char_${change.field}_change`;
      events.push({
        workId,
        chapterNumber,
        eventType,
        subjectType: 'character',
        subjectId: change.charName,
        payload: { from: change.oldValue, to: change.newValue, reason: change.reason || '' },
        sourceChapter: chapterNumber,
        extractedBy: 'summarizer',
      });
    }

    // worldChanges → world_*_change 事件
    for (const change of delta.worldChanges || []) {
      const eventType = `world_${change.field}_change`;
      events.push({
        workId,
        chapterNumber,
        eventType,
        subjectType: 'world',
        subjectId: 'world',
        payload: { from: change.oldValue, to: change.newValue },
        sourceChapter: chapterNumber,
        extractedBy: 'summarizer',
      });
    }

    // emotionalChanges → char_mood_change 事件
    for (const change of delta.emotionalChanges || []) {
      events.push({
        workId,
        chapterNumber,
        eventType: 'char_mood_change',
        subjectType: 'character',
        subjectId: change.charName,
        payload: { from: '', to: change.emotion, intensity: change.intensity, reason: change.reason },
        sourceChapter: chapterNumber,
        extractedBy: 'summarizer',
      });
    }

    // newHooks → hook_created 事件
    for (const hook of delta.newHooks || []) {
      events.push({
        workId,
        chapterNumber,
        eventType: 'hook_created',
        subjectType: 'hook',
        subjectId: hook.hookId || `hook_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        payload: hook,
        sourceChapter: chapterNumber,
        extractedBy: 'summarizer',
      });
    }

    // resolvedHooks → hook_resolved 事件
    for (const resolved of delta.resolvedHooks || []) {
      events.push({
        workId,
        chapterNumber,
        eventType: 'hook_resolved',
        subjectType: 'hook',
        subjectId: resolved.hookId,
        payload: { resolution: resolved.resolution },
        sourceChapter: chapterNumber,
        extractedBy: 'summarizer',
      });
    }

    // newResources → resource_acquired 事件
    for (const res of delta.newResources || []) {
      events.push({
        workId,
        chapterNumber,
        eventType: 'resource_acquired',
        subjectType: 'resource',
        subjectId: res.name,
        payload: res,
        sourceChapter: chapterNumber,
        extractedBy: 'summarizer',
      });
    }

    // resourceChanges → resource_* 事件
    for (const change of delta.resourceChanges || []) {
      let eventType = 'resource_transferred';
      if (change.field === 'status') {
        if (change.newValue === 'consumed') eventType = 'resource_consumed';
        else if (change.newValue === 'lost') eventType = 'resource_lost';
      }
      events.push({
        workId,
        chapterNumber,
        eventType,
        subjectType: 'resource',
        subjectId: change.name,
        payload: { from: change.oldValue, to: change.newValue, reason: change.reason || '' },
        sourceChapter: chapterNumber,
        extractedBy: 'summarizer',
      });
    }

    // 批量事件在事务中创建，保证原子性
    if (events.length > 0) {
      await sequelize.transaction(async (t) => {
        for (const event of events) {
          await this.appendEvent(event, { transaction: t });
        }
      });
      // 事务提交后统一触发物化视图更新
      setImmediate(() => {
        this.materializeState(workId, chapterNumber).catch((err) => {
          console.error('[temporal-truth] materializeState failed:', err.message);
        });
      });
    }

    return events.length;
  }

  /**
   * 物化状态（从事件流计算）
   */
  async materializeState(workId, chapterNumber) {
    // 1. 获取该章所有事件
    const events = await TruthEvent.findAll({
      where: { workId, chapterNumber },
      order: [['eventSequence', 'ASC']],
    });

    if (events.length === 0) return null;

    // 2. 获取上一章的物化状态作为起点
    const prevState = await TruthState.findOne({
      where: { workId, chapterNumber: chapterNumber - 1 },
      order: [['chapterNumber', 'DESC']],
    });

    // 3. 从起点 + 事件流计算新状态
    const newState = this.applyEvents(prevState, events);

    // 4. 保存物化视图
    await TruthState.upsert({
      workId,
      chapterNumber,
      characterStates: newState.characterStates,
      worldState: newState.worldState,
      emotionalArcs: newState.emotionalArcs,
      isMaterialized: true,
      lastEventId: events[events.length - 1]?.id,
      computedAt: new Date(),
      statsSnapshot: {
        activeCharacterCount: newState.characterStates?.length || 0,
        eventCountThisChapter: events.length,
        avgConfidence: events.reduce((sum, e) => sum + e.confidence, 0) / events.length,
      },
    });

    return newState;
  }

  /**
   * 时间旅行查询：查指定章节的指定主体状态
   */
  async queryStateAt(workId, chapterNumber, subjectType, subjectId) {
    // 方法 1：查物化视图（快）
    const materialized = await TruthState.findOne({
      where: { workId, chapterNumber },
    });

    if (materialized) {
      if (subjectType === 'character') {
        return materialized.characterStates?.find((c) => c.charName === subjectId) || null;
      }
      if (subjectType === 'world') {
        return materialized.worldState;
      }
    }

    // 方法 2：从事件流计算（慢但精确）
    const events = await TruthEvent.findAll({
      where: {
        workId,
        chapterNumber: { [Op.lte]: chapterNumber },
        subjectType,
        subjectId,
      },
      order: [['chapterNumber', 'ASC'], ['eventSequence', 'ASC']],
    });

    const state = this.computeStateFromEvents(events);
    if (subjectType === 'character') {
      return state.characterStates?.find((c) => c.charName === subjectId) || null;
    }
    if (subjectType === 'world') {
      return state.worldState;
    }
    return state;
  }

  /**
   * 变化追踪：查某主体从 A 章到 B 章的变化
   */
  async traceChanges(workId, subjectType, subjectId, fromChapter, toChapter) {
    const events = await TruthEvent.findAll({
      where: {
        workId,
        chapterNumber: { [Op.between]: [fromChapter, toChapter] },
        subjectType,
        subjectId,
      },
      order: [['chapterNumber', 'ASC'], ['eventSequence', 'ASC']],
    });

    return events.map((e) => ({
      chapter: e.chapterNumber,
      sequence: e.eventSequence,
      type: e.eventType,
      payload: e.payload,
      confidence: e.confidence,
    }));
  }

  /**
   * 趋势分析
   */
  async analyzeTrends(workId, metric, options = {}) {
    const { fromChapter = 1, toChapter } = options;
    const maxChapter = toChapter || (await this.getMaxChapter(workId));

    switch (metric) {
      case 'emotional_arc': {
        const states = await TruthState.findAll({
          where: { workId, chapterNumber: { [Op.gte]: fromChapter, [Op.lte]: maxChapter } },
          order: [['chapterNumber', 'ASC']],
        });

        const arcs = {};
        for (const state of states) {
          for (const arc of state.emotionalArcs || []) {
            if (!arcs[arc.charName]) arcs[arc.charName] = [];
            arcs[arc.charName].push({
              chapter: state.chapterNumber,
              emotion: arc.emotion,
              intensity: arc.intensity,
            });
          }
        }
        return arcs;
      }

      case 'character_presence': {
        const events = await TruthEvent.findAll({
          where: {
            workId,
            chapterNumber: { [Op.gte]: fromChapter, [Op.lte]: maxChapter },
            subjectType: 'character',
          },
        });

        const presence = {};
        for (const e of events) {
          if (!presence[e.subjectId]) presence[e.subjectId] = new Set();
          presence[e.subjectId].add(e.chapterNumber);
        }

        return Object.entries(presence)
          .map(([name, chapters]) => ({
            character: name,
            chapterCount: chapters.size,
            chapters: Array.from(chapters).sort((a, b) => a - b),
            presenceRate: chapters.size / (maxChapter - fromChapter + 1),
          }))
          .sort((a, b) => b.chapterCount - a.chapterCount);
      }

      case 'hook_lifecycle': {
        const hooks = await TruthHook.findAll({ where: { workId } });
        return hooks.map((h) => ({
          hookId: h.hookId,
          description: h.description,
          createdAt: h.createdChapter,
          resolvedAt: h.resolvedChapter,
          lifecycle: h.resolvedChapter ? h.resolvedChapter - h.createdChapter : null,
          status: h.status,
        }));
      }

      case 'event_density': {
        const { sequelize } = require('../models');
        const events = await TruthEvent.findAll({
          where: { workId, chapterNumber: { [Op.gte]: fromChapter, [Op.lte]: maxChapter } },
          attributes: ['chapterNumber', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
          group: ['chapterNumber'],
          order: [['chapterNumber', 'ASC']],
        });
        return events.map((e) => ({
          chapter: e.chapterNumber,
          eventCount: parseInt(e.get('count'), 10),
        }));
      }

      default:
        return null;
    }
  }

  /**
   * 异常检测
   */
  async detectAnomalies(workId) {
    const anomalies = [];
    const maxChapter = await this.getMaxChapter(workId);
    if (maxChapter < 3) return anomalies;

    // 检测 1：角色消失（连续 5 章无事件的角色）
    const characterPresence = await this.analyzeTrends(workId, 'character_presence');
    for (const char of characterPresence) {
      const gaps = [];
      let lastChapter = 0;
      for (const ch of char.chapters) {
        if (lastChapter > 0 && ch - lastChapter > 5) {
          gaps.push({ from: lastChapter, to: ch, length: ch - lastChapter });
        }
        lastChapter = ch;
      }
      if (gaps.length > 0) {
        anomalies.push({
          type: 'character_disappearance',
          subject: char.character,
          severity: gaps.some((g) => g.length > 10) ? 'major' : 'minor',
          details: gaps,
        });
      }
    }

    // 检测 2：伏笔堆积（未回收 > 10 个）
    const openHooks = await TruthHook.findAll({
      where: { workId, status: ['open', 'progressing'] },
    });
    if (openHooks.length > 10) {
      const criticalHooks = openHooks.filter((h) => h.importance === 'critical');
      anomalies.push({
        type: 'hook_backlog',
        severity: criticalHooks.length > 3 ? 'critical' : 'major',
        details: { totalOpen: openHooks.length, criticalOpen: criticalHooks.length },
      });
    }

    // 检测 3：事件密度突变（某章事件数比平均高 3 倍）
    const density = await this.analyzeTrends(workId, 'event_density');
    if (density.length > 5) {
      const avgDensity = density.reduce((s, d) => s + d.eventCount, 0) / density.length;
      for (const d of density) {
        if (d.eventCount > avgDensity * 3) {
          anomalies.push({
            type: 'event_burst',
            chapter: d.chapter,
            severity: 'minor',
            details: { eventCount: d.eventCount, average: avgDensity },
          });
        }
      }
    }

    return anomalies;
  }

  /**
   * 获取最新物化状态
   */
  async getCurrentState(workId) {
    const state = await TruthState.findOne({
      where: { workId },
      order: [['chapterNumber', 'DESC']],
    });
    return state || null;
  }

  /**
   * 获取角色在指定章节的状态
   */
  async getCharacterStateAt(workId, charName, chapterNumber) {
    const state = await TruthState.findOne({
      where: { workId, chapterNumber: { [Op.lte]: chapterNumber } },
      order: [['chapterNumber', 'DESC']],
    });
    if (!state) return null;
    return state.characterStates?.find((c) => c.charName === charName) || null;
  }

  /**
   * 获取未闭合伏笔
   */
  async getOpenHooks(workId) {
    return await TruthHook.findAll({
      where: { workId, status: ['open', 'progressing'] },
      order: [['importance', 'DESC'], ['createdChapter', 'ASC']],
    });
  }

  /**
   * 获取活跃资源
   */
  async getActiveResources(workId) {
    return await TruthResource.findAll({
      where: { workId, status: 'active' },
      order: [['name', 'ASC']],
    });
  }

  // ==================== 初始化 ====================

  /**
   * 从现有作品数据初始化 truth 文件
   */
  async initializeTruthFiles(workId) {
    const work = await Work.findByPk(workId);
    if (!work) throw new Error(`Work ${workId} not found`);

    // 1. 从 Character 表初始化角色状态
    const characters = await Character.findAll({ where: { workId } });
    const characterStates = characters.map((c) => ({
      charId: c.id,
      charName: c.name,
      location: '',
      health: 'healthy',
      mood: 'neutral',
      relationships: [],
      knownInfo: [],
      goals: c.goals || '',
    }));

    // 2. 创建第 0 章初始状态
    await TruthState.create({
      workId,
      chapterNumber: 0,
      characterStates,
      worldState: {
        currentLocation: '',
        weather: '',
        season: '',
        timeOfDay: '',
        politicalSituation: '',
        activeEvents: [],
      },
      emotionalArcs: characters.map((c) => ({
        charId: c.id,
        charName: c.name,
        emotion: 'neutral',
        intensity: 0.5,
        reason: '初始状态',
        chapterNumber: 0,
      })),
    });

    // 3. 从大纲中提取伏笔（如果存在）
    let outlines;
    try {
      const raw = work.outlines || work.outlineDetailed;
      outlines = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      outlines = null;
    }
    if (outlines?.detailed?.chapters) {
      for (const ch of outlines.detailed.chapters) {
        if (ch.hooks) {
          for (const hook of ch.hooks) {
            await TruthHook.create({
              workId,
              hookId: `hook_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              description: hook.description,
              type: hook.type || 'foreshadow',
              createdChapter: ch.number,
              targetChapter: hook.targetChapter,
              status: 'open',
              importance: hook.importance || 'major',
              relatedCharacters: hook.relatedCharacters || [],
            });
          }
        }
      }
    }

    // 4. 生成初始投影文件
    await this.regenerateProjections(workId);

    return { initialized: true };
  }

  // ==================== 投影文件生成 ====================

  async regenerateProjections(workId) {
    // 1. 生成 current_state.md 投影
    const latestState = await this.getCurrentState(workId);
    if (latestState) {
      const stateText = this.renderStateProjection(latestState);
      await fileStore.writeFile(workId, 'truth/current_state.md', stateText);
    }

    // 2. 生成 pending_hooks.md 投影
    const openHooks = await this.getOpenHooks(workId);
    const hooksText = this.renderHooksProjection(openHooks);
    await fileStore.writeFile(workId, 'truth/pending_hooks.md', hooksText);

    // 3. 生成 resource_ledger.md 投影
    const resources = await TruthResource.findAll({ where: { workId } });
    const resourcesText = this.renderResourcesProjection(resources);
    await fileStore.writeFile(workId, 'truth/resource_ledger.md', resourcesText);
  }

  renderStateProjection(state) {
    const lines = ['# 当前世界状态', ''];
    lines.push('## 世界环境');
    const ws = state.worldState || {};
    lines.push(`- 地点: ${ws.currentLocation || '未知'}`);
    lines.push(`- 天气: ${ws.weather || '未知'}`);
    lines.push(`- 季节: ${ws.season || '未知'}`);
    lines.push(`- 时间: ${ws.timeOfDay || '未知'}`);
    lines.push(`- 局势: ${ws.politicalSituation || '未知'}`);
    if (ws.activeEvents?.length) {
      lines.push('- 进行中的事件:');
      ws.activeEvents.forEach((e) => lines.push(`  - ${e}`));
    }
    lines.push('');
    lines.push('## 角色状态');
    for (const c of state.characterStates || []) {
      lines.push(`### ${c.charName}`);
      lines.push(`- 位置: ${c.location || '未知'}`);
      lines.push(`- 健康: ${c.health || '未知'}`);
      lines.push(`- 情绪: ${c.mood || '未知'}`);
      if (c.relationships?.length) {
        lines.push('- 关系:');
        c.relationships.forEach((r) => lines.push(`  - ${r.withChar}: ${r.type} (${r.strength})`));
      }
      if (c.knownInfo?.length) {
        lines.push('- 已知信息:');
        c.knownInfo.forEach((info) => lines.push(`  - ${info}`));
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  renderHooksProjection(hooks) {
    const lines = ['# 未闭合伏笔', ''];
    const byStatus = { open: [], progressing: [] };
    hooks.forEach((h) => { byStatus[h.status]?.push(h); });

    if (byStatus.open.length) {
      lines.push('## 待回收');
      byStatus.open.forEach((h) => {
        lines.push(`### [${h.importance}] ${h.hookId}`);
        lines.push(`${h.description}`);
        lines.push(`- 类型: ${h.type}`);
        lines.push(`- 创建于: 第${h.createdChapter}章`);
        lines.push(`- 目标回收: ${h.targetChapter ? `第${h.targetChapter}章` : '未定'}`);
        if (h.relatedCharacters?.length) {
          lines.push(`- 相关角色: ${h.relatedCharacters.join(', ')}`);
        }
        lines.push('');
      });
    }

    if (byStatus.progressing.length) {
      lines.push('## 推进中');
      byStatus.progressing.forEach((h) => {
        lines.push(`### [${h.importance}] ${h.hookId}`);
        lines.push(`${h.description}`);
        lines.push('');
      });
    }

    return lines.join('\n');
  }

  renderResourcesProjection(resources) {
    const lines = ['# 资源账本', ''];
    const byStatus = { active: [], consumed: [], lost: [], transferred: [] };
    resources.forEach((r) => { byStatus[r.status]?.push(r); });

    if (byStatus.active.length) {
      lines.push('## 当前持有');
      byStatus.active.forEach((r) => {
        lines.push(`- ${r.name} (${r.quantity}) - ${r.owner || '无主'} ${r.category ? `[${r.category}]` : ''}`);
      });
      lines.push('');
    }

    if (byStatus.consumed.length) {
      lines.push('## 已消耗');
      byStatus.consumed.forEach((r) => {
        lines.push(`- ${r.name} - 消耗于第${r.consumedChapter}章`);
      });
      lines.push('');
    }

    if (byStatus.lost.length) {
      lines.push('## 已遗失');
      byStatus.lost.forEach((r) => {
        lines.push(`- ${r.name} - 遗失于第${r.lostChapter}章`);
      });
      lines.push('');
    }

    return lines.join('\n');
  }

  // ==================== 为 compose 选择 truth 片段 ====================

  async selectFragmentsForChapter(workId, chapterNumber, intent) {
    const fragments = [];

    // 1. 上一章的状态
    const prevState = await TruthState.findOne({
      where: { workId, chapterNumber: chapterNumber - 1 },
    });
    if (prevState) {
      fragments.push({
        type: 'state',
        title: '上一章世界状态',
        content: JSON.stringify(prevState.worldState, null, 2),
      });
    }

    // 2. 本章相关角色的状态
    if (intent && prevState) {
      const keywords = this.extractKeywordsFromIntent(intent);
      const relevantChars = prevState.characterStates.filter((c) =>
        keywords.some((k) => c.charName.includes(k))
      );
      if (relevantChars.length) {
        fragments.push({
          type: 'character',
          title: '相关角色状态',
          content: relevantChars
            .map((c) => `${c.charName}: ${c.location}, ${c.health}, ${c.mood}`)
            .join('\n'),
        });
      }
    }

    // 3. 即将到期的伏笔
    const openHooks = await this.getOpenHooks(workId);
    const dueHooks = openHooks.filter((h) => h.targetChapter && h.targetChapter <= chapterNumber + 3);
    if (dueHooks.length) {
      fragments.push({
        type: 'hook',
        title: '即将到期的伏笔',
        content: dueHooks
          .map((h) => `[${h.importance}] ${h.description} (目标: 第${h.targetChapter}章)`)
          .join('\n'),
      });
    }

    // 4. 本章相关资源
    const resources = await this.getActiveResources(workId);
    if (resources.length) {
      fragments.push({
        type: 'resource',
        title: '当前活跃资源',
        content: resources.map((r) => `${r.name} (${r.quantity}) - ${r.owner || '无主'}`).join('\n'),
      });
    }

    return fragments;
  }

  // ==================== 私有方法 ====================

  applyEvents(baseState, events) {
    const state = baseState
      ? {
          characterStates: JSON.parse(JSON.stringify(baseState.characterStates || [])),
          worldState: JSON.parse(JSON.stringify(baseState.worldState || {})),
          emotionalArcs: JSON.parse(JSON.stringify(baseState.emotionalArcs || [])),
        }
      : { characterStates: [], worldState: {}, emotionalArcs: [] };

    for (const event of events) {
      switch (event.eventType) {
        case 'char_location_change':
          this.updateCharacterState(state, event.subjectId, 'location', event.payload.to);
          break;
        case 'char_status_change':
          this.updateCharacterState(state, event.subjectId, 'status', event.payload.to);
          break;
        case 'char_health_change':
          this.updateCharacterState(state, event.subjectId, 'health', event.payload.to);
          break;
        case 'char_mood_change':
          this.updateCharacterState(state, event.subjectId, 'mood', event.payload.to);
          // 同时记录情感弧线
          state.emotionalArcs.push({
            charName: event.subjectId,
            emotion: event.payload.to,
            intensity: event.payload.intensity || 0.5,
            reason: event.payload.reason || '',
          });
          break;
        case 'char_relationship_change':
          this.updateRelationship(state, event.subjectId, event.payload);
          break;
        case 'char_knowledge_gain':
          this.addKnowledge(state, event.subjectId, event.payload.to);
          break;
        case 'world_location_change':
          state.worldState.currentLocation = event.payload.to;
          break;
        case 'world_event_start':
          state.worldState.activeEvents = state.worldState.activeEvents || [];
          state.worldState.activeEvents.push(event.payload.to);
          break;
        case 'world_event_end':
          state.worldState.activeEvents = (state.worldState.activeEvents || []).filter(
            (e) => e !== event.payload.from
          );
          break;
        default:
          // 通用 world_*_change 处理（如 world_political_change）
          if (event.eventType.startsWith('world_') && event.eventType.endsWith('_change')) {
            const field = event.eventType.replace('world_', '').replace('_change', '');
            state.worldState[field] = event.payload.to;
          }
          break;
      }
    }

    // 只保留最近 20 条情感弧线
    state.emotionalArcs = state.emotionalArcs.slice(-20);

    return state;
  }

  updateCharacterState(state, charName, field, value) {
    let char = state.characterStates.find((c) => c.charName === charName);
    if (!char) {
      char = {
        charName,
        location: '',
        health: 'healthy',
        mood: 'neutral',
        relationships: [],
        knownInfo: [],
        goals: '',
      };
      state.characterStates.push(char);
    }
    char[field] = value;
  }

  updateRelationship(state, charName, payload) {
    const char = state.characterStates.find((c) => c.charName === charName);
    if (!char) return;
    char.relationships = char.relationships || [];
    const existing = char.relationships.findIndex((r) => r.withChar === payload.withChar);
    if (existing >= 0) {
      char.relationships[existing] = payload;
    } else {
      char.relationships.push(payload);
    }
  }

  addKnowledge(state, charName, knowledge) {
    const char = state.characterStates.find((c) => c.charName === charName);
    if (!char) return;
    char.knownInfo = char.knownInfo || [];
    if (!char.knownInfo.includes(knowledge)) {
      char.knownInfo.push(knowledge);
    }
  }

  computeStateFromEvents(events) {
    // 简化版：从事件流重新计算状态
    let state = { characterStates: [], worldState: {}, emotionalArcs: [] };
    for (const event of events) {
      state = this.applyEvents({ ...state, emotionalArcs: [...state.emotionalArcs] }, [event]);
    }
    return state;
  }

  extractKeywordsFromIntent(intent) {
    const text = [intent.mustKeep, intent.mustAvoid, intent.conflictResolution, intent.emotionalGoal].join(' ');
    const matches = text.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
    return [...new Set(matches)];
  }

  async getMaxChapter(workId) {
    const max = await TruthEvent.max('chapterNumber', { where: { workId } });
    return max || 0;
  }
}

module.exports = new TemporalTruthService();
