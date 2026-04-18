const OpenAIProvider = require('./openai');

const PROVIDERS = {
  openai: OpenAIProvider,
};

class ProviderFactory {
  static create(providerName, options = {}) {
    const ProviderClass = PROVIDERS[providerName.toLowerCase()];
    if (!ProviderClass) {
      throw new Error(`Unknown provider: ${providerName}. Supported: ${Object.keys(PROVIDERS).join(', ')}`);
    }
    return new ProviderClass(options);
  }

  static list() {
    return Object.keys(PROVIDERS);
  }
}

module.exports = ProviderFactory;
