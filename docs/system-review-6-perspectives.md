# 六维专家评审报告：knowrite 小说生成系统

**评审日期**：2026-04-15  
**评审视角**：产品、策划、编辑、作者、架构师、AI 专家

---

## 一、产品视角：用户体验与工作流缺口

### 🔴 P1 严重问题

| 问题 | 位置 | 影响 | 修复建议 |
|------|------|------|---------|
| **Web UI 策略选择被硬编码为 pipeline** | `public/novel.html:501` | 用户选再多高级配置，前端永远发 `strategy: 'pipeline'`，多 Agent 精修功能被浪费 | 在创建表单增加策略下拉框（pipeline / knowrite），并提示耗时/成本差异 |
| **无取消/断点续传机制** | `src/routes/novel.js` SSE 端点 | 10–15 分钟的长流程一旦网络闪断，用户必须从头开始；崩溃后没有 checkpoint | SSE 端点接入 `AbortController`；引擎支持 `resumeFrom(workId, stepKey)` |
| **无批量/队列管理** | 全局 | 只能一章一章手动点，无法"今晚自动写 5–10 章" | 增加轻量内存队列 `JobQueue`，支持 `POST /batch` |

### 🟡 P2 体验问题

| 问题 | 位置 | 修复建议 |
|------|------|---------|
| 模型输入是自由文本，无校验 | `novel.html:193-205` | 提供「模型下拉框 + 高级自定义」二级输入，避免 `deepseek-v33` 类拼写错误 |
| 快速续写只展示最近 5 个作品 | `novel.html:554` | 增加分页、按标题搜索、按策略筛选 |
| 无成本/Token 预估 | 全局 | 在「开始创作」前给出预估 Token 数和模型调用次数 |

---

## 二、策划视角：系统设计与进化架构

### 🔴 P1 严重问题

| 问题 | 位置 | 影响 | 修复建议 |
|------|------|------|---------|
| **"ReAct" 名不副实** | `react-review-engine.js:28` | 只有 Thought + Action，没有 Observation 和循环迭代，实为「多维度 JSON 评审」 | 重命名为 `MultiDimensionReview`；若保留 ReAct 品牌，需实现真正的「评分→观察→再评分」循环 |
| **评审员各自为战，无交叉辩论** | `react-review-engine.js:330` | product 和 planner 的冲突无法被消解，合成阶段只能做简单票数统计 | 增加可选的 `deliberation` 阶段：评审员先看同伴意见，再修订自己的评分 |
| **通过规则数学错误（小面板 100% 通过制）** | `react-review-engine.js:222` | 章节评审只有 4 个 Agent，但 Prompt 要求 "≥4/5"，即必须 **全票通过** | 将规则改为参数化：`passCount >= Math.ceil(agentKeys.length * 0.75)` |
| **Prompt 进化是"猜分"而非真 A/B** | `prompt-evolver.js:141` | `evaluateVariant` 让 LLM 凭 800 字 Prompt 片段"预测"效果，从未真正跑一次生成 | **MVP 改进**：对变体 Prompt，真实调用 `writeChapterMultiAgent` 的 mock 流程（或只跑摘要/压缩环节）来测实际 Fitness |
| **无全书纲章偏离趋势看板** | `novel-engine.js:1046` | 只能单章检测偏离，无法回答"写到第 30 章时全书有多少章跑题了" | 在 `meta` 中累计 `deviationScores`，超过阈值时触发「大纲修订 Agent」 |

### 🟡 P2 设计改进

- **大纲与正文耦合过强**：多卷模式下，卷与卷之间只允许「低耦合」，但未提供「大纲版本号」机制。建议给 `outline_detailed.txt` 增加 `version` 字段，正文永远绑定特定版本的大纲。

---

## 三、编辑视角：内容质量、重复与一致性

### 🔴 P1 严重问题

| 问题 | 位置 | 影响 | 修复建议 |
|------|------|------|---------|
| **Editor Prompt 的 □ 复选框易被模型镜像** | `prompts/editor.md:2` | LLM 常把 □ 原样复制一遍，却不给出实质性评价 | 将 □ 改为 **"1. 钩子：[是/否] 证据："** 的强制问答格式 |
| **Editor 只能看到稿件前 3000 字符** | `novel-engine.js:434` | 2000 字章节约 4000+ 汉字，Editor 看不到结尾钩子 | 传给 Editor 的文本改为：**前 1500 字 + ... + 后 1500 字**，或干脆传全文 |
| **Humanizer 在 Editor 闭环之外** | `novel-engine.js:484` | 编辑通过后才做去 AI 化，但 Humanizer 可能引入新的逻辑错误/人设漂移，仅由轻量 Proofreader 把关 | **两种改法**：① 将 Humanizer 放入编辑循环内；② 在 Humanizer 后再加一轮「编辑复核」 |
| **Proofreader Prompt 过于简略** | `proofreader.md` | 没有禁止 Proofreader 改情节/改情绪的约束，可能把对话改 bland | 明确写入："禁止改变原文叙事风格、人物情绪、情节走向，只修正错别字和标点" |
| **重复检查只查前 4000 字** | `memory-index.js:165` | 后半个章节的重复完全被忽略 | 分块检查：每 4000 字滑动窗口（overlap 500 字），或按语义摘要向量查重 |

