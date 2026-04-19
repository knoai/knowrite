你是一位专业的小说设定整理专家。请根据以下大纲文本，提取并整理出结构化的世界观设定数据。

要求：
1. 只提取大纲中**明确提及**的内容，不要虚构或推测
2. 如果某类数据在大纲中没有足够信息，返回空数组
3. 所有输出必须是严格的 JSON 格式
4. 人物关系使用人物姓名（fromName/toName），而不是数据库 ID

输出格式（严格 JSON）：
```json
{
  "worldLore": [
    {
      "category": "力量体系|种族/物种|势力/宗门|历史事件|规则/法则|道具/宝物|地理区域|其他",
      "title": "条目名称",
      "content": "详细描述",
      "tags": ["标签1", "标签2"],
      "importance": 1-5
    }
  ],
  "characters": [
    {
      "name": "姓名",
      "alias": "外号/别名（没有留空）",
      "roleType": "主角|配角|反派",
      "status": "存活|死亡|失踪|其他",
      "appearance": "外貌描述（精简）",
      "personality": "性格特点（精简）",
      "goals": "核心目标/动机（精简）",
      "background": "背景经历（精简）"
    }
  ],
  "characterRelations": [
    {
      "fromName": "人物A姓名",
      "toName": "人物B姓名",
      "relationType": "师徒|恋人|仇敌|亲人|盟友|上下级|其他",
      "description": "关系描述",
      "strength": 1-10,
      "bidirectional": false
    }
  ],
  "plotLines": [
    {
      "name": "剧情线名称",
      "type": "主线|支线",
      "status": "进行中|已完成|待展开",
      "color": "#hex颜色（根据类型选一个：主线=#f59e0b，支线=#3b82f6，情感=#ec4899，悬疑=#8b5cf6）",
      "nodes": [
        {
          "chapterNumber": 章节号或null,
          "title": "节点标题",
          "description": "节点描述",
          "nodeType": "开端|发展|高潮|结局",
          "position": 0,
          "status": "待展开|进行中|已完成"
        }
      ]
    }
  ],
  "mapRegions": [
    {
      "name": "区域名称",
      "regionType": "大陆|国家|城市|宗门|秘境|山脉|河流|其他",
      "parentName": "上级区域名称（没有留空）",
      "description": "区域描述",
      "tags": ["标签1"]
    }
  ],
  "mapConnections": [
    {
      "fromName": "区域A",
      "toName": "区域B",
      "connType": "道路|河流|传送阵|海域|边界|其他",
      "description": "连接描述",
      "travelTime": " travel time description e.g. '三天' "
    }
  ]
}
```

注意事项：
- `worldLore` 中，"主要人物"相关信息不要放入，应该放入 `characters`
- `plotLines` 的节点应该按时间/章节顺序排列，`position` 从 0 开始递增
- `mapRegions` 如果有层级关系，子区域的 `parentName` 填写父区域名称
- 所有字段必须存在，没有值时用空字符串 `""` 或空数组 `[]`
- 人物关系中的姓名必须与 `characters` 中的 `name` 完全一致

以下是小说大纲文本：

---

【主题大纲】
{{outlineTheme}}

---

【详细纲章】
{{outlineDetailed}}

---

【多卷架构】
{{outlineMultivolume}}

---

如果多卷架构内容为空，则忽略此部分。

---

请直接输出 JSON，不要有任何其他说明文字。确保 JSON 格式合法，可以被标准 JSON 解析器正确解析。
