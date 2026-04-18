/**
 * 轻量 Prompt 进化引擎 (Node.js MVP)
 *
 * 流程：
 * 1. 加载基线 Prompt 模板
 * 2. 从 traces / fitness 数据中提取低分样本
 * 3. 让 LLM 分析失败原因并生成 N 个 Prompt 变体
 * 4. 在评估数据集上批量跑每个变体
 * 5. 选择 Fitness 最高的变体
 */

const fs = require('fs');
const path = require('path');
const { loadPromptRaw } = require('./prompt-loader');
const { runStreamChat } = require('../core/chat');
const { resolveRoleModelConfig } = require('./settings-store');

const PROMPTS_DIR = path.join(__dirname, '../../prompts');
const EVOLUTION_DIR = path.join(__dirname, '../../evolution');

async function ensureEvolutionDir() {
  try {
    await fs.promises.access(EVOLUTION_DIR);
  } catch {
    await fs.promises.mkdir(EVOLUTION_DIR, { recursive: true });
  }
}

async function readTraces(workDir, agentType, limit = 50) {
  const traceFile = path.join(workDir, 'traces', `${agentType}.jsonl`);
  try {
    await fs.promises.access(traceFile);
  } catch { return []; }
  const content = await fs.promises.readFile(traceFile, 'utf-8');
  const lines = content.split('\n').filter(Boolean);
  return lines.slice(-limit).map(l => JSON.parse(l));
}

async function gatherEvalDataset(workId, agentType) {
  const workDir = path.join(__dirname, '../../works', workId);
  try {
    await fs.promises.access(workDir);
  } catch { return []; }

  const dataset = [];
  const files = await fs.promises.readdir(workDir);
  const fitnessFiles = files.filter(f => f.endsWith('_fitness.json'));

  for (const ff of fitnessFiles) {
    const match = ff.match(/chapter_(\d+)_fitness\.json/);
    if (!match) continue;
    const chapterNumber = parseInt(match[1], 10);
    const fitnessPath = path.join(workDir, ff);
    let fitness;
    try {
      const content = await fs.promises.readFile(fitnessPath, 'utf-8');
      fitness = JSON.parse(content);
    } catch (err) {
      console.error(`[prompt-evolver] fitness 解析失败 ${ff}:`, err.message);
      continue;
    }

    const traces = await readTraces(workDir, agentType, 1);
    if (traces.length === 0) continue;

    dataset.push({
      workId,
      chapterNumber,
      fitness: fitness.score,
      breakdown: fitness.breakdown,
      trace: traces[0],
    });
  }

  return dataset.sort((a, b) => a.fitness - b.fitness);
}

async function analyzeFailures(promptTemplateName, lowFitnessSamples, model, callbacks) {
  const promptText = `你是一位 Prompt 工程专家。请分析以下低质量章节的执行记录，找出当前 "${promptTemplateName}" Prompt 的核心缺陷，并提出 3-5 条针对性的改进方向。\n\n低分样本（按 Fitness 从低到高排列）：\n${lowFitnessSamples.map((s, i) => `\n--- 样本 ${i + 1} ---\nFitness: ${s.fitness}\n字数得分: ${s.breakdown?.wordScore}\n重复得分: ${s.breakdown?.repScore}\n评审得分: ${s.breakdown?.reviewScore}\n读者得分: ${s.breakdown?.readerScore}\n输入预览: ${s.trace?.inputPreview?.substring(0, 300)}\n输出预览: ${s.trace?.outputPreview?.substring(0, 300)}\n`).join('')}\n\n请输出 JSON（不要加 markdown 代码块）：\n{\n  "diagnosis": "核心缺陷总结（100字以内）",\n  "directions": [\n    "改进方向1：具体说明要增加/删除/强化的规则",\n    "改进方向2..."\n  ]\n}`;

  if (callbacks?.onStepStart) {
    callbacks.onStepStart({ key: 'evolve_diagnosis', name: 'Prompt 缺陷诊断', model });
  }

  const result = await runStreamChat([{ role: 'user', content: promptText }], await resolveRoleModelConfig('promptEvolve', model), {
    onChunk: (chunk) => { if (callbacks?.onChunk) callbacks.onChunk('evolve_diagnosis', chunk); }
  });

  if (callbacks?.onStepEnd) {
    callbacks.onStepEnd('evolve_diagnosis', { chars: result.chars, durationMs: result.durationMs });
  }

  let json = null;
  try {
    const cleaned = result.content.replace(/```json\s*/i, '').replace(/```\s*$/m, '').trim();
    json = JSON.parse(cleaned);
  } catch (err) {
    console.error('[prompt-evolver] 诊断结果解析失败:', err.message);
    try {
      const m = result.content.match(/\{[\s\S]*\}/);
      if (m) json = JSON.parse(m[0]);
    } catch (err2) { console.error("[prompt-evolver] 二次解析失败:", err2.message); }
  }

  if (!json) {
    json = {
      diagnosis: '未能自动诊断，可能样本不足',
      directions: ['强化钩子要求', '减少抽象描写', '增强对话口语化']
    };
  }
  return json;
}

