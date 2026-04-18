/**
 * 基础认证中间件
 * 支持 Bearer Token 或 X-API-Key 头部
 * 默认读取环境变量 AUTH_TOKEN，未设置时不启用认证（开发模式）
 */

const AUTH_TOKEN = process.env.AUTH_TOKEN || '';

function requireAuth(req, res, next) {
  if (!AUTH_TOKEN) {
    return next();
  }

  const token =
    (req.headers.authorization?.startsWith('Bearer ') && req.headers.authorization.slice(7)) ||
    req.headers['x-api-key'] ||
    req.query.apiKey;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized', message: '缺少认证令牌，请在请求头中提供 Authorization: Bearer <token> 或 X-API-Key: <token>' });
  }

  if (token !== AUTH_TOKEN) {
    return res.status(403).json({ error: 'Forbidden', message: '认证令牌无效' });
  }

  next();
}

module.exports = { requireAuth };
