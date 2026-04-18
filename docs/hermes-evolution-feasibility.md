# Hermes Agent 式自动进化可行性分析

## 1. Hermes Agent 的核心机制回顾

Hermes Agent（Nous Research, 2026）之所以被称为"自我进化 Agent"，依赖以下四大支柱：

| 支柱 | 核心机制 | 关键技术 |
|------|---------|---------|
| **A. 持久记忆与经验萃取** | 三层记忆（Working / Episodic / Semantic），自动压缩、索引、检索 | `MEMORY.md`、`USER.md`、FTS5 + LLM Summarization |
| **B. Skill 自动生成与迭代** | 从完成任务中抽象出可复用 Skill，持续优化 | DSPy + GEPA（反射性进化） |
| **C. LLM-as-Judge 评估闭环** | 用评分标准（Rubric）自动评估输出质量，识别失败模式 | LLM Scorer、Fitness Function |
| **D. 安全的人机回环部署** | 所有改进以 Git PR 形式提出，人工审查后合并 | 约束验证、测试门控、Git 工作流 |

**关键洞察**：Hermes 并不训练模型权重，而是**进化文本资产**（Prompt、Skill 说明、工具描述），因此无需 GPU，每次优化成本仅 $2–10。

---

## 2. 当前小说系统的"进化成熟度"自评

### 2.1 已具备的模块（可直接作为进化基础）

| 模块 | 当前实现 | 对应 Hermes 支柱 |
|------|---------|-----------------|
| `memory-index.js` | 实体/情节线/规则索引 + 防重复提醒 | **A. 持久记忆**（初阶） |
| `react-review-engine.js` | ReAct 评审循环（product/planner/writer/editor/tech） | **C. LLM-as-Judge**（初阶） |
| 滚动上下文压缩 | 近史摘要 5 章 + 远史提要 + 前一章压缩 | **A. 记忆压缩**（中阶） |
| `SKILL.md` / `AGENTS.md` | Kimi CLI 的 Skill 体系和项目级代理规范 | **B. Skill 抽象**（已有土壤） |
| `core.md` | 12 维度创作规范，已注入所有 Agent Prompt | **B. 程序化指令**（中阶） |
| 章节级后处理 | 重复检查 + 单章 ReAct 评审 | **C. 评估闭环**（中阶） |
| 元数据追踪 | `meta.json` 记录每章模型、文件、评审结果 | **D. 可追溯性**（初阶） |

### 2.2 尚缺失的关键拼图

| 缺失项 | 影响 | 实现难度 |
|--------|------|---------|
| **统一 Prompt 资产库** | 当前 Prompt 硬编码在 `novel-engine.js` 中，无法被外部程序读取和变异 | 中 |
| **自动化评估数据集** | 没有"已知好/坏章节"的标注数据集，无法量化 Prompt 改动的效果 | 高 |
| **Prompt / Skill 变异引擎** | 没有 GEPA / DSPy / MIPROv2 的集成，无法自动生成 Prompt 变体 | 中高 |
| **执行追踪（Execution Traces）** | 没有结构化记录每次 Agent 调用的输入、输出、中间状态 | 中 |
| **Fitness Function（适应度函数）** | 没有将评审结果、字数、重复检查、用户反馈综合为一个可比较的分数 | 中 |
| **安全约束与测试门控** | 没有自动化测试验证 Prompt 改动不会破坏系统 | 中 |

---

## 3. 结论：是否有实现可能？

**答案是：完全可行，且成本远低于通用 Agent 的自动进化。**

原因如下：

