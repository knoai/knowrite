/**
 * Chat 路由 Zod Schema 定义
 */

const { z } = require('zod');

const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'function', 'tool']),
  content: z.string(),
  name: z.string().optional(),
});

const chatSchema = z.object({
  messages: z.array(messageSchema).min(1),
  model: z.string().max(100).optional(),
  provider: z.string().max(50).optional(),
  temperature: z.number().min(0).max(2).optional().default(0.7),
  stream: z.boolean().optional().default(true),
});

const completionsSchema = z.object({
  messages: z.array(messageSchema).min(1),
  model: z.string().max(100),
  provider: z.string().max(50).optional(),
  temperature: z.number().min(0).max(2).optional().default(0.7),
  stream: z.boolean().optional().default(false),
  max_tokens: z.number().int().positive().optional(),
});

module.exports = {
  chatSchema,
  completionsSchema,
};
