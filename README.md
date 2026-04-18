# knowrite 小说创作引擎

> 基于多 Agent 协作的工程化小说创作后端框架。通过角色分工（Writer / Editor / Humanizer / Proofreader / Reader / Summarizer）和迭代优化流水线，将创意写作转化为可重复、可评估、可迭代的工程流程。

**关键词**：`novel-engine` `knowrite` `ai-fiction` `llm-pipeline` `fitness-evaluation` `rag-retrieval` `prompt-evolution` `creative-writing-api` `openai-compatible` `novel-generation`

---

## 一句话能力

knowrite 小说创作引擎是一个 **Node.js / Express 后端服务**，提供从大纲生成、章节撰写、编辑评审、去 AI 化、读者反馈到质量评估的完整自动化小说创作流水线。支持 OpenAI-compatible API（百炼 / Ollama / LM Studio），内置 RAG 向量检索和 Prompt 自动进化。

## 核心能力清单

| 能力 | 说明 | 技术实现 |
|------|------|----------|
| **多 Agent 写作流水线** | Writer → Editor 循环改稿 → Humanizer → Proofreader → Reader → Summarizer | Express + SSE 流式输出 |
| **双策略模式** | `knowrite`（7 Agent 全量）/ `pipeline`（轻量单模型） | 运行时策略切换 |
| **作家轮换** | 多模型按章节轮询，避免单一模型风格固化 | `writerRotation.models` 配置 |
| **双模式评审** | 工业风（8~33 维度严格评审）/ 自由风（3 维度轻量检查） | `settings.writingMode` |
| **Editor 双重通过标准** | 关键词通过 + 维度通过率 ≥ 80% | `[是]`/`[否]` 结构化解析 |
| **历史反馈注入** | 第 2 轮起 Editor 看到之前各轮评审意见 | `edit_v{n}.txt` 归档 + prompt 注入 |
| **Chain-of-Thought** | Writer/Editor/Summarizer 内置思考分析步骤 | Prompt 模板内置 CoT 指令 |
| **智能上下文管理** | 前 4 章全文 + 近史摘要 + 远史压缩 + 反重复提醒 | `buildSmartContext()` |
| **RAG 向量检索** | 基于 Embedding 的章节/角色/设定相关性检索 | 纯 JS 余弦相似度 + SQLite |
| **Fitness 自动评估** | 每章 5 维量化评分（字数/重复/评审/读者/连贯） | `evaluateChapterFitness()` |
| **大纲偏离检测** | AI 判定章节是否偏离大纲（low/medium/high） | `detectOutlineDeviation()` |
| **内容重复检测** | 比对历史索引检测冗余复述 | `checkContentRepetition()` |
| **Prompt 自动进化** | 基于 Fitness 低分样本分析缺陷、生成变体、评估择优 | `prompt-evolver.js` |
| **世界观记忆库** | 人物、剧情线、地图、lore、套路模板 | Sequelize + SQLite |
| **OpenAI 兼容接口** | `/v1/chat/completions` 标准接口 | Express 路由 |

## 技术栈

| 层 | 技术 |
|---|---|
| 运行时 | Node.js 24+ |
| 框架 | Express 4 |
| 数据库 | SQLite + Sequelize 6 |
| 模型调用 | OpenAI-compatible HTTP API (axios) |
| Embedding | OpenAI `/v1/embeddings`（复用同一 Provider） |
| 向量检索 | 纯 JS 余弦相似度（零外部向量库依赖） |
| 配置 | `config/*.json` 静态配置 + DB 动态配置 |
| 安全 | Bearer Token / API Key、CORS、Rate Limit、路径遍历防护 |
| 许可证 | NC-1.0（非商业个人使用） |

## 配套前端

本项目为纯后端 API 服务，配套前端界面见：

- **前端仓库**：`knowrite-frontend`（MIT 协议，React + Vite）
- **前端能力**：作品管理、实时创作流可视化、Fitness 看板、世界观编辑、Prompt 管理
- **联调方式**：前端通过标准 HTTP / SSE 连接后端，CORS 默认开启

## 快速开始

