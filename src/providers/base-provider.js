/**
 * BaseProvider - 所有模型 Provider 的基类
 * 统一接口：authenticate, chat, close
 */
class BaseProvider {
  constructor(name, options = {}) {
    this.name = name;
    this.options = options;
  }

  /**
   * 执行授权/登录
   * @returns {Promise<boolean>}
   */
  async authenticate() {
    throw new Error(`Provider ${this.name} must implement authenticate()`);
  }

  /**
   * 发送聊天请求
   * @param {Array<{role:string, content:string}>} messages
   * @param {Object} options - { model, stream, chatId, multimedia, shouldRemoveConversation }
   * @returns {Promise<string|AsyncGenerator<string>>}
   */
  async chat(messages, options = {}) {
    throw new Error(`Provider ${this.name} must implement chat()`);
  }

  /**
   * 关闭资源
   * @returns {Promise<void>}
   */
  async close() {
    // 子类可覆盖
  }
}

module.exports = BaseProvider;
