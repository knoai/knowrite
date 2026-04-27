import type { ChatMessage } from '../types';

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const ProviderFactory = require('../providers/factory');

// 为 axios 配置重试策略
axiosRetry(axios, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error: any) => {
    // 对网络错误、超时、5xx、429 进行重试
    return axiosRetry.isNetworkOrIdempotentRequestError(error)
      || error.response?.status === 429
      || error.response?.status >= 500;
  },
  onRetry: (retryCount: number, error: any, requestConfig: any) => {
    console.warn(`[chat] 请求重试 ${retryCount}/3: ${error.message} (${requestConfig.url})`);
  },
});

const { getWorkDir } = require('./paths');
const fileStore = require('../services/file-store');
const { getModelConfig, getConfig } = require('../services/settings-store');

interface NormalizedModelConfig {
  provider: string;
  model: string;
  temperature: number;
}

function normalizeModelConfig(modelConfig: unknown): NormalizedModelConfig {
  if (typeof modelConfig === 'string') {
    return { provider: '', model: modelConfig, temperature: 0.7 };
  }
  if (!modelConfig || typeof modelConfig !== 'object') {
    return { provider: '', model: '', temperature: 0.7 };
  }
  const cfg = modelConfig as Record<string, unknown>;
  return {
    provider: (cfg.provider as string) || '',
    model: (cfg.model as string) || '',
    temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.7,
  };
}

// ============ Local provider for API-based providers (OpenAI-compatible) ============

async function* localStreamChat(messages: ChatMessage[], cfg: NormalizedModelConfig): AsyncGenerator<string, void, unknown> {
  const modelCfg: any = await getModelConfig();
  const providerCfg = (modelCfg && modelCfg.providers && modelCfg.providers[cfg.provider]) || {};

  console.log(`[chat] 调用模型: provider=${cfg.provider} model=${cfg.model} baseURL=${providerCfg.baseURL || '(未配置)'} temperature=${cfg.temperature}`);

  if (!cfg.provider) {
    throw new Error('未指定模型 provider，请先在「设置-模型配置」中配置并选择模型提供商');
  }
  if (!cfg.model) {
    throw new Error('未指定模型名称，请先在「设置-模型配置」中配置模型');
  }
  if (!providerCfg.baseURL) {
    throw new Error(`Provider "${cfg.provider}" 未配置 baseURL，请先在「设置-模型配置」中填写 Base URL`);
  }

  const provider = ProviderFactory.create(cfg.provider, {
    apiKey: providerCfg.apiKey,
    baseURL: providerCfg.baseURL,
  });

  const ok = await provider.authenticate();
  if (!ok) {
    throw new Error(`${cfg.provider} 授权失败`);
  }

  try {
    const gen: AsyncGenerator<string, void, unknown> = await provider.chat(messages, { model: cfg.model, temperature: cfg.temperature, stream: true });
    for await (const chunk of gen) {
      yield chunk;
    }
  } finally {
    await provider.close();
  }
}

// ============ Unified entry ============

async function* streamChat(messages: ChatMessage[], modelConfig: unknown): AsyncGenerator<string, void, unknown> {
  const cfg = normalizeModelConfig(modelConfig);
  yield* localStreamChat(messages, cfg);
}

interface ChatCallbacks {
  onChunk?: (chunk: string) => void;
}

interface TraceContext {
  workId?: string;
  agentType?: string;
  promptTemplate?: string;
}

interface ChatResult {
  content: string;
  chars: number;
  chunks: number;
  durationMs: number;
}

