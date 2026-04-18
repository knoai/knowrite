# Knowrite 小说创作引擎 — 多阶段构建
# 构建：docker build -t knowrite:latest .
# 运行：docker run -p 8000:8000 --env-file .env knowrite:latest

# ========== 阶段 1：依赖安装 ==========
FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# ========== 阶段 2：生产镜像 ==========
FROM node:24-alpine AS runner

# 安装 dumb-init 用于信号转发（支持优雅关闭）
RUN apk add --no-cache dumb-init

# 创建非 root 用户
RUN addgroup -g 1001 -S nodejs && adduser -S knowrite -u 1001

WORKDIR /app

# 复制依赖
COPY --from=deps --chown=knowrite:nodejs /app/node_modules ./node_modules
COPY --chown=knowrite:nodejs . .

# 创建必要的数据目录
RUN mkdir -p data works logs && chown -R knowrite:nodejs data works logs

USER knowrite

ENV NODE_ENV=production
ENV PORT=8000

EXPOSE 8000

# dumb-init 确保 SIGTERM/SIGINT 正确转发给 Node.js 进程
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
