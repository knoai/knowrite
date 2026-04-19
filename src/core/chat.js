const fs = require('fs');
const path = require('path');
const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const ProviderFactory = require('../providers/factory');

// 为 axios 配置重试策略
axiosRetry(axios, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) => {
    // 对网络错误、超时、5xx、429 进行重试
    return axiosRetry.isNetworkOrIdempotentRequestError(error)
      || error.response?.status === 429
      || error.response?.status >= 500;
  },
  onRetry: (retryCount, error, requestConfig) => {
    console.warn(`[chat] 请求重试 ${retryCount}/3: ${error.message} (${requestConfig.url})`);
  },
});
const { getWorkDir } = require('./paths');
const fileStore = require('../services/file-store');
const { getModelConfig } = require('../services/settings-store');
const netCfg = require('../../config/network.json');
const engineCfg = require('../../config/engine.json');

function normalizeModelConfig(modelConfig) {
  if (typeof modelConfig === 'string') {
    return { provider: '', model: modelConfig, temperature: 0.7 };
  }
  if (!modelConfig || typeof modelConfig !== 'object') {
    return { provider: '', model: '', temperature: 0.7 };
  }
  return {
    provider: modelConfig.provider || '',
    model: modelConfig.model || '',
    temperature: typeof modelConfig.temperature === 'number' ? modelConfig.temperature : 0.7,
  };
}

// ============ Local provider for API-based providers (OpenAI-compatible) ============

async function* localStreamChat(messages, cfg) {
  const modelCfg = await getModelConfig();
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
    const gen = await provider.chat(messages, { model: cfg.model, temperature: cfg.temperature, stream: true });
    for await (const chunk of gen) {
      yield chunk;
    }
  } finally {
    await provider.close();
  }
}

// ============ Unified entry ============

async function* streamChat(messages, modelConfig) {
  const cfg = normalizeModelConfig(modelConfig);
  yield* localStreamChat(messages, cfg);
}

async function runStreamChat(messages, modelConfig, callbacks, traceContext = {}) {
  const cfg = normalizeModelConfig(modelConfig);
  let buffer = '';
  let chunkCount = 0;
  const start = Date.now();

  try {
    for await (const chunk of streamChat(messages, cfg)) {
      buffer += chunk;
      chunkCount++;
      if (callbacks && callbacks.onChunk) callbacks.onChunk(chunk);
    }
  } catch (err) {
    console.error(`[chat] 模型调用失败: provider=${cfg.provider} model=${cfg.model} error=${err.message}`);
    throw err;
  }

  const result = {
    content: buffer,
    chars: buffer.length,
    chunks: chunkCount,
    durationMs: Date.now() - start,
  };

  console.log(`[chat] 模型调用完成: provider=${cfg.provider} model=${cfg.model} chars=${result.chars} chunks=${result.chunks} durationMs=${result.durationMs}`);

  // Execution Tracing
  if (traceContext.workId) {
    try {
      const traceRecord = {
        timestamp: new Date().toISOString(),
        agentType: traceContext.agentType || 'unknown',
        promptTemplate: traceContext.promptTemplate || 'unknown',
        model: cfg.model,
        provider: cfg.provider,
        temperature: cfg.temperature,
        inputPreview: messages.map(m => m.content).join('\n').substring(0, engineCfg.truncation.traceInputOutput),
        outputPreview: buffer.substring(0, engineCfg.truncation.traceInputOutput),
        chars: result.chars,
        durationMs: result.durationMs,
      };
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
        console.error('[chat] trace write error:', err.message);
      }
    } catch (err) { console.error("[chat] trace error:", err.message); }
  }

  return result;
}

module.exports = {
  streamChat,
  runStreamChat,
};