async function runStreamChat(messages: ChatMessage[], modelConfig: unknown, callbacks?: ChatCallbacks, traceContext: TraceContext = {}): Promise<ChatResult> {
  const cfg = normalizeModelConfig(modelConfig);

  // 前置校验：确保模型配置完整
  if (!cfg.provider) {
    throw new Error('【模型配置错误】未指定模型 Provider。请前往「设置 → 模型配置」选择 Provider 并填写 Base URL 和 API Key。');
  }
  if (!cfg.model) {
    throw new Error('【模型配置错误】未指定模型名称。请前往「设置 → 模型配置」为对应角色选择模型。');
  }

  const chunks: string[] = [];
  let chunkCount = 0;
  const start = Date.now();

  try {
    for await (const chunk of streamChat(messages, cfg)) {
      chunks.push(chunk);
      chunkCount++;
      if (callbacks && callbacks.onChunk) callbacks.onChunk(chunk);
    }
  } catch (err) {
    const e = err as any;
    const isNetwork = e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND' || e.code === 'ETIMEDOUT' || e.code === 'ECONNRESET';
    const prefix = isNetwork ? '【网络错误】' : e.message?.includes('配置') || e.message?.includes('Provider') || e.message?.includes('模型') ? '【模型配置错误】' : '【模型调用错误】';
    const detail = isNetwork ? `无法连接到 ${cfg.provider} (${cfg.model})。请检查 Base URL 是否正确、服务是否运行。原错误: ${e.message}` : e.message;
    console.error(`[chat] ${prefix} provider=${cfg.provider} model=${cfg.model} error=${e.message}`);
    throw new Error(`${prefix} ${detail}`);
  }

  const text = chunks.join('');
  const result: ChatResult = {
    content: text,
    chars: text.length,
    chunks: chunkCount,
    durationMs: Date.now() - start,
  };

  console.log(`[chat] 模型调用完成: provider=${cfg.provider} model=${cfg.model} chars=${result.chars} chunks=${result.chunks} durationMs=${result.durationMs}`);

  // Execution Tracing
  if (traceContext.workId) {
    try {
      const engineCfg: any = await getConfig('engine');
      const tracing = engineCfg.tracing || {};
      const previewLen = tracing.previewLength || engineCfg.truncation.traceInputOutput || 500;
      const traceRecord = {
        timestamp: new Date().toISOString(),
        agentType: traceContext.agentType || 'unknown',
        promptTemplate: traceContext.promptTemplate || 'unknown',
        model: cfg.model,
        provider: cfg.provider,
        temperature: cfg.temperature,
        inputPreview: messages.map(m => m.content).join('\n').substring(0, previewLen),
        outputPreview: result.content.substring(0, previewLen),
        chars: result.chars,
        durationMs: result.durationMs,
      };
      if (tracing.retainFullPrompt || tracing.retainFullOutput) {
        const fullRecord = {
          ...traceRecord,
          ...(tracing.retainFullPrompt ? { inputFull: messages.map(m => m.content).join('\n') } : {}),
          ...(tracing.retainFullOutput ? { outputFull: result.content } : {}),
        };
        const fullTraceFilename = `traces/${traceContext.agentType || 'unknown'}_${Date.now()}_full.json`;
        await fileStore.writeFile(traceContext.workId, fullTraceFilename, JSON.stringify(fullRecord, null, 2));
      }
      const traceFilename = `traces/${traceContext.agentType || 'unknown'}.jsonl`;
      const existing = await fileStore.readFile(traceContext.workId, traceFilename);
      const updated = (existing || '') + JSON.stringify(traceRecord) + '\n';
      await fileStore.writeFile(traceContext.workId, traceFilename, updated);
      const traceDir = path.join(getWorkDir(traceContext.workId), 'traces');
      try {
        await fs.promises.mkdir(traceDir, { recursive: true });
        const traceFile = path.join(traceDir, `${traceContext.agentType || 'unknown'}.jsonl`);
        await fs.promises.appendFile(traceFile, JSON.stringify(traceRecord) + '\n', 'utf-8');
      } catch (err) {
        console.error('[chat] trace write error:', (err as any).message);
      }
    } catch (err) { console.error("[chat] trace error:", (err as any).message); }
  }

  return result;
}

module.exports = {
  streamChat,
  runStreamChat,
};
