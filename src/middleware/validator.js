/**
 * Zod 输入校验中间件
 */

function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({
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

function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({
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