### 🟡 P2 质量问题

- **防重复提醒的字符串匹配太糙**：`memory-index.js:117` 用 `outlineLower.includes(term)`，导致「主角」「修炼」这种高频词每次都触发提醒，产生噪音。
  - *修复*：对术语计算 TF-IDF 权重，或使用 LLM 做「 salience 判断」后再生成提醒。

---

## 四、作者视角：创作工作流与 Prompt 质量

### 🔴 P1 严重问题

| 问题 | 位置 | 影响 | 修复建议 |
|------|------|------|---------|
| **Writer Prompt 缺少场景级脚手架** | `prompts/writer.md` | 模型每章都要从零发明 pacing 和对话节奏 | 增加可选 `scene-beats` 变量，由 outline 预先生成「场景节拍表」再注入 writer |
| **无人设声纹字典，长期必漂移** | 全局 | 写 50 章后，配角 A 说话从「莽夫粗粝」变成「文质彬彬」 | 在 `memory-index.js` 中提取并维护 `voice_fingerprints`：每个核心角色的惯用句式、口头禅、平均句长 |
| **Revise Prompt 要求重写整章** | `prompts/revise.md` | 5000 token 输出；且每次修改都全文重写，极易修 A 坏 B | 改为「只输出修改段落 + 行号」，引擎做 patch 合并 |
| **风格扩展硬编码且不可扩展** | `novel-engine.js:12` | 想新增「乌贼」「猫腻」风格必须改源码 | 将风格定义迁移到 `prompts/styles/` 下的 JSON/YAML，运行时热加载 |

### 🟡 P2 体验问题

- **Edit 循环是黑盒，无法人工 override**：`MAX_EDIT_ROUNDS = 3` 硬编码，若 Editor 过于挑剔，作者只能干等。
  - *修复*：Web UI 增加「接受当前稿」按钮，向 SSE 发送 `override` 信号提前结束循环。

---

## 五、架构师视角：代码结构、可扩展性与性能

### 🔴 P1 严重问题

| 问题 | 位置 | 影响 | 修复建议 |
|------|------|------|---------|
| **循环依赖** | `novel-engine.js ↔ memory-index.js ↔ react-review-engine.js` | 破坏静态分析、单元测试困难、模块加载顺序脆弱 | 提取 `src/core/` 目录：将 `runStreamChat`、`getWorkDir` 放入无下游依赖的核心模块 |
| **同步 I/O 阻塞事件循环** | `novel-engine.js:105-126` | `writeFileSync`、`readFileSync`、`appendFileSync` 在高并发时会卡死其他请求 | 将 tracing、fitness、meta 的 I/O 改为 `fs.promises` 或 fire-and-forget 异步队列 |
| **每次 Agent 调用都重新认证 Provider** | `novel-engine.js:187-208` | Playwright 浏览器上下文每章被创建+销毁多次，极慢且资源泄漏风险高 | 在 `server.js` 中维护 Provider 会话池（或单例），`runStreamChat` 只取连接复用 |
| **无超时与重试** | `runStreamChat` | 模型 provider 一旦挂住，请求永远 hang 住 | 增加 `Promise.race(timeout)` + 指数退避重试 |
| **无数据库索引，作品库扫描 O(n)** | `novel-engine.js:134` | `listWorks()` 每次全量 `readdirSync` + `statSync` | 引入 SQLite 做元数据索引；至少给 `listWorks()` 加缓存 TTL |

### 🟡 P2 改进

- **Tracing 的 fire-and-forget 无背压保护**：`appendFileSync` 在磁盘慢时会阻塞流。
  - *修复*：用 `p-queue` 或自定义异步队列写 trace。

---

## 六、AI 专家视角：模型选择、上下文管理与评估方法论

### 🔴 P1 严重问题