async function generateVariants(promptTemplateName, diagnosis, count, model, callbacks) {
  const baseTemplate = await loadPromptRaw(promptTemplateName);

  const promptText = `你是一位 Prompt 工程专家。请基于以下诊断意见，对给定的 Prompt 模板生成 ${count} 个改进变体。\n\n诊断意见：\n${diagnosis.diagnosis}\n改进方向：\n${diagnosis.directions.map((d, i) => `${i + 1}. ${d}`).join('\n')}\n\n原始 Prompt 模板：\n---\n${baseTemplate}\n---\n\n要求：\n1. 每个变体必须保持原有的 {{变量}} 和 {{include:xxx}} 语法不变；\n2. 只对规则/指令/示例部分进行微调，不要重写整个 Prompt；\n3. 每个变体请在开头用 <!-- variant:N --> 标记；\n4. 变体之间必须有明显差异（不要生成 5 个几乎一样的版本）。\n\n请直接输出 ${count} 个完整的 Prompt 模板变体。`;

  if (callbacks?.onStepStart) {
    callbacks.onStepStart({ key: 'evolve_variants', name: `生成 ${count} 个 Prompt 变体`, model });
  }

  const result = await runStreamChat([{ role: 'user', content: promptText }], await resolveRoleModelConfig('promptEvolve', model), {
    onChunk: (chunk) => { if (callbacks?.onChunk) callbacks.onChunk('evolve_variants', chunk); }
  });

  if (callbacks?.onStepEnd) {
    callbacks.onStepEnd('evolve_variants', { chars: result.chars, durationMs: result.durationMs });
  }

  const variants = [];
  const regex = /<!--\s*variant:\s*(\d+)\s*-->([\s\S]*?)(?=<!--\s*variant:|$)/g;
  let m;
  while ((m = regex.exec(result.content)) !== null) {
    variants.push(m[2].trim());
  }

  if (variants.length === 0) {
    const splits = result.content.split(/\n-{3,}\n/);
    for (const s of splits) {
      const trimmed = s.trim();
      if (trimmed.length > baseTemplate.length * 0.5) {
        variants.push(trimmed);
      }
    }
  }

  if (variants.length === 0) {
    variants.push(baseTemplate);
  }

  return variants.slice(0, count);
}

async function evaluateVariant(variantTemplate, evalDataset, model, callbacks) {
  if (evalDataset.length === 0) {
    return { avgFitness: 0, details: [] };
  }

  const samples = evalDataset.slice(0, 5);
  const scores = [];

  for (const sample of samples) {
    const promptText = `你是一位 Prompt 评估专家。给定以下改进后的 Prompt 模板和一个历史章节的输入上下文，请预测：如果让 AI 按这个 Prompt 生成章节，输出质量会比原版本更好、持平还是更差？\n\n改进后 Prompt 模板（前800字）：\n${variantTemplate.substring(0, 800)}\n\n历史输入预览：\n${sample.trace?.inputPreview?.substring(0, 500)}\n\n原版本 Fitness: ${sample.fitness}\n原版本主要问题：${JSON.stringify(sample.breakdown)}\n\n请输出 JSON：\n{"predicted_score": 0.0-1.0, "reason": "简要说明"}`;

    const result = await runStreamChat([{ role: 'user', content: promptText }], await resolveRoleModelConfig('fitnessEvaluate', model), {
      onChunk: (chunk) => { if (callbacks?.onChunk) callbacks.onChunk('evolve_eval', chunk); }
    });

    let predicted = 0.5;
    try {
      const cleaned = result.content.replace(/```json\s*/i, '').replace(/```\s*$/m, '').trim();
      const json = JSON.parse(cleaned);
      predicted = typeof json.predicted_score === 'number' ? json.predicted_score : 0.5;
    } catch (err) { console.error("[prompt-evolver] error:", err.message); }

    scores.push({ sample: sample.chapterNumber, predicted });
  }

  const avgFitness = scores.reduce((a, b) => a + b.predicted, 0) / scores.length;
  return { avgFitness: parseFloat(avgFitness.toFixed(4)), details: scores };
}

