const axios = require('axios');
const BaseProvider = require('../base-provider');

const netCfg = require('../../../config/network.json');
const DEFAULT_TIMEOUT = netCfg.timeouts.openaiProvider;

class OpenAIProvider extends BaseProvider {
  constructor(options = {}) {
    super('openai', options);
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY || '';
    this.baseURL = (options.baseURL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  }

  async authenticate() {
    if (!this.apiKey) {
      throw new Error('OpenAI provider 缺少 apiKey，请在设置中配置或设置环境变量 OPENAI_API_KEY');
    }
    return true;
  }

  async chat(messages, options = {}) {
    const model = options.model || 'gpt-4o';
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
    const config = {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      timeout: DEFAULT_TIMEOUT,
      responseType: stream ? 'stream' : 'json',
    };
    return axios.post(url, body, config);
  }

  async _chatSync(url, body) {
    const resp = await this._request(url, body, false);
    return resp.data?.choices?.[0]?.message?.content || '';
  }

  async *_chatStream(url, body) {
    const resp = await this._request(url, body, true);
    const stream = resp.data;
    let buffer = '';

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
            if (content) yield content;
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
        if (content) yield content;
      } catch {
        // ignore
      }
    }
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
