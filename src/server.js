require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const morgan = require('morgan');
const axios = require('axios');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const novelRouter = require('./routes/novel');
const worldContextRouter = require('./routes/world-context');
const { router: templatesRouter, seedDefaultTemplates } = require('./routes/templates');
const temporalTruthRouter = require('./routes/temporal-truth');
const authorFingerprintRouter = require('./routes/author-fingerprint');
const outputGovernanceRouter = require('./routes/output-governance');
const inputGovernanceRouter = require('./routes/input-governance');
const { getSettings } = require('./services/settings-store');
const { requireAuth } = require('./middleware/auth');
const { runStreamChat } = require('./core/chat');
const { validateBody } = require('./middleware/validator');
const { chatSchema, completionsSchema } = require('./schemas/chat');
const netCfg = require('../config/network.json');

const app = express();
app.use(express.json({ limit: netCfg.server.jsonBodyLimit }));

// ========== CORS ==========
const corsOrigins = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean);
app.use(cors({
  origin: corsOrigins.length ? corsOrigins : true,
  credentials: true,
  methods: netCfg.cors.methods,
  allowedHeaders: netCfg.cors.allowedHeaders,
}));

// ========== 限流 ==========
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || netCfg.rateLimit.windowMs,
  max: parseInt(process.env.RATE_LIMIT_MAX, 10) || netCfg.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too Many Requests', message: '请求过于频繁，请稍后再试' },
  skip: (req) => netCfg.rateLimit.skipPaths.includes(req.path),
});
app.use(apiLimiter);

// ========== 认证 ==========
app.use(requireAuth);

// ========== 日志配置 ==========
const LOG_DIR = path.join(__dirname, netCfg.server.logDir);
try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
} catch {
  // 目录已存在或权限问题，忽略
}

const accessLogStream = fs.createWriteStream(path.join(LOG_DIR, netCfg.server.accessLogFile), { flags: 'a' });

morgan.token('body', (req) => {
  if (req.body && Object.keys(req.body).length > 0) {
    const safeBody = { ...req.body };
    if (safeBody.messages && Array.isArray(safeBody.messages)) {
      safeBody.messages = `[${safeBody.messages.length} messages]`;
    }
    if (safeBody.prompt && typeof safeBody.prompt === 'string' && safeBody.prompt.length > 200) {
      safeBody.prompt = safeBody.prompt.substring(0, 200) + '...';
    }
    return JSON.stringify(safeBody);
  }
  return '-';
});

const morganFormat = ':date[iso] :method :url :status :res[content-length] - :response-time ms :body';
app.use(morgan(morganFormat, { stream: accessLogStream }));
app.use(morgan('dev'));

async function logApiSummary(data) {
  const line = JSON.stringify({ time: new Date().toISOString(), ...data });
  try {
    await fs.promises.appendFile(path.join(LOG_DIR, netCfg.server.apiLogFile), line + '\n');
  } catch (err) {
    console.error('[Server] api.log 写入失败:', err.message);
  }
}

// ========== Provider 分流 ==========
const PROXY_BASE = process.env.PROXY_URL || netCfg.proxy.baseURL;
const WEB_PROVIDERS = new Set(netCfg.proxy.webProviders);

function isWebProvider(name) {
  return WEB_PROVIDERS.has(name?.toLowerCase());
}

function normalizeError(err) {
  return {
    error: err.name || 'Error',
    message: err.message || '未知错误',
    ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
  };
}

// ========== 静态文件 ==========
app.use(express.static(path.join(__dirname, netCfg.server.staticDir)));

// 挂载 novel API
app.use('/api/novel', novelRouter);
app.use('/api/novel/works/:workId', worldContextRouter);
app.use('/api/novel/story-templates', templatesRouter);
app.use('/api/truth', temporalTruthRouter);
app.use('/api/style', authorFingerprintRouter);
app.use('/api/output', outputGovernanceRouter);
app.use('/api/input-governance', inputGovernanceRouter);