async function evolvePrompt(templateName, workIds, options = {}) {
  const {
    model = 'deepseek-r1',
    variantCount = 3,
    fitnessThreshold = 0.6,
    callbacks = {}
  } = options;

  await ensureEvolutionDir();

  let evalDataset = [];
  for (const workId of workIds) {
    const ds = await gatherEvalDataset(workId, templateName);
    evalDataset = evalDataset.concat(ds);
  }

  const lowFitnessSamples = evalDataset.filter(d => d.fitness < fitnessThreshold);
  const baselineFitness = evalDataset.length > 0
    ? evalDataset.reduce((a, b) => a + b.fitness, 0) / evalDataset.length
    : 0;

  if (lowFitnessSamples.length < 2) {
    return {
      success: false,
      reason: '低分样本不足，无法诊断改进方向',
      baselineFitness: parseFloat(baselineFitness.toFixed(4)),
    };
  }

  const diagnosis = await analyzeFailures(templateName, lowFitnessSamples, model, callbacks);
  const variants = await generateVariants(templateName, diagnosis, variantCount, model, callbacks);

  const results = [];
  for (let i = 0; i < variants.length; i++) {
    const evalResult = await evaluateVariant(variants[i], lowFitnessSamples, model, callbacks);
    results.push({
      index: i,
      avgFitness: evalResult.avgFitness,
      details: evalResult.details,
      template: variants[i],
    });
  }

  const baselineTemplate = await loadPromptRaw(templateName);
  const baselineEval = await evaluateVariant(baselineTemplate, lowFitnessSamples, model, callbacks);
  results.push({
    index: -1,
    avgFitness: baselineEval.avgFitness,
    details: baselineEval.details,
    template: baselineTemplate,
    isBaseline: true,
  });

  results.sort((a, b) => b.avgFitness - a.avgFitness);
  const best = results[0];
  const improvement = best.isBaseline ? 0 : best.avgFitness - baselineEval.avgFitness;

  const report = {
    timestamp: new Date().toISOString(),
    templateName,
    baselineFitness: parseFloat(baselineFitness.toFixed(4)),
    baselinePredicted: parseFloat(baselineEval.avgFitness.toFixed(4)),
    bestPredicted: parseFloat(best.avgFitness.toFixed(4)),
    improvement: parseFloat(improvement.toFixed(4)),
    diagnosis,
    allResults: results.map(r => ({
      index: r.index,
      avgFitness: r.avgFitness,
      isBaseline: !!r.isBaseline,
    })),
  };

  const reportPath = path.join(EVOLUTION_DIR, `${templateName}_evolution_${Date.now()}.json`);
  await fs.promises.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');

  if (!best.isBaseline && improvement > 0.05) {
    const candidatePath = path.join(EVOLUTION_DIR, `${templateName}_candidate_${Date.now()}.md`);
    await fs.promises.writeFile(candidatePath, best.template, 'utf-8');
  }

  return {
    success: !best.isBaseline && improvement > 0.05,
    baselineFitness,
    bestPredicted: best.avgFitness,
    improvement,
    reportPath,
    candidateTemplate: best.isBaseline ? null : best.template,
    diagnosis,
  };
}

async function applyCandidate(templateName, candidatePath) {
  try {
    await fs.promises.access(candidatePath);
  } catch {
    throw new Error('Candidate file not found: ' + candidatePath);
  }
  const content = await fs.promises.readFile(candidatePath, 'utf-8');
  const originalPath = path.join(PROMPTS_DIR, `${templateName}.md`);
  const backupPath = path.join(EVOLUTION_DIR, `${templateName}_backup_${Date.now()}.md`);
  await fs.promises.copyFile(originalPath, backupPath);
  await fs.promises.writeFile(originalPath, content, 'utf-8');
  return { originalPath, backupPath };
}

module.exports = {
  evolvePrompt,
  applyCandidate,
};
