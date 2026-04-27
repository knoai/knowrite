import type { Request, Response, NextFunction } from 'express';

/**
 * 基础认证中间件
 * 支持 Bearer Token 或 X-API-Key 头部
 * 默认读取环境变量 AUTH_TOKEN，未设置时不启用认证（开发模式）
 */

const AUTH_TOKEN = process.env.AUTH_TOKEN || '';

if (!AUTH_TOKEN && process.env.NODE_ENV === 'production') {
  console.error('[Auth] ❌ 生产环境必须设置 AUTH_TOKEN 环境变量');
}

function requireAuth(req: Request, res: Response, next: NextFunction): any {
  if (!AUTH_TOKEN) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({ error: 'Service Unavailable', message: '服务未配置认证，请联系管理员' });
    }
    return next();
  }

  const token: string | undefined =
    (req.headers.authorization?.startsWith('Bearer ') && req.headers.authorization.slice(7)) ||
    (req.headers['x-api-key'] as string | undefined);

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized', message: '缺少认证令牌，请在请求头中提供 Authorization: Bearer <token> 或 X-API-Key: <token>' });
  }

  if (token !== AUTH_TOKEN) {
    return res.status(403).json({ error: 'Forbidden', message: '认证令牌无效' });
  }

  next();
}

module.exports = { requireAuth };
