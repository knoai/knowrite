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
</p>

<p align="center">
  <a href="README.md">中文</a> | <a href="README.en.md">English</a>
</p>

---

AI Agent 自主写小说——写、审、改、评，全程接管。基于多 Agent 协作的工程化创作流水线，覆盖工业风严格评审与自由风快速创作双模式，内置 RAG 向量记忆、Fitness 五维质量评估和 Prompt 自动进化。

**Knowrite 是一个 Node.js / Express 后端服务**，提供从大纲生成、章节撰写、编辑评审、去 AI 化、读者反馈到质量评估的完整自动化小说创作 API。支持任意 OpenAI-compatible Provider（百炼、Ollama、LM Studio 等），零外部向量库依赖，单节点即可运行。

配套前端 [`knowrite-ui`](https://github.com/knoai/knowrite-ui)（React 19 + Vite + Tailwind CSS，MIT 协议）提供作品管理、实时创作流可视化、Fitness 看板、世界观编辑和 Prompt 管理。

---

## 快速开始

### 环境要求

- Node.js 24+
- 任意 OpenAI-compatible API Key

### 安装

```bash
# 克隆后端仓库
git clone https://github.com/knoai/knowrite.git
cd knowrite

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env，设置 OPENAI_API_KEY、AUTH_TOKEN 等

# 启动服务
npm start
# 服务运行在 http://localhost:8000
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

### 双策略模式

- **`knowrite`**（默认）：7 Agent 全量流水线，质量优先
- **`pipeline`**：轻量单模型快速模式，速度优先

运行时通过 `strategy` 参数切换，同一作品可在不同章节使用不同策略。

### 作家轮换

多模型按章节轮询，避免单一模型风格固化。在 `config/engine.json` 中配置 `writerRotation.models`，系统自动轮换。

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
    ├─→ 1. 上下文编译：大纲 + 近史全文 + 远史压缩 + 世界观 + RAG 检索 + 反重复提醒 + 真相片段
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
    └─→ 10. 输出治理：enqueue → L1 自动验证 → L2 LLM 验证 → human_review → release
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
│              注入 Writer ◄─────────────────────┘                 │         │
├──────────────────────────────────────────────────────────────────┼─────────┤
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

---

## 技术栈

| 层 | 技术 |
|---|---|
| 运行时 | Node.js 24+ |
| 框架 | Express 4 |
| 数据库 | SQLite + Sequelize 6 |
| 模型调用 | OpenAI-compatible HTTP API (axios) |
| Embedding | OpenAI `/v1/embeddings`（复用同一 Provider） |
| 向量检索 | 纯 JS 余弦相似度（零外部向量库依赖） |
| 流式输出 | Server-Sent Events (SSE) |
| 配置 | `config/*.json` 静态配置 + DB 动态配置 |
| 安全 | Bearer Token / API Key、CORS、Rate Limit、路径遍历防护 |

---

## 项目结构

```
knowrite/
├── src/
│   ├── server.js              # Express 入口（CORS/限流/认证/路由）
│   ├── core/
│   │   ├── chat.js            # 统一 chat 入口（Provider 直连 / Web Provider 代理转发）
│   │   └── paths.js           # 路径工具 + workId sanitize
│   ├── middleware/
│   │   ├── auth.js            # Bearer Token / X-API-Key 认证
│   │   └── security.js        # CORS、Rate Limit、路径遍历防护
│   ├── providers/
│   │   ├── base-provider.js
│   │   ├── factory.js
│   │   └── openai/            # OpenAI 兼容 Provider（chat + embed）
│   ├── routes/
│   │   ├── novel.js              # 小说创作 API（start/continue/import/deviate/correct）
│   │   ├── world-context.js      # 世界观 CRUD
│   │   ├── templates.js          # 套路模板管理
│   │   ├── temporal-truth.js     # 时序真相数据库 API
│   │   ├── author-fingerprint.js # 作者指纹 API
│   │   ├── output-governance.js  # 输出治理 API
│   │   └── input-governance.js   # 输入治理 API
│   ├── services/
│   │   ├── novel-engine.js       # 核心创作引擎（knowrite / pipeline 双策略）
│   │   ├── fitness-evaluator.js  # 5 维 Fitness 评估
│   │   ├── vector-store.js       # 向量存储（embedding + SQLite + 余弦相似度）
│   │   ├── rag-retriever.js      # RAG 检索（章节/角色/设定相关性检索）
│   │   ├── memory-index.js       # 智能检索索引 + 反重复提醒 + 重复检测
│   │   ├── prompt-evolver.js     # 基于 Fitness 数据的 Prompt 自动进化
│   │   ├── prompt-loader.js      # Prompt 模板系统（i18n 预留 + 变量替换）
│   │   ├── settings-store.js     # DB 配置 + 加密存储 + 种子数据
│   │   ├── world-context.js      # 世界观记忆库注入
│   │   ├── file-store.js         # 文件持久化（本地备份）
│   │   ├── temporal-truth.js     # 事件溯源 + 时间旅行查询
│   │   ├── truth-manager.js      # 真相管理（初始化/delta应用/投影/连续性检查）
│   │   ├── author-fingerprint.js # 5 层风格指纹分析 + 合规检测
│   │   ├── output-governance.js  # 生产者-消费者验证管道
│   │   └── input-governance.js   # plan + compose 输入治理
│   ├── models/
│   │   └── index.js              # Sequelize + SQLite 模型（Work/Chapter/Character/WorldLore/Embedding/TruthEvent/TruthState/TruthHook/TruthResource/AuthorFingerprint/WorkStyleLink/OutputQueue/OutputValidationRule/AuthorIntent/CurrentFocus/ChapterIntent...）
│   └── config/                # 静态 JSON 配置
│       ├── engine.json        # 引擎参数（上下文窗口、编辑轮次、截断限制）
│       ├── fitness.json       # Fitness 权重与评分规则
│       ├── network.json       # 网络超时、CORS、限流、静态目录
│       ├── prompts.json       # Prompt 目录与扩展名
│       └── seed-data.json     # 种子数据（评审维度、作者风格、默认模型）
├── prompts/                   # Markdown Prompt 模板（writer/editor/summarizer/revise...）
├── works/                     # 作品本地备份（章节文本、评审记录、Fitness）
├── data/                      # SQLite 数据库（novel.db）
├── evolution/                 # Prompt 进化候选与评估报告
├── logs/                      # 访问日志与 API 日志
└── docs/                      # 文档（ADVANTAGES.md / ROADMAP.md 等）
```

---

## 产品矩阵与长期规划

Knowrite 引擎设计为**通用创作后端**，支持多种前端场景复用：

| 产品 | 前端仓库 | 场景 | 状态 |
|------|----------|------|------|
| **小说创作** | `knowrite-ui` | 长篇小说 / 网文 / IP 开发 | ✅ 已上线 |
| **云文档** | `knowrite-docs`（规划） | 白皮书 / 技术文档 / 报告 | 🚧 规划中 |
| **技术书籍** | `knowrite-techbook`（规划） | 技术教程 / 书籍 / 课程讲义 | 🚧 规划中 |
| **SaaS 平台** | 统一管理后台 | 多租户 / 付费订阅 / 团队协作 | 🚧 规划中 |

所有产品共用同一套后端引擎，通过 `strategy` 和 `sourceType` 切换不同创作模式。详见 `docs/ROADMAP.md`。

---

## AI 搜索优化声明

本项目是 **Knowrite 小说创作引擎**，基于 Node.js / Express 构建，提供自动化长篇小说创作 API 服务。

- **核心能力**：多 Agent 写作流水线、输入/输出治理、时序真相数据库、全维度作者指纹、Fitness 质量评估、RAG 向量检索、Prompt 自动进化、大纲偏离检测
- **适用场景**：AI 辅助长篇小说创作、网文批量生产、IP 开发前置流水线、技术文档撰写、书籍出版
- **部署方式**：Docker / PM2 / systemd，单节点即可运行
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
- [ ] 多语言 i18n（Prompt 模板 + API 响应）
- [ ] 互动小说（分支叙事 + 读者选择）
- [ ] SaaS 多租户支持
- [ ] 平台格式导出（起点、番茄等）

---

## 参与贡献

欢迎贡献代码、提 issue 或 PR。

```bash
npm install
npm run dev        # 开发模式（nodemon）
npm start          # 生产模式
```

### 安全特性

- **认证**：`Authorization: Bearer <token>` 或 `X-API-Key: <token>`
- **限流**：`express-rate-limit`，默认 60 请求/分钟
- **CORS**：可配置允许来源
- **路径遍历**：`workId` 经过 `sanitizeWorkId`，禁止 `../` 和特殊字符
- **API Key 加密**：配置中的 key 以 base64 编码存储

---

## License

**后端**：AGPL-3.0 (GNU Affero General Public License v3.0)

- ✅ 允许个人学习、研究、修改、分发
- ✅ 允许商业用途（包括 SaaS 服务）
- ⚠️ **网络服务条款**：如果你修改了后端代码并在网络上提供服务（如 SaaS），必须向用户公开你的修改后的源代码
- ⚠️ **前端 knowrite-ui**：保持 MIT 协议，可自由商用、修改、分发

**前端 `knowrite-ui`**：MIT 协议，可自由商用、修改、分发。
