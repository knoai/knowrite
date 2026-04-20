/**
 * 轻量级 MCP (Model Context Protocol) 服务器
 *
 * 基于 JSON-RPC 2.0 + SSE 传输
 * 提供工具：
 * 1. search_hot_novels — 搜索热门小说
 * 2. extract_novel_features — 提取小说特征并保存
 */

const { v4: uuidv4 } = require('crypto');
const { deconstruct } = require('../services/book-deconstructor');
const { StoryTemplate, AuthorFingerprint } = require('../models');

// 内存热门小说库（可扩展为数据库或爬虫）
const HOT_NOVELS_DB = [
  { title: '斗破苍穹', author: '天蚕土豆', genre: '玄幻', popularity: 98, description: '少年萧炎逆袭成长，废材变天才的热血故事' },
  { title: '凡人修仙传', author: '忘语', genre: '修仙', popularity: 96, description: '韩立从凡人一步步修炼成仙的艰辛历程' },
  { title: '诡秘之主', author: '爱潜水的乌贼', genre: '西幻', popularity: 95, description: '克苏鲁风格西幻，22条途径序列的设定天花板' },
  { title: '大奉打更人', author: '卖报小郎君', genre: '仙侠探案', popularity: 94, description: '许七安在大奉王朝的探案修仙之路' },
  { title: '我师兄实在太稳健了', author: '言归正传', genre: '洪荒', popularity: 92, description: '九成八苟圣李长寿的稳健修仙日常' },
  { title: '深空彼岸', author: '辰东', genre: '都市修仙', popularity: 91, description: '旧术与新术碰撞，王煊的进化之路' },
  { title: '夜的命名术', author: '会说话的肘子', genre: '都市异能', popularity: 90, description: '表里世界切换，庆尘的赛博朋克冒险' },
  { title: '道诡异仙', author: '狐尾的笔', genre: '克苏鲁修仙', popularity: 93, description: '李火旺分不清现实与幻觉的诡异修仙' },
  { title: '赤心巡天', author: '情何以甚', genre: '仙侠', popularity: 88, description: '姜望从庄国底层一步步走向巅峰' },
  { title: '玄鉴仙族', author: '季越人', genre: '家族修仙', popularity: 87, description: '李家四代人的家族修仙史诗' },
];

class McpServer {
  constructor() {
    this.sessions = new Map();
    this.tools = [
      {
        name: 'search_hot_novels',
        description: '搜索当前热门网络小说，可指定题材和数量',
        inputSchema: {
          type: 'object',
          properties: {
            genre: { type: 'string', description: '题材筛选（如：玄幻/修仙/都市/言情）' },
            limit: { type: 'number', description: '返回数量（默认5，最大10）' },
          },
        },
      },
      {
        name: 'extract_novel_features',
        description: '对小说文本进行深度拆书分析，提取结构、人物、世界观、风格等特征',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: '小说文本内容（至少100字）' },
            title: { type: 'string', description: '小说标题' },
            author: { type: 'string', description: '作者名' },
            save: { type: 'boolean', description: '是否保存提取结果为套路和风格模板（默认true）' },
          },
          required: ['text'],
        },
      },
    ];
  }

  // SSE 连接初始化
  async handleSseConnection(req, res) {
    const sessionId = uuidv4();
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const session = {
      id: sessionId,
      res,
      messageEndpoint: `/mcp/messages?sessionId=${sessionId}`,
    };
    this.sessions.set(sessionId, session);

    // 发送 endpoint 事件
    this.sendEvent(session, 'endpoint', { uri: session.messageEndpoint });

    req.on('close', () => {
      this.sessions.delete(sessionId);
      console.log(`[mcp] session ${sessionId} closed`);
    });

    console.log(`[mcp] new session ${sessionId}`);
  }

  // 处理客户端 JSON-RPC 消息
  async handleMessage(req, res) {
    const { sessionId } = req.query;
    const session = this.sessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Session not found' }, id: null });
    }

    const message = req.body;
    const { id, method, params } = message;

    console.log(`[mcp] session=${sessionId} method=${method}`);

    try {
      switch (method) {
        case 'initialize':
          this.sendEvent(session, 'message', {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'knowrite-mcp', version: '1.0.0' },
            },
          });
          break;

        case 'tools/list':
          this.sendEvent(session, 'message', {
            jsonrpc: '2.0',
            id,
            result: { tools: this.tools },
          });
          break;

        case 'tools/call':
          const result = await this.callTool(params.name, params.arguments);
          this.sendEvent(session, 'message', {
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
          });
          break;

        default:
          this.sendEvent(session, 'message', {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Method not found: ${method}` },
          });
      }
    } catch (err) {
      console.error('[mcp] tool error:', err.message);
      this.sendEvent(session, 'message', {
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: err.message },
      });
    }

    res.status(202).json({ status: 'accepted' });
  }

  // 调用工具
  async callTool(name, args) {
    switch (name) {
      case 'search_hot_novels': {
        const { genre, limit = 5 } = args;
        let results = HOT_NOVELS_DB;
        if (genre) {
          results = results.filter((n) => n.genre.includes(genre));
        }
        return { novels: results.slice(0, Math.min(limit, 10)) };
      }

      case 'extract_novel_features': {
        const { text, title, author, save = true } = args;
        if (!text || text.length < 100) {
          throw new Error('文本太短，至少需要100字');
        }
        const analysis = await deconstruct(text, { title, author });

        if (save) {
          // 保存为 StoryTemplate
          if (analysis.structure?.beatStructure?.length) {
            await StoryTemplate.create({
              scope: 'global',
              name: `${analysis.meta.title || title || '拆书'} 套路`,
              category: analysis.structure.genre || '其他',
              description: analysis.summary?.substring(0, 500) || '',
              beatStructure: analysis.structure.beatStructure || [],
              tags: [analysis.structure.genre, 'MCP拆书'].filter(Boolean),
            });
          }
          // 保存为 AuthorFingerprint
          if (analysis.style) {
            await AuthorFingerprint.create({
              name: `${analysis.meta.title || title || '拆书'} 风格`,
              description: `MCP 拆书提取的风格指纹`,
              narrativeLayer: analysis.style.narrativeLayer,
              characterLayer: analysis.style.characterLayer,
              plotLayer: analysis.style.plotLayer,
              languageLayer: analysis.style.languageLayer,
              worldLayer: analysis.style.worldLayer,
              sampleParagraphs: analysis.style.sampleParagraphs || [],
            });
          }
        }

        return { analysis, saved: save };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  sendEvent(session, event, data) {
    try {
      session.res.write(`event: ${event}\n`);
      session.res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (err) {
      console.error('[mcp] sendEvent error:', err.message);
    }
  }
}

module.exports = new McpServer();
