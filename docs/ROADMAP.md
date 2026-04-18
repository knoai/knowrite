# 长期路线图 Roadmap

> 本路线图记录 knowrite 小说创作引擎的长期发展方向。短期优化见 writing-capability-audit.md。

---

## Phase 1：核心引擎夯实（已完成 ✅）

- [x] 多 Agent 写作流水线（Writer → Editor → Humanizer → Proofreader → Reader → Summarizer）
- [x] 双策略模式（knowrite / pipeline）
- [x] Fitness 多维度自动评估
- [x] Editor 结构化评审 + 双重通过标准
- [x] 历史反馈注入（Editor 循环记忆）
- [x] Chain-of-Thought 指令（Writer / Editor / Summarizer）
- [x] RAG 向量检索（零外部依赖，纯 JS + SQLite）
- [x] Prompt 自动进化（基于 Fitness 数据）
- [x] 世界观记忆库（人物 / 剧情线 / 地图 / lore）
- [x] 前后端分离（`knowrite` AGPL-3.0 + `knowrite-ui` MIT）
- [x] 安全体系（认证 / CORS / 限流 / 路径遍历防护 / API Key 加密）
- [x] AI 搜索优化（llms.txt / copilot-instructions / SEO meta / robots.txt）

---

## Phase 2：商业化 SaaS（Sass）

### 目标
将后端引擎从单机部署升级为可对外服务的 SaaS 平台，支持多租户、付费订阅、云端协作。

### 关键功能

| 模块 | 功能 | 优先级 |
|------|------|--------|
| **多租户** | 用户注册/登录、Workspace 隔离、角色权限（Owner / Editor / Viewer） | P0 |
| **订阅体系** | 免费版（限制章节数/Agent数）→ 专业版 → 企业版 | P0 |
| **计费系统** | Token 用量统计、API 调用计费、月度账单 | P1 |
| **云端存储** | 作品云端同步、版本历史、自动备份 | P1 |
| **协作编辑** | 多人实时协作（WebSocket）、评论批注、@提及 | P2 |
| **分享发布** | 作品分享链接、阅读模式、导出 PDF / EPUB / Word | P2 |
| **团队管理** | 团队 Workspace、成员邀请、权限分配 | P2 |

### 技术方案
- 数据库：SQLite → PostgreSQL（多租户隔离 + 高并发）
- 缓存：Redis（会话、Token 用量计数）
- 对象存储：S3/MinIO（作品附件、导出文件）
- 支付：Stripe / 支付宝 / 微信
- 部署：Docker + Kubernetes / 云平台 Serverless

### 商业许可
- 后端引擎保持 AGPL-3.0（开源，网络服务衍生作品需开源）
- SaaS 平台代码闭源，基于引擎二次开发
- 开源社区版本与商业 SaaS 版本双轨并行

---

## Phase 3：多语言国际化（i18n）

### 目标
支持中文、英文、日文、韩文等多语言创作与界面，扩展海外市场。

### 关键功能

| 维度 | 说明 |
|------|------|
| **界面 i18n** | React 前端全面国际化，支持 lang 切换 |
| **Prompt i18n** | 多语言 Prompt 模板（writer-en.md / writer-ja.md / writer-ko.md） |
| **创作语言** | 支持非中文创作（英文小说、轻小说等） |
| **评审维度** | 不同语言的评审标准适配（如英文的 show-don't-tell） |

### 技术方案
- 前端：`react-i18next` + `i18next-resources-to-backend`
- 后端：Prompt 模板按语言后缀加载（`writer.md` → `writer-en.md`）
- 数据库：文本字段 UTF-8 全支持，无需迁移
- 配置：`config/i18n.json` 管理支持的语言列表和默认语言

### 扩展预留
- Prompt 模板目录结构：`prompts/zh/`、`prompts/en/`、`prompts/ja/`
- API 增加 `?lang=` 参数，后端按语言加载对应模板
- Fitness 评估权重按语言差异化配置

---

## Phase 4：云文档（不同前端 + 独立网址）

### 目标
基于同一套后端引擎，面向「文档 / 白皮书 / 报告」创作场景，提供独立前端。

### 场景差异

| 维度 | 小说创作 | 云文档创作 |
|------|----------|------------|
| Agent 角色 | Writer / Editor / Reader | Author / Reviewer / FactChecker |
| 评审维度 | 情节/人物/节奏/钩子 | 逻辑/数据/引用/可读性 |
| 输出格式 | 章节文本 | Markdown / 富文本 / 幻灯片 |
| 上下文管理 | 人物/设定索引 | 引用文献 / 数据源索引 |
| 目标用户 | 网文作者 / IP 开发者 | 技术写作者 / 产品经理 / 研究员 |

### 技术方案

**前端**：`knowrite-docs`（独立仓库）
- 基于 React + Vite，复用 `components/ui/` 基础组件
- 编辑器：Markdown / 富文本双模式（BlockNote / Milkdown）
- 文档结构：树状大纲 + 段落级协作
- 导出：PDF / DOCX / PPTX / HTML

**后端复用**：
- 同一套 `knowrite` 后端，通过 `strategy: 'document'` 切换流水线
- 新增 Agent：`FactChecker`（事实核查）、`Citer`（引用格式化）
- 新增 Prompt 模板：`document-author.md`、`document-reviewer.md`
- RAG 向量库索引「引用文献」而非「章节摘要」

**独立部署**：
- 域名：`docs.h5-agent.com`
- 共享用户体系（SaaS 阶段实现后复用）
- 独立品牌：「knowrite 云文档」

---

