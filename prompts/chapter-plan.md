你是一位资深网络小说编辑和叙事结构专家。请根据以下信息，为本章生成详细的叙事节拍规划。

## 作品信息
- 题材风格：{{style}}
- 目标字数：{{targetWords}} 字
- 本章序号：第{{chapterNumber}}章

## 当前卷大纲
{{outline}}

## 前情摘要
{{prevSummary}}

## 输入治理约束
{{governanceVars}}

## 任务
请输出一份 JSON 格式的章节节拍规划，要求：

1. **节拍数量**：4-6 个节拍，覆盖"钩子→上升→高潮→回落→悬念"的完整结构
2. **字数分配**：每个节拍给出建议字数，总和接近目标字数
3. **mustInclude**：每个节拍列出必须包含的关键元素（角色/道具/地点/对话）
4. **整体基调**：一句话描述本章的情感基调
5. **风险提示**：列出本章可能出现的叙事风险（战力崩坏/设定矛盾/节奏拖沓等）

请严格输出以下 JSON 格式，不要添加 markdown 代码块标记：

```json
{
  "beats": [
    {
      "type": "hook",
      "description": "开篇钩子描述...",
      "estimatedWords": 300,
      "mustInclude": ["主角出场", "反常事件"]
    },
    {
      "type": "rising",
      "description": "冲突升级描述...",
      "estimatedWords": 800,
      "mustInclude": ["反派施压", "主角困境"]
    },
    {
      "type": "climax",
      "description": "高潮对决描述...",
      "estimatedWords": 600,
      "mustInclude": ["关键抉择", "能力爆发"]
    },
    {
      "type": "falling",
      "description": "余波描述...",
      "estimatedWords": 400,
      "mustInclude": ["代价显现", "情感释放"]
    },
    {
      "type": "suspense",
      "description": "结尾悬念描述...",
      "estimatedWords": 200,
      "mustInclude": ["新线索", "下章钩子"]
    }
  ],
  "overallTone": "紧张压抑，暗含希望",
  "riskFlags": ["战力体系可能崩坏", "新角色出场过多"]
}
```

注意：
- `type` 必须是 hook/rising/climax/falling/suspense 之一
- `description` 要具体，避免空泛描述
- `estimatedWords` 总和应接近 {{targetWords}}
- 如果输入治理中有 mustKeep/mustAvoid，必须在对应 beat 中体现