1. **领域封闭**：小说生成是一个**结构化流程**（大纲 → 分卷纲章 → 章节 → 润色），每一步的输出形式固定（文本文件），评估标准明确（字数、重复度、ReAct 评分），比通用任务更容易建立 Fitness Function。
2. **文本资产丰富**：Prompt、Skill 说明、`core.md`、`AGENTS.md` 都是可以进化的文本资产，完全符合 Hermes "不训练权重、只进化文本" 的低成本范式。
3. **评估器已就位**：`react-review-engine.js` 的 5 个评审 Agent 可以直接作为 LLM-as-Judge 的基础设施，无需从零搭建。
4. **记忆层已就绪**：`memory-index.js` 和滚动上下文压缩已经是 Semantic Memory 的雏形，只需增加"失败经验"的反向索引即可。

---

## 4. 分阶段实现路线图

### Phase 1：Prompt 资产化与执行追踪（2–3 周）
**目标**：让 Prompt 成为可读取、可版本控制、可被程序修改的资产。

#### 4.1.1 Prompt 外置化
将 `novel-engine.js` 中所有硬编码 Prompt 迁移为模板文件：

```
prompts/
├── writer.md          # 作者 Agent Prompt 模板
├── editor.md          # 编辑 Agent Prompt 模板
├── planner.md         # 策划评审 Prompt
├── product.md         # 产品评审 Prompt
├── core-rules.md      # 原 core.md 的 12 维度规范
├── multivolume-outline.md
└── volume-outline.md
```

每个模板使用 Mustache / Handlebars 语法预留变量：
```markdown
你正在创作长篇小说《{{topic}}》，风格为"{{style}}"。

详细纲章：
{{outlineDetailed}}

前文内容：
{{previousContext}}

{{> core-rules}}
```

#### 4.1.2 执行追踪（Execution Traces）
在每次 `runStreamChat` 后，将以下信息写入 SQLite / JSONL：
```json
{
  "traceId": "uuid",
  "timestamp": "2026-04-15T10:00:00Z",
  "agentType": "writer",
  "promptTemplate": "writer.md",
  "variables": { "topic": "...", "outlineDetailed": "..." },
  "output": "章节文本...",
  "metrics": { "chars": 2100, "durationMs": 15000 }
}
```

**价值**：为后续的 GEPA / DSPy 优化提供"为什么失败"的上下文。

---

### Phase 2：Fitness Function 与评估数据集（2–3 周）
**目标**：建立可量化的"章节质量分"，并沉淀历史数据为评估集。

#### 4.2.1 综合适应度函数
设计一个公式，将多维度评审结果压缩为 0–1 分：

```javascript
function computeChapterFitness(chapterMeta, repetitionResult, reviewResult, readerFeedback) {
  const weights = {
    wordCount: 0.15,      // 目标 2000 字，越接近得分越高
    repetition: 0.20,     // 重复检查 severity 越低越好
    review: 0.25,         // ReAct 评审 pass + 平均分
    reader: 0.20,         // 读者反馈正面率
    coherence: 0.20,      // 与纲章的匹配度（可由 AI 判定）
  };

  const wordScore = gaussianScore(chapterMeta.chars, target = 2000, sigma = 300);
  const repScore = repetitionResult.severity === 'high' ? 0 : (repetitionResult.severity === 'medium' ? 0.5 : 1);
  const reviewScore = reviewResult.passed ? averageScore(reviewResult.reviews) : 0;
  const readerScore = readerFeedback ? readerFeedback.positiveRate : 0.5;
  const coherenceScore = chapterMeta.coherenceScore || 0.5;

  return weightedSum([wordScore, repScore, reviewScore, readerScore, coherenceScore], Object.values(weights));
}
```

#### 4.2.2 评估数据集构建
- **自动采集**：从 `session_db` / `meta.json` / `reviewRecords` 中自动提取每章的输入-输出-评分三元组。
- **人工标注**：对开篇卷、付费转化卷等关键章节，运营人员可进行 1–5 星评分，作为"黄金标准"。
- **数据集结构**：
  ```json
  {
    "input": { "topic": "...", "outline": "...", "previousContext": "..." },
    "output": "章节文本",
    "fitness": 0.82,
    "labels": { "golden": true, "humanRating": 4.5 }
  }
  ```

---

