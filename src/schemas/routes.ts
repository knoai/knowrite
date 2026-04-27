import { z } from 'zod';
/**
 * 通用路由 Zod Schema 定义
 * 覆盖 truth、style、output、input-governance 路由
 */




// ========== temporal-truth ==========

const createHookSchema: z.ZodType = z.object({
  description: z.string().min(1).max(500),
  importance: z.number().int().min(1).max(10).optional().default(5),
  targetChapter: z.number().int().positive().optional(),
});

const updateHookSchema: z.ZodType = z.object({
  description: z.string().min(1).max(500).optional(),
  importance: z.number().int().min(1).max(10).optional(),
  targetChapter: z.number().int().positive().optional(),
  status: z.enum(['open', 'progressing', 'resolved']).optional(),
});

const createResourceSchema: z.ZodType = z.object({
  name: z.string().min(1).max(100),
  owner: z.string().max(100).optional(),
  quantity: z.number().int().min(0).optional().default(1),
});

const updateResourceSchema: z.ZodType = z.object({
  name: z.string().min(1).max(100).optional(),
  owner: z.string().max(100).optional(),
  quantity: z.number().int().min(0).optional(),
  status: z.enum(['active', 'consumed', 'lost']).optional(),
});

// ========== author-fingerprint ==========

const analyzeFingerprintSchema: z.ZodType = z.object({
  text: z.string().min(1).max(100_000),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

const importStyleSchema: z.ZodType = z.object({
  fingerprintId: z.number().int().positive(),
  priority: z.number().int().min(1).max(10).optional().default(5),
});

const validateStyleSchema: z.ZodType = z.object({
  chapterText: z.string().min(1).max(50_000),
  fingerprintId: z.number().int().positive(),
});

// ========== output-governance ==========

const humanReviewSchema: z.ZodType = z.object({
  decision: z.enum(['approve', 'reject', 'revise']),
  notes: z.string().max(2000).optional().default(''),
});

const createRuleSchema: z.ZodType = z.object({
  name: z.string().min(1).max(100),
  level: z.enum(['l1', 'l2']),
  category: z.string().max(50).optional(),
  condition: z.object({
    type: z.string(),
    value: z.union([z.number(), z.string()]),
  }),
  action: z.enum(['warn', 'block']).optional().default('warn'),
  isActive: z.boolean().optional().default(true),
});

const updateRuleSchema: z.ZodType = z.object({
  name: z.string().min(1).max(100).optional(),
  level: z.enum(['l1', 'l2']).optional(),
  category: z.string().max(50).optional(),
  condition: z.object({
    type: z.string(),
    value: z.union([z.number(), z.string()]),
  }).optional(),
  action: z.enum(['warn', 'block']).optional(),
  isActive: z.boolean().optional(),
});

// ========== input-governance ==========

const authorIntentSchema: z.ZodType = z.object({
  longTermVision: z.string().max(5000).optional(),
  themes: z.array(z.string()).max(20).optional(),
  constraints: z.array(z.string()).max(20).optional(),
});

const currentFocusSchema: z.ZodType = z.object({
  focusText: z.string().min(1).max(2000),
  targetChapters: z.number().int().positive().optional().default(3),
  priority: z.number().int().min(1).max(10).optional().default(5),
  isActive: z.boolean().optional().default(true),
});

const updateFocusSchema: z.ZodType = z.object({
  focusText: z.string().min(1).max(2000).optional(),
  targetChapters: z.number().int().positive().optional(),
  priority: z.number().int().min(1).max(10).optional(),
  isActive: z.boolean().optional(),
});

const chapterIntentSchema: z.ZodType = z.object({
  mustKeep: z.string().max(2000).optional(),
  mustAvoid: z.string().max(2000).optional(),
  ruleStack: z.array(z.string()).max(20).optional(),
});

module.exports = {
  createHookSchema,
  updateHookSchema,
  createResourceSchema,
  updateResourceSchema,
  analyzeFingerprintSchema,
  importStyleSchema,
  validateStyleSchema,
  humanReviewSchema,
  createRuleSchema,
  updateRuleSchema,
  authorIntentSchema,
  currentFocusSchema,
  updateFocusSchema,
  chapterIntentSchema,
};
