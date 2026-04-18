# 章节级 ReAct 评审与内容重复检索集成方案

## 1. 背景与目标

在现有的多卷大纲 ReAct 评审（产品/策划/技术）和逐卷纲章 ReAct 评审（作者/编辑/策划）之上，**每一章正文**在生成完毕后也需要接受质量检查，以确保：

1. **无内容重复**：新写章节不会长篇复述前文中已详细交代的人物、设定、规则或情节模式。
2. **多维质量把关**：从市场定位、结构策划、编辑可读性、技术架构四个维度对单章进行快速评审。
3. **可追溯记录**：所有评审结果持久化存储，供 Web UI / CLI 回溯分析。

## 2. 整体流程

在 `continueNovel`（或 `startNovel` 的第 1 章）中，单章流水线完成后新增以下两个阶段：

```
┌─────────────────────────────────────────────────────────────┐
│  1. writeChapterMultiAgent / writeChapterPipeline           │
│     → 产出 finalFile / polishFile（最终正文）               │
├─────────────────────────────────────────────────────────────┤
│  2. checkContentRepetition                                  │
│     → 比对 memory_index.json，检测冗余复述                  │
│     → 输出 chapter_N_repetition.json                        │
├─────────────────────────────────────────────────────────────┤
│  3. runReactReview (product / planner / editor / tech)      │
│     → 单章四维 ReAct 评审                                   │
│     → 输出 review_chapter_N/round_1.json                    │
├─────────────────────────────────────────────────────────────┤
│  4. 写入 meta.chapters & saveMeta                           │
└─────────────────────────────────────────────────────────────┘
```

## 3. 阶段一：内容重复检索 (`checkContentRepetition`)

### 3.1 触发时机
- 在 `continueNovel` 中，当 `writeChapterMultiAgent` 或 `writeChapterPipeline` 返回后，立即读取最终正文文件（`chapter_N_final.txt` 或 `chapter_N_polish.txt`）。
- 调用 `memory-index.js` 中的 `checkContentRepetition(workId, chapterNumber, chapterText, style, model, callbacks)`。

### 3.2 核心逻辑
1. **加载记忆索引**：读取 `memory_index.json` 中的 `entities`、`plot_threads`、`rules`。
2. **筛选已知信息**：只保留满足以下条件的条目：
   - 已在前文出现 **≥2 次**；
   - 最近一次出现 **不在当前章**（即 `lastMention < chapterNumber`）。
3. **AI 判定**：将上述已知信息列表与新写章节的前 4000 字一并送入 Summarizer 模型（默认 `deepseek-v3`），由 AI 判断是否存在：
   - 对已出场人物/设定/规则的长篇再解释；
   - 重复前卷或前文已闭环的情节模式；
   - 同一悬念在卷内反复拖沓、没有实质推进；
   - 新场景描写与旧场景高度雷同。

### 3.3 输出格式
结果以 JSON 文件落盘：
```json
{
  "repetitive": true,
  "severity": "medium",
  "issues": [
    "对'青云宗门规'进行了长达300字的再次解释，而此规则在第3、7章已有详细交代"
  ],
  "suggestions": [
    "将门规解释压缩为一句话带过，把笔墨集中在主角的冲突选择上"
  ],
  "checkedAt": "2026-04-15T10:50:00.000Z"
}
```
文件路径：`works/{workId}/chapter_N_repetition.json`

### 3.4 与现有系统的关系
- **不阻断流程**：即使判定 `repetitive: true`，也不会强制回退或重写，仅生成记录。后续可通过 UI 高亮提示作者/运营人工介入。
- **与 `buildAntiRepetitionReminder` 互补**：
  - `buildAntiRepetitionReminder` 作用于**写之前**（Pre-write），基于卷纲章关键词给出预防性提醒。
  - `checkContentRepetition` 作用于**写之后**（Post-write），基于实际生成的正文进行回溯性审查。

## 4. 阶段二：章节级 ReAct 评审 (`runReactReview`)

### 4.1 触发时机
- 紧跟在重复检索之后。
- 默认启用，可通过 `options.enableChapterReview = false` 关闭（适用于批量快速跑章）。

### 4.2 评审员配置
| Agent | 维度 | 作用 |
|-------|------|------|
| **product** | 市场定位、用户画像、爽点密度、付费点、商业化潜力 | 判断本章是否具备让读者"上头"并愿意追更的元素 |
| **planner** | 世界观一致性、伏笔深远性、卷内衔接、设定无冲突、角色弧光、主题表达 | 判断本章与全书/全卷架构的契合度 |
| **editor** | 结构清晰性、节奏合理性、逻辑闭环、无工具人、钩子与悬念、可读性 | 判断本章作为独立阅读单元的编辑质量 |
| **tech** | 系统可扩展性、Prompt 可落地性、IP 改编友好度、数据模型一致性、多平台适配性、长期维护性 | 判断本章的画面感、符号化潜力、设定可索引性 |