### Phase 3：Prompt 自动优化引擎（3–4 周）
**目标**：用 DSPy + GEPA 进化 Prompt 模板，实现"哪个 Prompt 版本写出的章节得分更高"。

#### 4.3.1 DSPy 模块封装
将 `writer.md` 封装为 DSPy Signature：

```python
import dspy

class WriteChapter(dspy.Signature):
    """Given a novel topic, style, outline, and previous context, write a compelling 2000-word chapter."""
    topic = dspy.InputField()
    style = dspy.InputField()
    outline_detailed = dspy.InputField()
    previous_context = dspy.InputField()
    chapter_text = dspy.OutputField(desc="约2000字小说章节，含强钩子和画面感")
```

#### 4.3.2 GEPA 进化流程
1. **基线**：当前 `writer.md` 在评估集上运行，计算平均 Fitness。
2. **变异**：GEPA 读取低分章节的执行追踪，分析失败原因（如"悬念铺垫不足"、"场景雷同"）。
3. **生成变体**：GEPA 对 `writer.md` 中的 `core-rules` 部分提出修改（如增加"每章必须出现至少 1 个全新视觉意象"）。
4. **评估**：用变体 Prompt 重新跑低分章节，计算新 Fitness。
5. **选择**：保留 Fitness 提升 > 5% 且通过测试的变体。
6. **PR 提交**：生成 diff 文件 + 前后对比报告，提交到 Git。

#### 4.3.3 本地实现路径（不依赖外部 Python 栈）
由于当前系统是 Node.js 栈，若不想引入 Python/DSPy，可以构建一个**轻量替代方案**：

```javascript
// evolution/prompt-evolver.js
async function evolvePrompt(templatePath, evalDataset, model = 'deepseek-r1') {
  const baseline = await evaluatePrompt(templatePath, evalDataset);

  // 1. 让 LLM 分析低分样本的 Prompt 缺陷
  const diagnosis = await analyzeFailures(templatePath, evalDataset.filter(d => d.fitness < 0.6), model);

  // 2. 让 LLM 生成 3–5 个 Prompt 变体
  const variants = await generateVariants(templatePath, diagnosis, 5, model);

  // 3. 并行评估每个变体
  const results = await Promise.all(variants.map(v => evaluatePromptVariant(v, evalDataset)));

  // 4. 返回最佳变体
  return results.sort((a, b) => b.avgFitness - a.avgFitness)[0];
}
```

**优劣对比**：
- **DSPy + GEPA**：更系统、有学术背书、GEPA 的"反射性分析"能力强。
- **Node.js 轻量版**：无需 Python 依赖、与现有代码库无缝集成、开发周期短（1–2 周即可跑通 MVP）。

**建议**：先用 Node.js 轻量版验证效果，若确实能持续提升 Fitness，再考虑引入 DSPy 作为增强引擎。

---

### Phase 4：Skill 自动生成（3–4 周）
**目标**：从成功的创作任务中抽象出可复用的 Skill 文档。

#### 4.4.1 Skill 生成触发条件
当某类题材/风格连续写出 3 章高 Fitness（> 0.85）章节时，触发 Skill 萃取：

```javascript
async function extractSkill(workId, highFitnessChapters, model) {
  const prompt = `以下是一组高评分章节的创作记录：
${highFitnessChapters.map(c => `题材：${c.topic}\n风格：${c.style}\n大纲：${c.outline}\n正文：${c.text.substring(0, 1500)}...`).join('\n---\n')}

请从中抽象出一套可复用的"创作技能"，输出为 SKILL.md 格式：
1. 适用题材标签
2. 必须遵守的结构模板
3. 节奏控制公式
4. 情绪转折技巧
5. 常见陷阱与规避方法`;

  const result = await runStreamChat([{ role: 'user', content: prompt }], model);
  return result.content;
}
```

