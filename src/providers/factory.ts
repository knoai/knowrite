const OpenAIProvider = require('./openai');
const BaseProvider = require('./base-provider');

class ProviderFactory {
  static create(providerName: string, options: Record<string, unknown> = {}): InstanceType<typeof BaseProvider> {
    // 所有 provider 统一使用 OpenAI 兼容协议，名称仅用于标识
    return new OpenAIProvider(options, providerName);
  }

  static list(): string[] {
    return ['openai'];
  }
}

module.exports = ProviderFactory;
