<p align="center">
  <img src="https://img.shields.io/badge/Knowrite-小说创作引擎-6366f1?style=for-the-badge&logo=book&logoColor=white" alt="Knowrite">
</p>

<h1 align="center">Knowrite 小说创作引擎<br><sub>Engineered Novel Writing Backend</sub></h1>

<p align="center">
  <a href="#"><img src="https://img.shields.io/badge/Node.js-24+-339933?logo=nodedotjs&logoColor=white" alt="Node.js"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg" alt="License: AGPL-3.0"></a>
  <a href="#"><img src="https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white" alt="Express"></a>
  <a href="#"><img src="https://img.shields.io/badge/SQLite-3-003B57?logo=sqlite&logoColor=white" alt="SQLite"></a>
  <a href="#"><img src="https://img.shields.io/badge/OpenAI--Compatible-API-412991?logo=openai&logoColor=white" alt="OpenAI Compatible"></a>
  <a href="#"><img src="https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white" alt="Docker"></a>
</p>

<p align="center">
  <a href="README.md">中文</a> | <a href="README.en.md">English</a>
</p>

---

AI Agent 自主写小说——写、审、改、评，全程接管。基于多 Agent 协作的工程化创作流水线，覆盖工业风严格评审与自由风快速创作双模式，内置 RAG 向量记忆、Fitness 五维质量评估、Prompt 自动进化、拆书分析与 Skill 萃取。

**Knowrite 是一个 Node.js / Express 后端服务**，提供从大纲生成、章节撰写、编辑评审、去 AI 化、读者反馈到质量评估的完整自动化小说创作 API。**所有模型调用统一通过 OpenAI 兼容协议**，用户自行配置 Provider、Base URL 和 API Key，无内置默认模型，零外部向量库依赖，单节点即可运行。