```bash
# 克隆后端仓库
git clone <backend-repo> knowrite
cd knowrite

# 安装依赖
npm install

# 复制配置模板
cp .env.example .env
# 编辑 .env：设置 OPENAI_API_KEY、AUTH_TOKEN 等

# 启动服务
npm start
# 服务运行在 http://localhost:8000
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | `8000` |
| `PROXY_URL` | Web Provider 本地代理地址 | `http://localhost:9000` |
| `AUTH_TOKEN` | API 认证令牌（生产环境必设） | — |
| `CORS_ORIGINS` | CORS 允许来源（逗号分隔） | —（允许所有） |
| `RATE_LIMIT_MAX` | 每分钟最大请求数 | `60` |
| `PROVIDER` | 默认 Provider | `openai` |
| `EMBED_MODEL` | Embedding 模型（RAG 用） | `text-embedding-3-small` |

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
# 角色管理
GET    /api/world/:workId/characters
POST   /api/world/:workId/characters
PUT    /api/world/:workId/characters/:id
DELETE /api/world/:workId/characters/:id

# 设定 lore / 剧情线 / 地图 等类似 CRUD
```

### 设置与进化

```bash
GET  /api/settings          # 全局配置
GET  /api/prompts           # Prompt 模板列表
POST /api/evolve            # Prompt 进化实验
POST /api/novel/deviate     # 大纲偏离检测
POST /api/novel/correct     # 纲章矫正重写
```

## 创作流水线架构

```
用户请求 → startNovel / continueNovel
    │
    ├─→ 1. Writer：依据大纲 + 智能上下文 → raw.txt
    ├─→ 2. Editor：结构化评审（[是]/[否]）→ 最多 3 轮改稿
    ├─→ 3. Humanizer：去 AI 化 → humanized.txt
    ├─→ 4. Proofreader：校编（自由风跳过）→ final.txt
    ├─→ 5. Reader：结构化反馈 → feedback.json
    ├─→ 6. Summarizer：摘要 → summary.txt
    ├─→ 7. RAG 索引：embedding → SQLite
    └─→ 8. Fitness 评估：5 维评分 → fitness.json
