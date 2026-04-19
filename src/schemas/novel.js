/**
 * Novel 路由 Zod Schema 定义
 */

const { z } = require('zod');

const startSchema = z.object({
  topic: z.string().min(1).max(200),
  style: z.string().max(100).optional(),
  platformStyle: z.string().max(100).optional(),
  authorStyle: z.string().max(100).optional(),
  strategy: z.enum(['knowrite', 'pipeline']).optional().default('pipeline'),
  customModels: z.record(z.string()).optional().default({}),
  writingMode: z.enum(['standard', 'free']).optional(),
}).refine((data) => data.style || (data.platformStyle && data.authorStyle), {
  message: '必须提供 style，或同时提供 platformStyle 和 authorStyle',
  path: ['style'],
});

const continueSchema = z.object({
  workId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$/, 'workId 只能包含字母、数字、中文、下划线和横线'),
  customModels: z.record(z.string()).optional().default({}),
  targetVolume: z.number().int().positive().optional(),
});

const importSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(50_000_000), // 50MB 上限
  options: z.object({
    strategy: z.enum(['knowrite', 'pipeline']).optional(),
    platformStyle: z.string().optional(),
    authorStyle: z.string().optional(),
  }).optional().default({}),
});

const importOutlineSchema = z.object({
  title: z.string().min(1).max(200),
  outlineText: z.string().min(1).max(10_000_000), // 10MB 上限
  options: z.object({
    strategy: z.enum(['knowrite', 'pipeline']).optional(),
    platformStyle: z.string().optional(),
    authorStyle: z.string().optional(),
  }).optional().default({}),
});

module.exports = {
  startSchema,
  continueSchema,
  importSchema,
  importOutlineSchema,
};