#### 4.4.2 Skill 存储与应用
- **存储**：`skills/generated/都市修仙-快节奏.md`
- **应用**：用户在 Web UI 创建作品时，若题材匹配，系统自动推荐该 Skill，并将其内容注入 `writer.md` 的 `{{> skill-injection}}` 位置。

---

### Phase 5：持续监控与 A/B 测试（2–3 周）
**目标**：让系统自动发现"哪套 Prompt + Skill 组合更适合当前题材"。

#### 4.5.1 影子模式（Shadow Mode）
对 10% 的章节生成任务，同时使用**当前 Prompt** 和**候选 Prompt** 跑两个版本：
- 主版本：写入正文、给用户展示。
- 影子版本：仅保存到 `shadow/` 目录，由 ReAct 评审 Agent 打分。

#### 4.5.2 A/B 决策门
每周汇总影子模式的 Fitness 数据：
```javascript
if (candidate.avgFitness > baseline.avgFitness * 1.05 && tTestPValue < 0.05) {
  // 候选版本显著优于基线
  await createEvolutionPR(candidate);
}
```

---

## 5. 预期收益与风险

### 5.1 预期收益
| 收益 | 说明 |
|------|------|
| **Prompt 持续优化** | 3 个月后，writer Prompt 的 Fitness 中位数可能提升 10–20% |
| **题材 Skill 库积累** | 自动生成 10+ 个垂直题材 Skill，降低新题材冷启动成本 |
| **数据驱动决策** | 不再凭直觉改 Prompt，而是看 A/B 数据说话 |
| **运营成本降低** | 人工审稿时间减少，AI 自动拦截低质量章节 |

### 5.2 风险与规避
| 风险 | 规避措施 |
|------|---------|
| **Prompt 变异引入安全/格式问题** | 所有变体必须通过格式校验（必须包含 `{{> core-rules}}`、字数指令不可删除） |
| **评估数据集偏见** | 定期引入人工标注的"黄金标准"校正自动评分 |
| **影子模式成本翻倍** | 仅对 10% 任务开启影子模式，或只在关键卷启用 |
| **陷入局部最优** | 每月引入一次"随机探索"（Random Mutation），跳出舒适区 |

---

## 6. 最低可行路径（MVP，2 周内可跑通）

如果你想以最低成本快速验证"自动进化"的可行性，建议只做以下 4 件事：

1. **Prompt 外置化**：把 `writer.md` 提取到 `prompts/writer.md`。
2. **跑 1 次轻量进化**：手工构造 3 个 `writer.md` 变体（例如：加强钩子要求 / 加强场景限制 / 加强对话口语化），在最近的 5 个作品上跑批量回溯评估。
3. **计算 Fitness**：用已有的 ReAct 评审结果 + 字数 + 重复检查，算出一个综合分。
4. **固化最佳变体**：如果某个变体的平均分高于基线 > 5%，将其更新为默认 Prompt，并记录 diff。

这个 MVP 不需要 DSPy、不需要 Python、不需要影子模式，就能让你**第一次体验到数据驱动 Prompt 进化的效果**。

---

## 7. 总结

| 维度 | 评估 |
|------|------|
| **技术可行性** | ✅ 高。现有模块（评审、记忆、索引、元数据）已为进化奠定坚实基础。 |
| **成本可行性** | ✅ 高。无需 GPU，仅增加 API 调用；影子模式可控在 10% 流量。 |
| **工程复杂度** | ⚠️ 中。最大工作量在于 Prompt 资产化和评估数据集构建。 |
| **商业价值** | ✅ 高。长期可降低人工审稿成本，提升生成内容稳定性。 |

**最终建议**：
- **短期（1 个月）**：完成 Prompt 外置化 + Fitness Function + Node.js 轻量进化器 MVP。
- **中期（3 个月）**：建立影子模式 A/B 测试，积累 3–5 个垂直题材 Skill。
- **长期（6 个月）**：若效果验证显著，引入 DSPy + GEPA 作为增强引擎，实现接近 Hermes 级别的自动进化能力。