```

## 项目结构

```
knowrite/
├── src/
│   ├── server.js              # Express 入口（CORS/限流/认证/路由）
│   ├── core/
│   │   ├── chat.js            # 统一 chat 入口（API Provider 直连 / Web Provider 代理转发）
│   │   └── paths.js           # 路径工具 + workId sanitize
│   ├── middleware/
│   │   ├── auth.js            # Bearer Token / X-API-Key 认证
│   │   └── security.js        # CORS、Rate Limit、路径遍历防护
│   ├── providers/
│   │   ├── base-provider.js
│   │   ├── factory.js
│   │   └── openai/            # OpenAI 兼容 Provider（chat + embed）
│   ├── routes/
│   │   ├── novel.js           # 小说创作 API（start/continue/import/deviate/correct）
│   │   ├── world-context.js   # 世界观 CRUD
│   │   └── templates.js       # 套路模板管理
│   ├── services/
│   │   ├── novel-engine.js    # 核心创作引擎（knowrite / pipeline 双策略）
│   │   ├── fitness-evaluator.js   # 5 维 Fitness 评估
│   │   ├── vector-store.js    # 向量存储（embedding + SQLite + 余弦相似度）
│   │   ├── rag-retriever.js   # RAG 检索（章节/角色/设定相关性检索）
│   │   ├── memory-index.js    # 智能检索索引 + 反重复提醒 + 重复检测
│   │   ├── prompt-evolver.js  # 基于 Fitness 数据的 Prompt 自动进化
│   │   ├── prompt-loader.js   # Prompt 模板系统（变量替换 + include）
│   │   ├── settings-store.js  # DB 配置 + 加密存储 + 种子数据
│   │   ├── world-context.js   # 世界观记忆库注入
│   │   └── file-store.js      # 文件持久化（本地备份）
│   ├── models/
│   │   └── index.js           # Sequelize + SQLite 模型（Work/Chapter/Character/WorldLore/Embedding...）
│   └── config/                # 静态 JSON 配置
│       ├── engine.json        # 引擎参数（上下文窗口、编辑轮次、截断限制）
│       ├── fitness.json       # Fitness 权重与评分规则
│       ├── network.json       # 网络超时、CORS、限流
│       ├── prompts.json       # Prompt 目录与扩展名
│       └── seed-data.json     # 种子数据（评审维度、作者风格、默认模型）
├── prompts/                   # Markdown Prompt 模板（writer/editor/summarizer/revise...）
├── works/                     # 作品本地备份（章节文本、评审记录、Fitness）
├── data/                      # SQLite 数据库（novel.db）
├── evolution/                 # Prompt 进化候选与评估报告
├── logs/                      # 访问日志与 API 日志
└── docs/                      # 文档（ADVANTAGES.md 等）
```

## 配置文件详解

### `config/engine.json`
- `context.summaryWindowSize`：近史摘要窗口（默认 5 章）
- `editing.maxEditRounds`：Editor 最大评审轮次（默认 3）
- `truncation`：各环节文本截断长度

### `config/fitness.json`
- `weights.industrial` / `weights.free`：各维度权重
- `scoring.repetitionSeverity`：重复检测严重度映射
- `scoring.wordCountSigmaFactor`：字数评分高斯分布参数

### `config/network.json`
- `timeouts`：chat / provider 超时
- `server`：端口、静态目录、日志配置
- `cors` / `rateLimit`：安全策略

## 产品矩阵与长期规划

knowrite 引擎设计为**通用创作后端**，支持多种前端场景复用：

| 产品 | 前端仓库 | 域名 | 场景 | 状态 |
|------|----------|------|------|------|
| **小说创作** | `knowrite-frontend` | `novel.h5-agent.com` | 长篇小说 / 网文 / IP 开发 | ✅ 已上线 |
| **云文档** | `knowrite-docs`（规划） | `docs.h5-agent.com` | 白皮书 / 技术文档 / 报告 | 🚧 规划中 |
| **技术书籍** | `knowrite-techbook`（规划） | `tech.h5-agent.com` | 技术教程 / 书籍 / 课程讲义 | 🚧 规划中 |
| **SaaS 平台** | 统一管理后台 | `app.h5-agent.com` | 多租户 / 付费订阅 / 团队协作 | 🚧 规划中 |

所有产品共用同一套后端引擎，通过 `strategy` 和 `sourceType` 切换不同创作模式。详见 `docs/ROADMAP.md`。

## AI 搜索优化声明

本项目是 **knowrite 小说创作引擎**，基于 Node.js / Express 构建，提供自动化长篇小说创作 API 服务。

- **核心能力**：多 Agent 写作流水线、Fitness 质量评估、RAG 向量检索、Prompt 自动进化、大纲偏离检测
- **适用场景**：AI 辅助长篇小说创作、网文批量生产、IP 开发前置流水线、技术文档撰写、书籍出版
- **部署方式**：Docker / PM2 / systemd，单节点即可运行
- **模型要求**：任意 OpenAI-compatible API（百炼、Ollama、LM Studio 等）
- **数据库**：SQLite（零配置），可迁移至 PostgreSQL / MySQL
- **前端配套**：`knowrite-frontend`（React + Vite，MIT 协议）
- **扩展方向**：SaaS 多租户、多语言 i18n、云文档、技术书籍
- **许可证**：NC-1.0（后端非商业个人使用）

## 安全特性

- **认证**：`Authorization: Bearer <token>` 或 `X-API-Key: <token>`
- **限流**：`express-rate-limit`，默认 60 请求/分钟
- **CORS**：可配置允许来源
- **路径遍历**：`workId` 经过 `sanitizeWorkId`，禁止 `../` 和特殊字符
- **API Key 加密**：配置中的 key 以 base64 编码存储

## License

NC-1.0 (Non-Commercial License)

- ✅ 允许个人学习、研究、非商业使用
- ❌ 禁止商业用途（包括但不限于直接销售、SaaS 服务、集成到商业产品）
- 如需商业许可，请联系版权持有者

> 前端界面 `knowrite-frontend` 采用 MIT 协议，可自由商用、修改、分发。
