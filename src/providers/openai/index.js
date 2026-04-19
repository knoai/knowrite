const axios = require('axios');
const BaseProvider = require('../base-provider');
const { getConfig } = require('../../services/settings-store');

class OpenAIProvider extends BaseProvider {
  constructor(options = {}, name = 'openai') {
    super(name, options);
    this.apiKey = options.apiKey || '';
    this.baseURL = (options.baseURL || '').replace(/\/$/, '');
  }

  async authenticate() {
    // 本地模型（如 Ollama、LM Studio）不需要 apiKey，仅校验 baseURL
    if (!this.baseURL) {
      throw new Error(`Provider "${this.name}" 缺少 baseURL，请在「模型配置」中设置 Base URL`);
    }
    return true;
  }

  async chat(messages, options = {}) {
    const model = options.model;
    if (!model) {
      throw new Error(`Provider "${this.name}" 调用时缺少 model 参数`);
    }
    const stream = options.stream !== false;
    const temperature = typeof options.temperature === 'number' ? options.temperature : 0.7;
    const maxTokens = options.maxTokens || 4096;

    const url = `${this.baseURL}/chat/completions`;
    const body = {
      model,
      messages: Array.isArray(messages) ? messages.map(m => ({ role: m.role || 'user', content: m.content || '' })) : [{ role: 'user', content: String(messages) }],
      temperature,
      max_tokens: maxTokens,
      stream,
    };

    if (stream) {
      return this._chatStream(url, body);
    }
    return this._chatSync(url, body);
  }

  async _request(url, body, stream = false) {
    const netCfg = await getConfig('network');
    const config = {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      timeout: netCfg.timeouts.openaiProvider,
      responseType: stream ? 'stream' : 'json',
    };
    return axios.post(url, body, config);
  }

  async _chatSync(url, body) {
    const resp = await this._request(url, body, false);
    return resp.data?.choices?.[0]?.message?.content || '';
  }

  async *_chatStream(url, body) {
    console.log(`[openai-provider] stream request: ${url} model=${body.model}`);
    const resp = await this._request(url, body, true);
    const stream = resp.data;
    let buffer = '';
    let yieldedCount = 0;

    for await (const chunk of stream) {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            const content = data.choices?.[0]?.delta?.content || '';
            if (content) {
              yield content;
              yieldedCount++;
            }
          } catch {
            // ignore malformed JSON
          }
        }
      }
    }

    if (buffer && buffer.trim() && buffer.trim().startsWith('data: ')) {
      try {
        const data = JSON.parse(buffer.trim().slice(6));
        const content = data.choices?.[0]?.delta?.content || '';
        if (content) {
          yield content;
          yieldedCount++;
        }
      } catch {
        // ignore
      }
    }

    console.log(`[openai-provider] stream done, yielded ${yieldedCount} chunks`);
  }

  async embed(texts, options = {}) {
    const model = options.model || 'text-embedding-3-small';
    const inputArray = Array.isArray(texts) ? texts : [texts];
    const url = `${this.baseURL}/embeddings`;
    const body = { model, input: inputArray };

    const config = {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      timeout: DEFAULT_TIMEOUT,
      responseType: 'json',
    };

    const resp = await axios.post(url, body, config);
    const data = resp.data?.data;
    if (!Array.isArray(data)) {
      throw new Error('Embedding API 返回格式异常');
    }
    return data.map(d => d.embedding);
  }

  async close() {
    // nothing to close for HTTP-only provider
  }
}

module.exports = OpenAIProvider;