配套前端 [`knowrite-ui`](https://github.com/knoai/knowrite-ui)（React 19 + Vite + Tailwind CSS，MIT 协议）提供作品管理、实时创作流可视化、Fitness 看板、世界观编辑和 Prompt 管理。

> **📁 作品存储**：采用 SQLite 主存储 + 本地文件双写机制。所有章节文本、大纲、评审记录存入 `data/novel.db`，同时自动备份到 `works/<workId>/` 目录下的 `.txt` / `.json` 文件，方便直接取用。

---

## 快速开始

### 环境要求

- Node.js 24+
- 任意 OpenAI-compatible API Key（需自行配置 Provider）

### 安装

```bash
# 克隆后端仓库
git clone https://github.com/knoai/knowrite.git
cd knowrite

# 安装依赖
npm install

# 配置环境变量（复制模板后按需修改）
cp .env.example .env

# 启动服务
npm start
# 服务运行在 http://localhost:8000

# ⚠️ 首次使用必须先配置模型：
# 打开前端「设置 → 模型配置」，添加 Provider（如千问/百炼/DeepSeek），
# 填写 Base URL、API Key 和模型列表，并为各角色分配模型。
```

### 前端联调

```bash
# 另起终端，启动配套前端
cd ../knowrite-ui
npm install
npm run dev
# 前端运行在 http://localhost:5173，自动代理到后端
```

### 写第一本小说

```bash
# 创建作品
curl -X POST http://localhost:8000/api/novel/start \
  -H "Content-Type: application/json" \
  -d '{"topic":"修仙小说","platformStyle":"番茄","authorStyle":"热血","strategy":"knowrite"}'

# 续写下一章（SSE 流式输出）
curl -X POST http://localhost:8000/api/novel/continue \
  -H "Content-Type: application/json" \
  -d '{"workId":"<返回的workId>"}'

# 查看作品详情（含 Fitness 评分、评审记录）
curl http://localhost:8000/api/novel/works/<workId>
```

---

## 核心特性

### 多 Agent 写作流水线

每一章由多个 Agent 接力完成，全程零人工干预：

| Agent | 职责 |
|-------|------|
| **Writer** | 依据大纲 + 智能上下文生成初稿（字数治理 + 反重复提醒 + RAG 检索注入） |
| **Editor** | 结构化评审（`[是]`/`[否]` 双重通过标准），最多 3 轮改稿循环 |
| **Humanizer** | 去 AI 化处理，消除 LLM 高频词、句式单调和过度总结痕迹 |
| **Proofreader** | 校编润色（工业风模式）或跳过（自由风模式） |
| **Reader** | 模拟读者视角，输出结构化反馈（沉浸感 / 节奏 / 角色认同） |
| **Summarizer** | 生成章节摘要，自动索引到 RAG 向量库 |
| **Fitness** | 五维量化评分（字数 / 重复 / 评审 / 读者 / 连贯），自动落盘 |

如果 Editor 评审不通过，管线自动进入"改稿 → 再评审"循环，直到通过或达到最大轮次。

### Editor 双重通过标准

Editor 评审不只看"感觉"，而是结构化判定：

- **关键词通过**：必须显式输出 `[是]` 才视为通过，`[否]` 直接进入下一轮改稿
- **维度通过率**：8~33 个评审维度中，通过维度占比必须 ≥ 80%
- **历史反馈注入**：第 2 轮起，Editor 自动看到之前各轮的评审意见和修改痕迹，避免反复犯同一类错误
- **评审记录落盘**：每轮评审结果自动保存为 `review_chapter_{n}/round_{i}.json`，供 Fitness 评估和人类审阅

### Fitness 五维质量评估

每章完成后自动评分，无需人工介入：

| 维度 | 评估内容 | 权重 |
|------|----------|------|
| **字数** | 与目标字数偏差（高斯分布评分） | 20% |
| **重复** | 与历史章节的内容重复检测 | 20% |
| **评审** | Editor 评审通过率 | 20% |
| **读者** | 模拟读者反馈评分 | 20% |
| **连贯** | 大纲偏离检测（low/medium/high 严重度映射） | 20% |

Fitness 分数实时写入 `fitness.json`，前端 Fitness 看板可直接展示趋势图。

### RAG 向量记忆检索

零外部向量库依赖，纯 JS 实现：

- **Embedding 生成**：调用 Provider 的 `/v1/embeddings` 接口（复用同一 API Key）
- **向量存储**：SQLite JSON 列存储 embedding，自动建立索引
- **相似度计算**：纯 JS 余弦相似度，章节摘要检索阈值 0.65，角色/设定检索阈值 0.7
- **自动索引**：每章 Summarizer 完成后，摘要自动编码入库
- **上下文注入**：Writer 写作前自动检索 Top-3 相关历史章节摘要，注入 prompt

### 三层记忆系统

统一记忆架构，将分散的记忆模块整合为三层模型：

| 层级 | 名称 | 内容 | 对应模块 |
|------|------|------|----------|
| **L1** | Working Memory | 当前章节正在使用的上下文窗口 | `context-builder.js` |
| **L2** | Episodic Memory | 角色经历、事件流、时间线 | `character-memory.js` + `temporal-truth.js` |
| **L3** | Semantic Memory | 世界观、规则、人物设定、声纹字典 | `world-context.js` + `voice-fingerprint.js` |

### 角色专属记忆（Episodic Memory）

为每个角色维护独立的经历档案：

- **经历提取**：从章节摘要自动提取角色的重大事件、对话、关系变化、情感转折
- **经历类型**：event / dialogue / relationship_change / emotional_turn / goal_progress / knowledge_gain
- **记忆注入**：Writer 写作前自动检索相关角色的近期经历，注入 prompt
- **持久化**：角色记忆同时存入 SQLite 和 `works/<workId>/characters/<name>.json`

### 人设声纹字典（Voice Fingerprint）

从章节文本提取角色对话的"声纹"，确保角色说话风格一致：

- **统计维度**：平均句长、句式模板、高频词/口头禅（TF-IDF）、语气标记、修辞偏好、人称比例
- **自动提取**：每章完成后自动解析对话，更新对应角色的声纹数据
- **写作注入**：Writer 收到目标角色的声纹约束，保持对话风格一致性

### 拆书分析（Book Deconstructor）

上传任意小说文本，AI 自动拆解为结构化创作素材：

- **结构分析**：套路模板、章节结构、节拍密度
- **人物分析**：角色设定、关系网络、成长弧线
- **世界观分析**：势力分布、力量体系、设定规则
- **风格分析**：复用 AuthorFingerprint 模块提取语言风格
- **一键创建**：拆解结果可直接生成 `StoryTemplate` + `AuthorFingerprint` + Prompt

### Skill 自动萃取

从高分章节自动提炼可复用的创作技能：

- **触发条件**：连续 N 章 Fitness ≥ 阈值时自动触发萃取
- **Skill 格式**：Markdown 元数据（name / tags / fitnessThreshold / extractedFrom）+ 创作要点正文
- **自动注入**：后续作品创作时，匹配当前题材标签的 Skill 自动注入 Writer prompt
- **持久化**：萃取的 Skill 保存到 `skills/generated/` 目录

### 对话式创作代理（Chat Agent）

通过自然语言对话与作品互动：

- **续写/修改**："把第三章的战斗场面写得更激烈一些"
- **查询信息**："主角目前修炼到什么境界了？"
- **创作建议**："接下来怎么安排一个反转？"
- **上下文感知**：Agent 自动加载作品完整上下文（meta、大纲、章节、设定、人物）后作答

### MCP 服务器

内置轻量级 [Model Context Protocol](https://modelcontextprotocol.io/) 服务器（JSON-RPC 2.0 + SSE）：

- **`search_hot_novels`** — 搜索热门小说库，获取题材参考
- **`extract_novel_features`** — 提取小说特征并保存为模板
- 支持 Cursor / Claude Code 等 MCP 客户端直接连接

### 大纲偏离检测

AI 自动判定章节内容是否偏离既定大纲：

- **low**：轻微偏离，Fitness 连贯分 = 1.0
- **medium**：中度偏离，Fitness 连贯分 = 0.6，触发警告
- **high**：严重偏离，Fitness 连贯分 = 0.3，可触发自动矫正重写

### Prompt 自动进化

基于 Fitness 低分样本自动优化 Prompt：

1. **收集缺陷**：提取 Fitness 评分 < 0.6 的章节和对应 Editor 评审意见
2. **分析根因**：定位是 Prompt 表述不清、约束不足还是示例缺失
3. **生成变体**：基于缺陷分析生成 3~5 个 Prompt 变体
4. **评估择优**：用历史章节做回测，选择 Fitness 提升最大的变体
5. **渐进替换**：新变体仅在后续新章节生效，不影响历史作品

### 智能上下文管理

Writer 不是盲目堆上下文，而是分层组装：

| 上下文层 | 内容 | 来源 |
|----------|------|------|
| 近史全文 | 前 4 章完整正文 | `raw.txt` |
| 近史摘要 | 前 5 章章节摘要 | `summary.txt` |
| 远史压缩 | 更早章节的极度压缩梗概 | `compress-distant` prompt |
| 世界观 | 角色、设定、剧情线、地图 | SQLite 记忆库 |
| RAG 检索 | 语义相似的历史章节/角色/设定 | 向量相似度 Top-3 |
| 反重复提醒 | 近史已出现的情节/桥段 | `antiRepeat` 自动提取 |
| 角色记忆 | 目标角色的近期经历 | `character-memory.js` |
| 声纹约束 | 目标角色的对话风格 | `voice-fingerprint.js` |

### 双策略模式

- **`knowrite`**（默认）：7 Agent 全量流水线，质量优先
- **`pipeline`**：轻量单模型快速模式，速度优先

运行时通过 `strategy` 参数切换，同一作品可在不同章节使用不同策略。

### 作家轮换

多模型按章节轮询，避免单一模型风格固化。在「设置 → 模型配置」中配置 `writerRotation.models`，系统自动轮换。

### 世界观记忆库

完整的世界构建数据模型：

| 实体 | 用途 |
|------|------|
| **Character** | 角色档案、关系网络、出场记录 |
| **WorldLore** | 世界观设定、势力分布、历史事件 |
| **PlotLine / PlotNode** | 剧情线结构和节点状态 |
| **MapRegion / MapConnection** | 地图区域和连通关系 |
| **StoryTemplate** | 套路模板库（可复用的情节结构） |

所有数据通过 REST API CRUD 管理，写作时自动注入上下文。

### 输入治理（Input Governance）

写作前零 LLM 调用的意图编译与上下文选择：

| 层级 | 实体 | 作用 |
|------|------|------|
| **L1 长期愿景** | `AuthorIntent` | 作品级主题、约束、必须保留/避免 |
| **L2 当前焦点** | `CurrentFocus` | 短期创作目标（目标章节数、优先级、过期时间） |
| **L3 章节意图** | `ChapterIntent` | 单章 mustKeep / mustAvoid / 场景节拍 / 情感目标 / 规则栈 |

流程：`planChapter()` 编译意图 → `composeChapter()` 选择真相片段 + 世界观上下文 → `getGovernanceVariables()` 注入 Writer prompt。

### 时序真相数据库（Temporal Truth DB）

事件溯源驱动的世界状态追踪，支持时间旅行查询：

- **事件流** (`TruthEvent`)：不可变追加，记录角色位置变化、伏笔创建、资源获取等
- **物化视图** (`TruthState`)：任意章节的历史状态快照
- **承诺追踪** (`TruthHook`)：伏笔/悬念的创建与解析状态
- **资源账本** (`TruthResource`)：物品数量与流转历史

每章 Summarizer 完成后自动提取 delta 事件，Editor 和 Reader 可查询角色状态、检测资源矛盾。

### 全维度作者指纹（Author Fingerprint）

5 层风格指纹分析 + 自动注入 + 合规检测：

| 层级 | 分析维度 | 检测内容 |
|------|----------|----------|
| **叙事层** | POV、场景切换、章节结构 | 视角一致性、过渡方式 |
| **角色层** | 命名习惯、角色声音 | 命名模式、对话特征 |
| **情节层** | 章节结构、节拍密度 | 节奏分布、冲突密度 |
| **语言层** | 句长分布、词频、对话比 | 句式多样性、高频词 |
| **世界观层** | 设定类型、力量体系 | 设定复杂度、一致性 |

统计提取 + LLM 风格指南提取双模式，写作前自动注入约束，写作后检测风格偏离。

### 输出治理（Output Governance）

生产者-消费者解耦的出版前验证管道：

- **L1 自动验证**：真相一致性、风格合规、格式校验、内容策略
- **L2 LLM 验证**：可读性、情感连续性、反 AI 检测
- **状态机**：`pending → validating → approved | rejected → human_review → released`
- **手动闸门**：必须通过 `release` 操作才算正式发布

---

## 工作原理

### 完整管线流程

```
用户请求 → POST /api/novel/start 或 /api/novel/continue
    │
    ├─→ 0. 输入治理：planChapter → composeChapter → 治理变量注入 Writer prompt
    │       ├─ AuthorIntent（长期愿景）
    │       ├─ CurrentFocus（当前焦点）
    │       └─ ChapterIntent（章节意图 + 规则栈）
    │
    ├─→ 1. 上下文编译：大纲 + 近史全文 + 远史压缩 + 世界观 + RAG 检索 + 反重复提醒 + 角色记忆 + 声纹约束 + 真相片段
    │       └─ 作者指纹约束注入（叙事/角色/情节/语言/世界 5 层）
    │
    ├─→ 2. Writer：生成初稿 → raw.txt
    ├─→ 3. Editor：结构化评审 → [是]/[否]（头尾组合预览，支持长章节审阅）
    │       └─ 不通过 → 改稿 → 再评审（最多 3 轮）
    ├─→ 4. Humanizer：去 AI 化 → humanized.txt
    ├─→ 5. Proofreader：校编润色 → final.txt（自由风跳过）
    ├─→ 6. Reader：模拟读者反馈 → feedback.json
    ├─→ 7. Summarizer：生成摘要 → summary.txt
    │       └─ 时序真相：提取 delta 事件 → TruthEvent / TruthState / TruthHook / TruthResource
    ├─→ 8. RAG 索引：embedding → SQLite
    ├─→ 9. Fitness 评估：5 维评分 → fitness.json
    ├─→ 10. 角色记忆：提取角色经历 → CharacterMemory
    ├─→ 11. 声纹更新：解析对话 → VoiceFingerprint
    └─→ 12. 输出治理：enqueue → L1 自动验证 → L2 LLM 验证 → human_review → release
```

### 记忆系统架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              输入治理层                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ AuthorIntent │  │ CurrentFocus │  │ ChapterIntent│  │  规则栈编译   │ │
│  │  长期愿景     │  │   当前焦点    │  │  章节意图     │  │   L1→L4     │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │
│         └──────────────────┴──────────────────┘                 │         │
│                              │                                  │         │
├──────────────────────────────┼──────────────────────────────────┼─────────┤
│                         智能上下文编译器                             │         │
│  ┌─────────┐ ┌─────────┐ ┌───────────┐ ┌─────────┐ ┌───────────┐ │         │
│  │ 近史全文 │ │ 近史摘要 │ │ 远史压缩   │ │ 世界观库 │ │ RAG检索   │ │         │
│  │ (前4章) │ │ (前5章) │ │ (更早章)   │ │ SQLite  │ │ Top-3    │ │         │
│  └────┬────┘ └────┬────┘ └─────┬─────┘ └────┬────┘ └────┬────┘ │         │
│       └─────────────┴────────────┘          └─────────────┘      │         │
│                   │                                  │            │         │
│  ┌─────────┐ ┌─────────┐ ┌───────────┐  ┌──────────────┐        │         │
│  │反重复提醒│ │真相片段  │ │作者指纹   │  │  输入治理变量  │        │         │
│  │自动提取  │ │时序查询  │ │5层约束   │  │  mustKeep等   │        │         │
│  └────┬────┘ └────┬────┘ └─────┬─────┘  └──────┬───────┘        │         │
│       └─────────────┴────────────┘             │                 │         │
│                   │                            │                 │         │
│  ┌─────────┐ ┌─────────┐                      │                 │         │
│  │角色记忆  │ │声纹约束  │                      │                 │         │
│  │经历注入  │ │对话风格  │                      │                 │         │
│  └────┬────┘ └────┬────┘                      │                 │         │
│       └─────────────┴──────────────────────────┘                 │         │
│                   │                                              │         │
│              注入 Writer ◄───────────────────────────────────────┘         │
├──────────────────────────────────────────────────────────────────────────┤
│                              输出治理层                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │   L1 自动验证 │  │  L2 LLM 验证  │  │  风格合规检测  │  │  真相一致性   │ │
│  │  格式/策略   │  │  可读/情感   │  │  作者指纹对比  │  │  时序数据库   │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │
│         └──────────────────┴──────────────────┘                 │         │
│                              │                                  │         │
│                         human_review → release                  │         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## API 概览

### 小说创作（SSE 流式）

```bash
# 创建作品
curl -X POST http://localhost:8000/api/novel/start \
  -H "Content-Type: application/json" \
  -d '{"topic":"修仙小说","platformStyle":"番茄","authorStyle":"热血","strategy":"knowrite"}'

# 续写下一章
curl -X POST http://localhost:8000/api/novel/continue \
  -H "Content-Type: application/json" \
  -d '{"workId":"xxx"}'

# 导入已有章节续写
curl -X POST http://localhost:8000/api/novel/import \
  -H "Content-Type: application/json" \
  -d '{"workId":"xxx","content":"第1章 ..."}'

# 大纲偏离检测
curl -X POST http://localhost:8000/api/novel/deviate \
  -H "Content-Type: application/json" \
  -d '{"workId":"xxx","chapterNumber":5}'

# 纲章矫正重写
curl -X POST http://localhost:8000/api/novel/correct \
  -H "Content-Type: application/json" \
  -d '{"workId":"xxx","chapterNumber":5}'

# 获取作品详情（含章节文本、Fitness、评审记录）
curl http://localhost:8000/api/novel/works/:workId
```

### 对话式创作代理

```bash
# 与作品对话（SSE 流式）
curl -X POST http://localhost:8000/api/chat-agent \
  -H "Content-Type: application/json" \
  -d '{
    "workId": "xxx",
    "messages": [{"role": "user", "content": "把第三章的战斗写得更激烈一些"}]
  }'
```

### 拆书分析

```bash
# 拆解小说文本
curl -X POST http://localhost:8000/api/book-deconstruct \
  -H "Content-Type: application/json" \
  -d '{
    "text": "第一章 ...",
    "title": "斗破苍穹",
    "author": "天蚕土豆"
  }'

# 基于拆解结果一键创建模板
curl -X POST http://localhost:8000/api/book-deconstruct/artifacts \
  -H "Content-Type: application/json" \
  -d '{"analysis": {...}}'
```

### Skill 萃取

```bash
# 查看当前作品可用的 Skill
curl http://localhost:8000/api/skills?workId=xxx

# 手动触发 Skill 萃取
curl -X POST http://localhost:8000/api/skills/extract/xxx \
  -H "Content-Type: application/json" \
  -d '{"minFitness": 0.85, "minConsecutive": 3}'

# 获取 Skill 注入文本
curl http://localhost:8000/api/skills/injection/xxx
```

### 角色记忆

```bash
# 获取角色记忆注入文本
curl http://localhost:8000/api/novel/works/:workId/character-memories

# 从摘要提取角色经历
curl -X POST http://localhost:8000/api/novel/works/:workId/character-memories/extract \
  -H "Content-Type: application/json" \
  -d '{"chapterNumber": 5, "summaryText": "..."}'

# 获取某角色的记忆文件
curl http://localhost:8000/api/novel/works/:workId/character-memories/:charName/file
```

### 声纹字典

```bash
# 获取声纹注入文本
curl http://localhost:8000/api/novel/works/:workId/voice-fingerprints

# 从章节提取声纹
curl -X POST http://localhost:8000/api/novel/works/:workId/voice-fingerprints/extract \
  -H "Content-Type: application/json" \
  -d '{"chapterNumber": 5, "chapterText": "..."}'
```

### OpenAI 兼容接口

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-v3",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": true
  }'
```

### 世界上下文管理

```bash
# 角色 CRUD
GET    /api/world/:workId/characters
POST   /api/world/:workId/characters
PUT    /api/world/:workId/characters/:id
DELETE /api/world/:workId/characters/:id

# 设定 lore / 剧情线 / 地图 / 套路模板 类似
GET/POST/PUT/DELETE /api/world/:workId/lore
GET/POST/PUT/DELETE /api/world/:workId/plot-lines
GET/POST/PUT/DELETE /api/world/:workId/map-regions
GET/POST/PUT/DELETE /api/templates
```

### 时序真相数据库

```bash
# 查询角色/物品/伏笔在任意章节的状态（时间旅行）
GET /api/truth/state/:workId?subjectType=character&subjectId=xxx&chapterNumber=5

# 查询活跃伏笔（截至某章未解析）
GET /api/truth/hooks/:workId?asOfChapter=5

# 查询资源账本
GET /api/truth/resources/:workId?resourceName=xxx&asOfChapter=5

# 查询所有状态变化事件
GET /api/truth/events/:workId?subjectType=character&subjectId=xxx

# 生成 truth 投影（Markdown 真相文件）
POST /api/truth/projection/:workId?chapterNumber=5

# 检查连续性
POST /api/truth/continuity/:workId?chapterNumber=5
```

### 作者指纹

```bash
# 创建/更新指纹
POST /api/style/fingerprints

# 为作品关联指纹
POST /api/style/works/:workId/fingerprints

# 分析文本生成指纹
POST /api/style/analyze

# 获取作品活跃指纹
GET /api/style/works/:workId/fingerprints

# 验证风格合规
POST /api/style/verify/:workId?chapterNumber=5
```

### 输入治理

```bash
# AuthorIntent CRUD
GET  /api/input-governance/author-intent/:workId
PUT  /api/input-governance/author-intent/:workId

# CurrentFocus CRUD
GET    /api/input-governance/current-focus/:workId
POST   /api/input-governance/current-focus/:workId
PUT    /api/input-governance/current-focus/:focusId
DELETE /api/input-governance/current-focus/:focusId

# ChapterIntent
GET /api/input-governance/chapter-intent/:workId/:chapterNumber
PUT /api/input-governance/chapter-intent/:workId/:chapterNumber

# plan + compose（写作前自动调用）
POST /api/input-governance/plan/:workId/:chapterNumber
POST /api/input-governance/compose/:workId/:chapterNumber

# 获取治理变量（供调试）
GET /api/input-governance/governance-variables/:workId/:chapterNumber
```

### 输出治理

```bash
# 查看队列状态
GET /api/output/queue/:workId

# 手动触发验证
POST /api/output/validate/:workId/:chapterNumber

# 手动发布（通过 human_review 闸门）
POST /api/output/release/:workId/:chapterNumber
  -d '{"reviewer": "human"}'

# 查看验证规则
GET /api/output/rules

# 添加/更新规则
POST /api/output/rules
```

### 设置与进化

```bash
GET  /api/settings          # 全局配置
GET  /api/prompts           # Prompt 模板列表
POST /api/evolve            # Prompt 进化实验
```

### MCP 端点

```bash
# SSE 连接（Cursor / Claude Code 配置）
GET /mcp/sse

# JSON-RPC 消息通道
POST /mcp/message
```

---

## Docker 部署

### 快速启动

```bash
# 1. 复制环境变量模板并编辑
cp .env.example .env
# 编辑 .env，配置 PROVIDER、PROXY_URL 等

# 2. 使用 Docker Compose 启动
docker-compose up -d

# 3. 查看健康状态
curl http://localhost:8000/health
```

### 手动构建

```bash
docker build -t knowrite:latest .
docker run -p 8000:8000 --env-file .env \
  -v knowrite-data:/app/data \
  -v knowrite-works:/app/works \
  knowrite:latest
```

### 持久化卷

| 卷名 | 路径 | 说明 |
|------|------|------|
| `knowrite-data` | `/app/data` | SQLite 数据库 |
| `knowrite-works` | `/app/works` | 作品本地备份 |
| `knowrite-logs` | `/app/logs` | 运行日志 |

---

## 技术栈

| 层 | 技术 |
|---|---|
| 运行时 | Node.js 24+ |
| 框架 | Express 4 |
| 数据库 | SQLite + Sequelize 6 |
| 模型调用 | OpenAI-compatible HTTP API（用户配置任意 Provider） |
| Embedding | OpenAI `/v1/embeddings`（复用同一 Provider） |
| 向量检索 | 纯 JS 余弦相似度（零外部向量库依赖） |
| 流式输出 | Server-Sent Events (SSE) |
| 配置 | `config/*.json` 静态配置 + DB 动态配置（模型全用户自定义） |
| 校验 | Zod Schema（请求参数校验） |
| 安全 | Bearer Token / API Key、CORS、Rate Limit、路径遍历防护、AES-256-GCM 加密 |
| 作品存储 | SQLite 主存储 + `works/` 目录本地文件双写 |
| 容器化 | Docker + Docker Compose |
| 测试 | Jest + Supertest |

---

## 项目结构

```
knowrite/
├── src/
│   ├── server.js                  # Express 入口（CORS/限流/认证/路由/MCP）
│   ├── core/
│   │   ├── chat.js                # 统一 chat 入口（所有 Provider 走 OpenAI 兼容协议）
│   │   └── paths.js               # 路径工具 + workId sanitize
│   ├── mcp/
│   │   └── server.js              # MCP 服务器（JSON-RPC 2.0 + SSE）
│   ├── middleware/
│   │   ├── auth.js                # Bearer Token / X-API-Key 认证
│   │   └── validator.js           # Zod Schema 请求参数校验
│   ├── models/
│   │   └── index.js               # Sequelize + SQLite 模型（30+ 张表）
│   ├── providers/
│   │   ├── base-provider.js
│   │   ├── factory.js
│   │   └── openai/                # OpenAI 兼容 Provider（chat + embed）
│   ├── routes/
│   │   ├── novel.js                  # 小说创作 API（start/continue/import/deviate/correct）
│   │   ├── chat-agent.js             # 对话式创作代理（SSE）
│   │   ├── book-deconstructor.js     # 拆书分析
│   │   ├── character-memory.js       # 角色专属记忆
│   │   ├── voice-fingerprint.js      # 人设声纹字典
│   │   ├── skill-extractor.js        # Skill 萃取
│   │   ├── world-context.js          # 世界观 CRUD
│   │   ├── templates.js              # 套路模板管理
│   │   ├── temporal-truth.js         # 时序真相数据库 API
│   │   ├── author-fingerprint.js     # 作者指纹 API
│   │   ├── output-governance.js      # 输出治理 API
│   │   └── input-governance.js       # 输入治理 API
│   ├── schemas/
│   │   ├── chat.js                # Chat 相关 Zod Schema
│   │   ├── novel.js               # Novel 相关 Zod Schema
│   │   └── routes.js              # 路由通用 Zod Schema
│   └── services/
│       ├── novel-engine.js           # 核心创作引擎（knowrite / pipeline 双策略）
│       ├── novel/                    # novel-engine.js 拆分子模块
│       │   ├── chapter-writer.js         # 7-Agent / Pipeline 写作管道
│       │   ├── chapter-processor.js      # 摘要/反馈/Fitness/Truth-Delta/角色记忆/声纹 后处理
│       │   ├── context-builder.js        # 滚动上下文 + RAG + 反重复 + 角色记忆 + 声纹
│       │   ├── outline-generator.js      # 大纲生成（主题/详细/多卷/分卷）
│       │   ├── edit-reviewer.js          # 编辑审阅 + verdict 解析
│       │   └── novel-utils.js            # 纯工具函数
│       ├── fitness-evaluator.js      # 5 维 Fitness 评估
│       ├── vector-store.js           # 向量存储（HNSW + SQLite + JS 余弦相似度回退）
│       ├── rag-retriever.js          # RAG 检索（章节/角色/设定相关性检索）
│       ├── memory-index.js           # 智能检索索引 + 反重复提醒 + 重复检测
│       ├── memory-system.js          # 三层记忆系统统一入口
│       ├── character-memory.js       # 角色专属经历记忆（Episodic Memory）
│       ├── voice-fingerprint.js      # 人设声纹字典提取与注入
│       ├── book-deconstructor.js     # 拆书分析（结构/人物/世界观/风格）
│       ├── chat-agent.js             # 对话式创作代理
│       ├── skill-extractor.js        # Skill 自动萃取与注入
│       ├── outline-deviation.js      # 大纲偏离检测（独立模块）
│       ├── world-extractor.js        # 世界观自动提取
│       ├── prompt-evolver.js         # 基于 Fitness 数据的 Prompt 自动进化
│       ├── prompt-loader.js          # Prompt 模板系统（i18n 预留 + 变量替换）
│       ├── settings-store.js         # DB 配置 + AES-256-GCM 加密存储 + 种子数据
│       ├── world-context.js          # 世界观记忆库注入
│       ├── file-store.js             # 文件持久化（本地备份）
│       ├── temporal-truth.js         # 事件溯源 + 时间旅行查询
│       ├── truth-manager.js          # 真相管理（初始化/delta应用/投影/连续性检查）
│       ├── author-fingerprint.js     # 5 层风格指纹分析 + 合规检测
│       ├── output-governance.js      # 生产者-消费者验证管道
│       ├── input-governance.js       # plan + compose 输入治理
│       └── log-stream.js             # 日志流收集器（SSE 实时推送）
├── prompts/                       # Markdown Prompt 模板（writer/editor/summarizer/revise...）
├── config/                        # 静态 JSON 配置 + example 模板
│   ├── engine.example.json
│   ├── fitness.example.json
│   ├── network.example.json
│   ├── prompts.example.json
│   ├── seed-data.json
│   ├── model-library.example.json
│   ├── user-settings.example.json
│   └── i18n.example.json
├── works/                         # 作品本地备份（章节文本、评审记录、Fitness）
├── data/                          # SQLite 数据库（novel.db）
├── evolution/                     # Prompt 进化候选与评估报告
├── logs/                          # 访问日志与 API 日志
├── skills/                        # Skill 萃取结果（generated/）
├── __tests__/                     # Jest 测试套件（服务 + 路由）
├── scripts/                       # 辅助脚本（setup/start/reset-config/start-chrome-cdp）
├── docs/                          # 文档（ADVANTAGES.md / ROADMAP.md 等）
├── Dockerfile                     # 多阶段构建 Docker 镜像
├── docker-compose.yml             # Docker Compose 编排
├── .env.example                   # 环境变量模板
└── package.json
```

---

## 环境变量

复制 `.env.example` 为 `.env` 后按需配置：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | `8000` |
| `PROVIDER` | 默认 Provider（`openai` / `ollama` / `lmstudio` / `yuanbao` / `doubao` / `kimi` / `qwen`） | `openai` |
| `PROXY_URL` | Web Provider 本地代理转发地址（如 Playwright 代理） | `http://localhost:9000` |
| `AUTH_TOKEN` | API 认证令牌（生产环境强烈建议设置） | — |
| `CORS_ORIGINS` | CORS 允许来源（逗号分隔，留空允许所有） | — |
| `RATE_LIMIT_WINDOW_MS` | 限流窗口（毫秒） | `60000` |
| `RATE_LIMIT_MAX` | 限流窗口内最大请求数 | `60` |
| `ENCRYPTION_KEY` | AES-256-GCM 加密密钥（32 字符，用于加密存储 API Key） | — |
| `OPENAI_API_KEY` | OpenAI 兼容 API Key | — |
| `OPENAI_BASE_URL` | OpenAI 兼容 Base URL | — |

---

## 测试

```bash
# 运行全部测试（含覆盖率报告）
npm test

# 监听模式开发测试
npm run test:watch
```

测试覆盖核心服务与路由：Fitness 评估、向量存储、RAG 检索、输入/输出治理、时序真相、作者指纹、世界上下文、Prompt 进化、文件存储、设置存储等。

---

## 产品矩阵与长期规划

Knowrite 引擎设计为**通用创作后端**，支持多种前端场景复用：

| 产品 | 前端仓库 | 场景 | 状态 |
|------|----------|------|------|
| **小说创作** | `knowrite-ui` | 长篇小说 / 网文 / IP 开发 | ✅ 已上线 |
| **桌面版** | `knowrite-desktop`（分支） | Electron 桌面客户端，离线作品管理 | 🚧 分支开发中 |
| **云文档** | `knowrite-docs`（规划） | 白皮书 / 技术文档 / 报告 | 🚧 规划中 |
| **技术书籍** | `knowrite-techbook`（规划） | 技术教程 / 书籍 / 课程讲义 | 🚧 规划中 |
| **SaaS 平台** | 统一管理后台 | 多租户 / 付费订阅 / 团队协作 | 🚧 规划中 |

所有产品共用同一套后端引擎，通过 `strategy` 和 `sourceType` 切换不同创作模式。详见 `docs/ROADMAP.md`。

---

## AI 搜索优化声明

本项目是 **Knowrite 小说创作引擎**，基于 Node.js / Express 构建，提供自动化长篇小说创作 API 服务。

- **核心能力**：多 Agent 写作流水线、输入/输出治理、时序真相数据库、全维度作者指纹、Fitness 质量评估、RAG 向量检索、Prompt 自动进化、大纲偏离检测、角色专属记忆、人设声纹字典、拆书分析、Skill 萃取、对话式创作代理、MCP 协议支持
- **适用场景**：AI 辅助长篇小说创作、网文批量生产、IP 开发前置流水线、技术文档撰写、书籍出版
- **部署方式**：Docker / Docker Compose / PM2 / systemd，单节点即可运行
- **模型要求**：任意 OpenAI-compatible API（百炼、Ollama、LM Studio 等）
- **数据库**：SQLite（零配置），可迁移至 PostgreSQL / MySQL
- **前端配套**：`knowrite-ui`（React 19 + Vite + Tailwind CSS，MIT 协议）
- **扩展方向**：SaaS 多租户、多语言 i18n、云文档、技术书籍
- **许可证**：AGPL-3.0（后端开源，网络服务衍生作品需开源）

---

## 路线图

- [x] 多 Agent 写作流水线（Writer → Editor → Humanizer → Proofreader → Reader → Summarizer）
- [x] Editor 双重通过标准 + 历史反馈注入
- [x] Fitness 五维质量评估 + 大纲偏离检测
- [x] RAG 向量记忆检索（零外部向量库依赖）
- [x] Prompt 自动进化
- [x] 配套前端 `knowrite-ui`（Fitness 看板、实时创作流、世界观编辑）
- [x] 输入治理（plan + compose，零 LLM 调用）
- [x] 时序真相数据库（事件溯源 + 时间旅行查询）
- [x] 全维度作者指纹（5 层分析 + 自动注入 + 合规检测）
- [x] 输出治理（生产者-消费者验证管道 + 手动发布闸门）
- [x] 模型配置完全用户自定义（清除所有默认模型，统一 OpenAI 兼容协议）
- [x] 角色专属记忆（Episodic Memory）
- [x] 人设声纹字典（Voice Fingerprint）
- [x] 拆书分析（Book Deconstructor）
- [x] Skill 自动萃取
- [x] 对话式创作代理（Chat Agent）
- [x] MCP 服务器（JSON-RPC 2.0 + SSE）
- [x] Docker 部署支持
- [x] Jest 测试套件
- [x] Zod Schema 输入校验
- [ ] 桌面版客户端（Electron 分支）
- [ ] 多语言 i18n（Prompt 模板 + API 响应）
- [ ] 互动小说（分支叙事 + 读者选择）
- [ ] SaaS 多租户支持
- [ ] 平台格式导出（起点、番茄等）

---

## 参与贡献

欢迎贡献代码、提 issue 或 PR。

```bash
npm install
npm run dev        # 开发模式（node --watch 热重启）
npm start          # 生产模式
npm test           # 运行测试
npm run test:watch # 监听模式测试
```

### 安全特性

- **认证**：`Authorization: Bearer <token>` 或 `X-API-Key: <token>`
- **限流**：`express-rate-limit`，默认 60 请求/分钟
- **CORS**：可配置允许来源
- **路径遍历**：`workId` 经过 `sanitizeWorkId`，禁止 `../` 和特殊字符
- **输入校验**：所有路由使用 Zod Schema 校验请求参数
- **API Key 加密**：配置中的 key 优先使用 AES-256-GCM 加密存储（需配置 `ENCRYPTION_KEY`），未配置时回退到 base64 编码

---

## License

**后端**：AGPL-3.0 (GNU Affero General Public License v3.0)

- ✅ 允许个人学习、研究、修改、分发
- ✅ 允许商业用途（包括 SaaS 服务）
- ⚠️ **网络服务条款**：如果你修改了后端代码并在网络上提供服务（如 SaaS），必须向用户公开你的修改后的源代码
- ⚠️ **前端 knowrite-ui**：保持 MIT 协议，可自由商用、修改、分发

**前端 `knowrite-ui`**：MIT 协议，可自由商用、修改、分发。

---

> 后端仓库：`knowrite`（AGPL-3.0）| 前端仓库：`knowrite-ui`（MIT）| 路线图：`docs/ROADMAP.md`
