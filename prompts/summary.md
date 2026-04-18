请对以下小说章节进行高度精简的摘要提炼。

## 提炼流程

**第一步：通读分析**
快速通读全文，识别以下要素（不必输出，但请在正式输出时体现）：
- 本章的核心事件是什么？
- 主要人物的关键行动和决策
- 情绪/氛围的转折点
- 埋下的伏笔或回收的伏笔
- 与上下文的衔接关系

**第二步：正式输出**

要求：
1. 摘要控制在150-250字，涵盖本章核心事件、人物行动和情绪转折
2. 列出2-4个核心剧情点（关键转折/伏笔/冲突）
3. 保持"{{style}}"风格的叙事口吻

原文：
{{chapterContent}}

输出格式：
摘要：xxx
剧情点：
1. xxx
2. xxx

## 结构化真相变更（Structured Truth Delta）

请在摘要末尾，以 JSON 代码块格式输出本章对世界状态、角色、伏笔、资源的变更。这是用于维护小说连续性的机器可读数据，不会展示给读者。

```json
{
  "characterChanges": [
    {"name": "角色名", "field": "location|status|mood|cultivation|item", "oldValue": "...", "newValue": "...", "reason": "简要原因"}
  ],
  "worldChanges": [
    {"field": "地点|势力|规则", "oldValue": "...", "newValue": "...", "reason": "简要原因"}
  ],
  "newHooks": [
    {"description": "新埋下的伏笔", "expectedResolutionChapter": 预计解析章节}
  ],
  "resolvedHooks": [
    {"description": "已回收的伏笔"}
  ],
  "newResources": [
    {"name": "物品名", "owner": "持有者", "quantity": 1, "acquired": true}
  ],
  "resourceChanges": [
    {"name": "物品名", "owner": "持有者", "quantityDelta": -1, "reason": "使用/转让/消耗原因"}
  ]
}
```

注意：
- 只输出真实发生的变更，没有变更的字段留空数组
- 优先记录**角色位置/状态变化**和**新伏笔**，这是连续性审计最关注的
- 所有变更必须有 reason 字段说明上下文