## Phase 5：技术类书籍创作（不同前端 + 独立网址）

### 目标
面向「技术书籍 / 教程 / 课程讲义」创作场景，提供代码示例管理、技术图表、LaTeX 公式等专用能力。

### 场景差异

| 维度 | 小说创作 | 技术书籍创作 |
|------|----------|--------------|
| Agent 角色 | Writer / Editor / Reader | Author / TechReviewer / CodeReviewer |
| 评审维度 | 情节/人物/节奏 | 技术准确性/代码可运行性/教学逻辑 |
| 输出格式 | 纯文本章节 | Markdown + 代码块 + 图表 + 公式 |
| 上下文管理 | 人物/设定索引 | API 文档 / 代码仓库索引 |
| 特殊能力 | — | 代码执行验证、LaTeX 渲染、Mermaid 图表 |
| 目标用户 | 网文作者 | 技术作者 / 开源维护者 / 教育者 |

### 技术方案

**前端**：`knowrite-techbook`（独立仓库）
- 基于 React + Vite
- 编辑器：MDX 支持（React 组件嵌入 Markdown）
- 代码块：Monaco Editor / CodeMirror，支持多语言高亮
- 图表：Mermaid / KaTeX（公式）/ Excalidraw（手绘图）
- 代码验证：后端沙箱执行（Docker / Firecracker）
- 导出：PDF（via Puppeteer）/ EPUB / 在线阅读站

**后端扩展**：
- 新增 Agent：`CodeReviewer`（代码审查）、`TechReviewer`（技术准确性）
- 新增 Prompt：`techbook-author.md`、`techbook-reviewer.md`、`code-reviewer.md`
- 新增 RAG 索引源：代码仓库、API 文档、技术博客
- Fitness 维度：技术准确性、代码可运行性、教学逻辑

**独立部署**：
- 域名：`tech.h5-agent.com`
- 品牌：「knowrite 技术写作」

---

## 产品矩阵总览

```
                    ┌─────────────────────────────────────────┐
                    │      knowrite 创作引擎（后端）         │
                    │   Node.js / Express / SQLite / RAG      │
                    │   AGPL-3.0 协议（开源引擎）              │
                    └─────────────────────────────────────────┘
                                     │
            ┌────────────┬───────────┼───────────┬────────────┐
            │            │           │           │            │
            ▼            ▼           ▼           ▼            ▼
    ┌───────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
    │ 小说创作   │ │ 云文档   │ │ 技术书籍 │ │  SaaS   │ │ 多语言  │
    │ frontend  │ │ frontend │ │ frontend │ │ platform │ │ i18n   │
    │  MIT      │ │  MIT     │ │  MIT     │ │ 商业闭源 │ │ MIT    │
    └───────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘
         │              │            │            │           │
    novel.h5-     docs.h5-     tech.h5-     app.h5-      (all)
    agent.com     agent.com    agent.com    agent.com     domains
```

### 前端复用策略

```
knowrite-ui/          # 小说创作（基础前端）
    ├── src/components/ui/     # 基础 UI 组件库（Button, Card, Input...）
    ├── src/api/               # API 封装（fetch / SSE）
    └── src/hooks/             # 通用 Hooks

knowrite-docs/              # 云文档（复用基础组件）
    ├── symlink: ../knowrite-ui/src/components/ui/
    ├── symlink: ../knowrite-ui/src/api/
    └── 独有：文档编辑器、大纲树、导出模块

knowrite-techbook/          # 技术书籍（复用基础组件）
    ├── symlink: ../knowrite-ui/src/components/ui/
    ├── symlink: ../knowrite-ui/src/api/
    └── 独有：MDX 编辑器、代码验证、图表渲染
```

---

## 优先级排序

| 阶段 | 预计时间 | 商业价值 | 技术难度 |
|------|----------|----------|----------|
| Phase 2 SaaS | 3-6 个月 | ★★★★★ | ★★★★☆ |
| Phase 3 i18n | 1-2 个月 | ★★★★☆ | ★★☆☆☆ |
| Phase 4 云文档 | 2-3 个月 | ★★★★☆ | ★★★☆☆ |
| Phase 5 技术书籍 | 3-4 个月 | ★★★☆☆ | ★★★★☆ |

> 建议顺序：i18n → 云文档 → SaaS → 技术书籍。
> i18n 是基础能力，云文档可验证引擎通用性，SaaS 是商业化核心，技术书籍为垂直场景延伸。

---

## 扩展预留（代码层面）

### 已预留的扩展点

1. **多语言**：`config/prompts.json` 已支持按目录加载模板，未来扩展 `prompts/{lang}/` 结构
2. **多策略**：`novel-engine.js` 的 `writeChapterMultiAgent` / `writeChapterPipeline` 已支持按 `strategy` 切换
3. **新 Agent**：`config/engine.json` 的 `fileTemplates` 和 `models` 结构易于新增 Agent 角色
4. **新 RAG 源**：`vector-store.js` 的 `sourceType` 字段支持任意类型（`summary` / `character` / `lore` / `citation` / `code`）
5. **新 Fitness 维度**：`config/fitness.json` 的 `weights` 结构支持新增维度

### 待预留的扩展点

- [ ] SaaS 用户体系（`models/User.js`）
- [ ] Workspace 隔离（`models/Workspace.js`，所有现有模型增加 `workspaceId`）
- [ ] 订阅/计费（`models/Subscription.js`、`models/Billing.js`）
- [ ] OAuth 登录（GitHub / Google / 微信）
- [ ] WebSocket 协作通道
- [ ] 导出服务（PDF / EPUB / DOCX Worker）
