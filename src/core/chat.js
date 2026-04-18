const fs = require('fs');
const path = require('path');
const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const ProviderFactory = require('../providers/factory');

// 为 axios 配置重试策略（针对 proxy 流式请求）
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

const PROXY_BASE = process.env.PROXY_URL || netCfg.proxy.baseURL;
const WEB_PROVIDERS = netCfg.proxy.webProviders;

function normalizeModelConfig(modelConfig) {
  if (typeof modelConfig === 'string') {
    return { provider: 'yuanbao', model: modelConfig, temperature: 0.7 };
  }
  if (!modelConfig || typeof modelConfig !== 'object') {
    return { provider: 'yuanbao', model: 'deepseek-v3', temperature: 0.7 };
  }
  return {
    provider: modelConfig.provider || 'yuanbao',
    model: modelConfig.model || 'deepseek-v3',
    temperature: typeof modelConfig.temperature === 'number' ? modelConfig.temperature : 0.7,
  };
}

function toProxyModel(cfg) {
  return `${cfg.provider}/${cfg.model}`;
}

// ============ Proxy HTTP client (OpenAI-compatible) ============

async function* proxyStreamChat(messages, cfg) {
  const res = await axios.post(
    `${PROXY_BASE}/v1/chat/completions`,
    {
      model: toProxyModel(cfg),
      messages,
      temperature: cfg.temperature,
      stream: true,
    },
    { responseType: 'stream', timeout: netCfg.timeouts.chat }
  );

  const stream = res.data;
  let buffer = '';
  for await (const chunk of stream) {
    buffer += chunk.toString('utf-8');
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      let text = line;
      if (text.startsWith('data:')) text = text.slice(5).trim();
      if (text === '[DONE]') continue;
      if (!text) continue;
      try {
        const ev = JSON.parse(text);
        const content = ev.choices?.[0]?.delta?.content;
        if (content) yield content;
        if (ev.error) throw new Error(`Proxy error: ${ev.error.message || ev.error}`);
      } catch (e) {
        if (e.message && (e.message.includes('Proxy error') || !e.message.includes('JSON'))) throw e;
      }
    }
  }
  if (buffer && buffer.trim()) {
    let text = buffer.trim();
    if (text.startsWith('data:')) text = text.slice(5).trim();
    if (text && text !== '[DONE]') {
      try {
        const ev = JSON.parse(text);
        const content = ev.choices?.[0]?.delta?.content;
        if (content) yield content;
        if (ev.error) throw new Error(`Proxy error: ${ev.error.message || ev.error}`);
      } catch (e) {
        // ignore malformed
      }
    }
  }
}

async function proxySyncChat(messages, cfg) {
  const res = await axios.post(
    `${PROXY_BASE}/v1/chat/completions`,
    {
      model: toProxyModel(cfg),
      messages,
      temperature: cfg.temperature,
      stream: false,
    },
    { timeout: netCfg.timeouts.chat }
  );
  return res.data.choices?.[0]?.message?.content || '';
}

// ============ Local provider for API-based providers ============

async function* localStreamChat(messages, cfg) {
  const modelCfg = await getModelConfig();
  const providerCfg = (modelCfg && modelCfg.providers && modelCfg.providers[cfg.provider]) || {};

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

  if (WEB_PROVIDERS.includes(cfg.provider)) {
    yield* proxyStreamChat(messages, cfg);
  } else {
    yield* localStreamChat(messages, cfg);
  }
}

async function runStreamChat(messages, modelConfig, callbacks, traceContext = {}) {
  const cfg = normalizeModelConfig(modelConfig);
  let buffer = '';
  let chunkCount = 0;
  const start = Date.now();

  for await (const chunk of streamChat(messages, cfg)) {
    buffer += chunk;
    chunkCount++;
    if (callbacks && callbacks.onChunk) callbacks.onChunk(chunk);
  }

  const result = {
    content: buffer,
    chars: buffer.length,
    chunks: chunkCount,
    durationMs: Date.now() - start,
  };

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
