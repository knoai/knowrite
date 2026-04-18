/**
 * Jest 配置
 * 使用 SQLite :memory: 模式进行测试，避免污染生产数据库
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: [
    'src/services/*.js',
    'src/routes/*.js',
    '!src/services/novel-engine.js', // 太大，单独测试
  ],
  coverageThreshold: {
    global: {
      branches: 30,
      functions: 30,
      lines: 30,
      statements: 30,
    },
  },
  setupFilesAfterEnv: ['./jest.setup.js'],
  testTimeout: 30000,
};
