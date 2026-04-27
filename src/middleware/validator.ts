/**
 * Zod 输入校验中间件
 */

import type { Request, Response, NextFunction } from 'express';
import type { ZodType } from 'zod';

interface ValidatedRequest extends Request {
  validatedBody?: unknown;
  validatedQuery?: unknown;
}

function validateBody(schema: ZodType) {
  return (req: ValidatedRequest, res: Response, next: NextFunction): any => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const issues = result.error.issues.map((i: any) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      return res.status(400).json({
        error: 'ValidationError',
        message: '请求参数校验失败',
        issues,
      });
    }
    req.validatedBody = result.data;
    next();
  };
}

function validateQuery(schema: ZodType) {
  return (req: ValidatedRequest, res: Response, next: NextFunction): any => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const issues = result.error.issues.map((i: any) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      return res.status(400).json({
        error: 'ValidationError',
        message: '查询参数校验失败',
        issues,
      });
    }
    req.validatedQuery = result.data;
    next();
  };
}

module.exports = { validateBody, validateQuery };
