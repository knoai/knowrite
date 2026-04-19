const OpenAIProvider = require('./openai');

class ProviderFactory {
  static create(providerName, options = {}) {
    // 所有 provider 统一使用 OpenAI 兼容协议，名称仅用于标识
    return new OpenAIProvider(options, providerName);
  }

  static list() {
    return ['openai'];
  }
}

module.exports = ProviderFactory;