### 4.3 评审规则
- **轮次**：单章评审固定 **1 轮**（4 个 Agent 并行评审 → 1 次综合判断）。
  - 原因：章节数量多，若每章都跑 3 轮修改，时间和成本不可接受。
  - 若未来需要，可放宽为 `maxRounds: 2`。
- **通过标准**：由 `runSynthesis` 中的终审规则决定（≥4/5 通过且无硬否决）。
- **不自动修改**：即使不通过，也仅记录结果，不会触发 `runRevision` 回写正文（与大纲评审不同）。

### 4.4 输出与存储
- 评审历史写入：`works/{workId}/review_chapter_N/round_1.json`
- `meta.reviews.chapter_N` 记录 `{ passed, finalRound }`
- Web UI 的 `renderReviews` 会自动展示这些记录。

## 5. 与 `continueNovel` 的集成点

关键代码片段（位于 `novel-engine.js` 的 `continueNovel` 中）：

```javascript
let chapterMeta;
if (effectiveStrategy === 'multi-agent') {
  chapterMeta = await writeChapterMultiAgent(workId, meta, nextNumber, models, callbacks);
} else {
  chapterMeta = await writeChapterPipeline(workId, meta, nextNumber, models, callbacks);
}

// === 章节级后处理 ===
const finalFile = effectiveStrategy === 'multi-agent' ? chapterMeta.finalFile : chapterMeta.polishFile;
const chapterText = readFile(workId, finalFile);

if (chapterText) {
  // 1) 重复检索
  const { checkContentRepetition } = require('./memory-index');
  await checkContentRepetition(workId, nextNumber, chapterText, expandedStyle, models.summarizer, callbacks);

  // 2) ReAct 评审
  if (options.enableChapterReview !== false) {
    const chapterReview = await runReactReview(
      ['product', 'planner', 'editor', 'tech'],
      chapterText,
      `chapter_${nextNumber}`,
      expandedStyle,
      { maxRounds: 1, models: { ... }, callbacks }
    );
    meta.reviews[`chapter_${nextNumber}`] = { passed: chapterReview.passed, finalRound: chapterReview.finalRound };
    chapterReview.history.forEach((h, idx) => saveReviewHistory(workId, `chapter_${nextNumber}`, idx + 1, h));
  }
}

meta.chapters.push({ number: nextNumber, ...chapterMeta });
```

## 6. Web UI / CLI 展示

### Web UI (`public/novel.html`)
- 作品详情页已存在的 **ReAct 评审记录面板** 会自动加载 `review_chapter_N` 记录。
- 可扩展在章节正文页下方展示：
  - 重复检查结果（`chapter_N_repetition.json`）
  - 本章四维评审得分与通过状态

### CLI (`examples/novel-cli.js`)
- 可在 `runContinue` 中新增提示：
  > "是否开启章节级 ReAct 评审？（默认开启，输入 n 关闭）"
- 续写完成后打印：
  - "第 N 章重复检查：未发现问题"
  - "第 N 章 ReAct 评审：通过 / 不通过"

## 7. 成本与性能建议

| 项目 | 估算 | 说明 |
|------|------|------|
| 重复检索 | ~1k tokens × 1 call | 使用轻量模型（`deepseek-v3`）即可 |
| 单章 ReAct 评审 | ~4k–6k tokens × 5 calls | 4 个评审 Agent + 1 次综合 |
| 每章额外耗时 | +30s ~ +90s | 取决于模型响应速度 |
| 优化开关 | `enableChapterReview: false` | 批量跑章或测试时可关闭 |

### 建议
- **日常创作**：开启重复检索（低成本）+ 每 3–5 章开启一次 ReAct 评审（抽样质检）。
- **精品卷打磨**：对关键卷（开篇卷、付费转化卷、大高潮卷）开启每章全量 ReAct 评审。
- **自动化策略**：未来可在 `meta` 中增加 `chapterReviewInterval: 3`，让系统自动每 3 章抽检一次。

## 8. 文件清单变更

| 文件 | 变更内容 |
|------|----------|
| `src/services/memory-index.js` | 新增 `checkContentRepetition` 函数及导出 |
| `src/services/novel-engine.js` | `continueNovel` 中插入重复检查与 ReAct 评审阶段 |
| `docs/chapter-review-integration.md` | 本文档 |