| 问题 | 位置 | 影响 | 修复建议 |
|------|------|------|---------|
| **模型是裸字符串，无能力注册表** | `novel-engine.js:710` | 用户可输入任意字符串；系统不知道模型上下文长度、是否支持 JSON Mode、成本 | 创建 `models.json` 注册表，包含 `max_tokens`、`supports_json`、`cost_per_1k`、`temperature_default` |
| **无 Token 感知的上下文截断** | `buildRollingContext` | 将压缩前文 + 5 摘要 + 远史 + 纲章 + core-rules 全部拼入，可能超过 8k–16k 被静默截断 | 引入 `tiktoken`（或 `js-tiktoken`）做 token 计数，按优先级截断：保留 outline > 前一章 > 近史摘要 > 远史提要 |
| **任意字符截断而非 Token 截断** | 多处 `substring(0, 3000/4000)` | 3000 中文字符 ≈ 4500 tokens，容易超限 | 统一封装 `truncateTokens(text, maxTokens)` 替换所有 `substring` |
| **Fitness 的 coherence 是占位符** | `fitness-evaluator.js:108` | `coherenceScore = wordScore`，20% 权重毫无意义 | 实现 LLM-based outline-adherence scorer：让模型给「本章与纲章匹配度」打分 |
| **JSON 解析代码到处复制** | 所有服务 | 每个文件都重写一遍 `replace(/```json/) + regex` | 新建 `src/utils/safe-json.js`，统一提供 `safeJsonParse(text)` |
| **Prompt 中完全没有 Few-Shot** | 所有 `.md` | 结构化任务（如 JSON 输出、去 AI 化）没有示例，可靠性低 | 在 `reader-feedback.md`、`editor.md`、`summary.md` 中加入 1–2 个高质量示例 |
| **Temperature / 采样参数未区分** | `runStreamChat` | Writer 需要较高 temperature（创意），Reviewer 需要较低 temperature（稳定 JSON） | 在模型注册表中按 `agentType` 配置默认 temperature，允许覆盖 |

---

## 七、优先修复清单（按投入产出比排序）

| 优先级 | 修复项 | 涉及文件 | 预估工作量 |
|--------|--------|---------|-----------|
| 🔥 P0 | 打破循环依赖（提取 `core/`） | `novel-engine.js`, `memory-index.js`, `react-review-engine.js` | 2h |
| 🔥 P0 | Web UI 策略选择硬编码修复 | `public/novel.html` | 30min |
| 🔥 P0 | Editor Prompt 去 □ 化 | `prompts/editor.md` | 20min |
| 🔥 P0 | 增加 Provider 会话复用 | `src/server.js`, `novel-engine.js` | 3h |
| 🔴 P1 | Token 感知的上下文截断 | `novel-engine.js:311+` | 3h |
| 🔴 P1 | 将 sync I/O 改为 async（meta/trace/fitness） | `novel-engine.js:105-126` | 2h |
| 🔴 P1 | 统一 JSON 安全解析工具 | 新建 `src/utils/safe-json.js` | 1h |
| 🔴 P1 | 修复 ReAct 通过规则数学错误 | `react-review-engine.js:222` | 15min |
| 🟡 P2 | Humanizer 后置编辑复核 | `novel-engine.js:484+` | 2h |
| 🟡 P2 | 增加 `models.json` 能力注册表 | 新建 `config/models.json` | 2h |
| 🟡 P2 | Prompt 增加 Few-Shot 示例 | `prompts/reader-feedback.md`, `editor.md`, `summary.md` | 2h |
| 🟢 P3 | 实现真正 A/B 的 Prompt 进化 | `prompt-evolver.js:141+` | 1d |
| 🟢 P3 | 增加人设声纹字典 | `memory-index.js` + 提取流程 | 1d |

---

## 八、长期建议（3–6 个月）

1. **引入结构化数据库**：SQLite 存储 `works_meta`、`chapters`、`reviews`、`traces`，替代纯文件扫描。
2. **建立 evaluation harness**：用 20–50 章已知作品构建回归测试集，每次改 Prompt 前跑一遍自动评分。
3. **实现真正的 ReAct 或 Reflexion**：让 Review Agent 能调用工具（如读取 memory_index、检索前文），基于观察结果 revise 评分。
4. **多模态/长文本优化**：当上下文超过 32k 时，切换为「只保留 embedding 检索 + 关键摘要」的 RAG 模式。

---

**总结**：本系统功能覆盖面广（创作 → 评审 → 记忆 → 进化 → 矫正），但在**代码结构（循环依赖、同步 I/O）、产品质量（前端硬编码、无断点续传）、AI 工程（无 token 管理、JSON 解析碎片化）**三个维度存在明显短板。建议先集中处理 P0/P1 项，再逐步推进长期改进。