// 健康检查
app.get('/health', async (req, res) => {
  const checks = [];

  // 1. 数据库连接检查
  try {
    const { sequelize } = require('./models');
    await sequelize.authenticate();
    checks.push({ name: 'database', status: 'ok', message: 'SQLite 连接正常' });
  } catch (err) {
    checks.push({ name: 'database', status: 'error', message: err.message });
  }

  // 2. 磁盘空间检查
  try {
    const { statfs } = require('fs').promises;
    const stat = await statfs(process.cwd());
    const freeGB = (stat.bavail * stat.bsize / (1024 ** 3)).toFixed(2);
    const totalGB = (stat.blocks * stat.bsize / (1024 ** 3)).toFixed(2);
    const usagePercent = (((stat.blocks - stat.bavail) / stat.blocks) * 100).toFixed(1);
    const ok = parseFloat(usagePercent) < 90;
    checks.push({
      name: 'disk',
      status: ok ? 'ok' : 'warning',
      message: ok ? `磁盘使用 ${usagePercent}%` : `磁盘使用 ${usagePercent}%，空间不足`,
      freeGB,
      totalGB,
      usagePercent: parseFloat(usagePercent),
    });
  } catch (err) {
    checks.push({ name: 'disk', status: 'error', message: err.message });
  }

  // 3. Proxy 可达性检查
  try {
    await axios.head(`${PROXY_BASE}/health`, { timeout: 5000, validateStatus: () => true });
    checks.push({ name: 'proxy', status: 'ok', message: 'Proxy 服务可达' });
  } catch (err) {
    checks.push({ name: 'proxy', status: 'warning', message: `Proxy 检查失败: ${err.message}` });
  }

  // 4. 内存使用检查
  const mem = process.memoryUsage();
  const heapUsedMB = (mem.heapUsed / 1024 / 1024).toFixed(1);
  const heapTotalMB = (mem.heapTotal / 1024 / 1024).toFixed(1);
  const memWarning = mem.heapUsed / mem.heapTotal > 0.85;
  checks.push({
    name: 'memory',
    status: memWarning ? 'warning' : 'ok',
    message: `堆内存使用 ${heapUsedMB}MB / ${heapTotalMB}MB`,
    heapUsedMB: parseFloat(heapUsedMB),
    heapTotalMB: parseFloat(heapTotalMB),
  });

  const healthy = checks.every((c) => c.status === 'ok');
  const hasError = checks.some((c) => c.status === 'error');
  const statusCode = hasError ? 503 : healthy ? 200 : 200;

  res.status(statusCode).json({
    status: hasError ? 'degraded' : healthy ? 'ok' : 'warning',
    checks,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ========== 通用聊天接口 ==========
app.post('/chat', validateBody(chatSchema), async (req, res, next) => {
  const startTime = Date.now();
  const { messages, model = 'deepseek-v3', provider: reqProvider, temperature = 0.7 } = req.validatedBody;
  const stream = req.validatedBody.stream !== false;
  const providerName = (reqProvider || process.env.PROVIDER || 'yuanbao').toLowerCase();

  try {

    if (isWebProvider(providerName)) {
      // Web Provider → 转发到 proxy
      const proxyModel = providerName.includes('/') ? model : `${providerName}/${model}`;
      const proxyRes = await axios.post(
        `${PROXY_BASE}/v1/chat/completions`,
        { model: proxyModel, messages, temperature, stream },
        { responseType: stream ? 'stream' : 'json', timeout: 300000 }
      );
      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        proxyRes.data.pipe(res);
      } else {
        res.json(proxyRes.data);
      }
    } else {
      // API Provider → 本地直连
      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const result = await runStreamChat(
          messages,
          { provider: providerName, model, temperature },
          {
            onChunk: (chunk) => {
              res.write(`data: ${JSON.stringify({ chunk }) }\n\n`);
            },
          }
        );
        res.write(`data: ${JSON.stringify({ done: true, chars: result.chars, durationMs: result.durationMs })}\n\n`);
        res.end();
      } else {
        const result = await runStreamChat(
          messages,
          { provider: providerName, model, temperature },
          {}
        );
        res.json({ content: result.content, chars: result.chars, durationMs: result.durationMs });
      }
    }

    await logApiSummary({ endpoint: '/chat', model, provider: providerName, stream, messageCount: messages.length, durationMs: Date.now() - startTime, status: 'ok' });
  } catch (err) {
    await logApiSummary({ endpoint: '/chat', model, provider: providerName, stream, messageCount: messages?.length || 0, durationMs: Date.now() - startTime, status: 'error', error: err.message });
    next(err);
  }
});

// ========== OpenAI 兼容接口 ==========
app.post('/v1/chat/completions', validateBody(completionsSchema), async (req, res, next) => {
  const startTime = Date.now();
  const { messages, model } = req.validatedBody;
  const stream = req.validatedBody.stream === true;
  const providerName = (req.validatedBody.provider || process.env.PROVIDER || 'yuanbao').toLowerCase();

  try {

    if (isWebProvider(providerName)) {
      // Web Provider → 转发到 proxy
      const proxyRes = await axios.post(
        `${PROXY_BASE}/v1/chat/completions`,
        req.body,
        { responseType: stream ? 'stream' : 'json', timeout: 300000 }
      );
      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        proxyRes.data.pipe(res);
      } else {
        res.json(proxyRes.data);
      }
    } else {
      // API Provider → 本地 OpenAI 兼容输出
      const id = `chatcmpl-${Date.now()}`;
      const created = Math.floor(Date.now() / 1000);
      const modelName = typeof model === 'string' ? model : (model?.model || 'unknown');

      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        let index = 0;
        const result = await runStreamChat(
          messages,
          { provider: providerName, model: modelName, temperature: req.body.temperature },
          {
            onChunk: (chunk) => {
              res.write(`data: ${JSON.stringify({
                id, object: 'chat.completion.chunk', created, model: modelName,
                choices: [{ index: index++, delta: { content: chunk }, finish_reason: null }],
              })}\n\n`);
            },
          }
        );
        res.write(`data: ${JSON.stringify({
          id, object: 'chat.completion.chunk', created, model: modelName,
          choices: [{ index, delta: {}, finish_reason: 'stop' }],
        })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        const result = await runStreamChat(
          messages,
          { provider: providerName, model: modelName, temperature: req.body.temperature },
          {}
        );
        res.json({
          id, object: 'chat.completion', created, model: modelName,
          choices: [{
            index: 0,
            message: { role: 'assistant', content: result.content },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
      }
    }

    await logApiSummary({ endpoint: '/v1/chat/completions', model, provider: providerName, stream, messageCount: messages.length, durationMs: Date.now() - startTime, status: 'ok' });
  } catch (err) {
    await logApiSummary({ endpoint: '/v1/chat/completions', model, provider: providerName, stream, messageCount: messages?.length || 0, durationMs: Date.now() - startTime, status: 'error', error: err.message });
    next(err);
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, netCfg.server.spaFallback));
});

// ========== 统一错误处理 ==========
app.use((err, req, res, next) => {
  console.error('[Server] Error:', err.message);
  const status = err.status || err.statusCode || 500;
  res.status(status).json(normalizeError(err));
});

const PORT = process.env.PORT || netCfg.server.port;

(async () => {
  try {
    await getSettings();
  } catch (err) {
    console.error('[Server] 配置迁移异常:', err.message);
  }

  try {
    await seedDefaultTemplates();
    console.log('[Server] 套路模版初始化完成');
  } catch (err) {
    console.error('[Server] 套路模版初始化异常:', err.message);
  }

  const server = app.listen(PORT, () => {
    console.log(`[Server] knowrite 服务已启动: http://localhost:${PORT}`);
    console.log(`[Server] Proxy: ${PROXY_BASE}`);
    console.log(`[Server] 小说创作工作台: http://localhost:${PORT}/`);
    if (process.env.AUTH_TOKEN) {
      console.log(`[Server] 认证已启用（Bearer Token / X-API-Key）`);
    } else {
      console.log(`[Server] ⚠️  认证未启用，如需启用请设置 AUTH_TOKEN 环境变量`);
    }
  });

  // 优雅关闭
  async function gracefulShutdown(signal) {
    console.log(`[Server] 收到 ${signal}，开始优雅关闭...`);
    server.close(() => {
      console.log('[Server] HTTP 服务已关闭');
    });
    try {
      const { sequelize } = require('./models');
      await sequelize.close();
      console.log('[Server] 数据库连接已关闭');
    } catch (err) {
      console.error('[Server] 关闭数据库连接失败:', err.message);
    }
    console.log('[Server] 优雅关闭完成');
    process.exit(0);
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
})();
