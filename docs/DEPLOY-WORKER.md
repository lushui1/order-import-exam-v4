# Worker / Dispatcher 部署指引（Railway / Render / Fly.io）

> PRD 3.1：Vercel Serverless 不适合常驻长任务（单请求有超时限制），
> 因此 Outbox Dispatcher 与 Import Worker 必须部署为**常驻进程**。
> 本指引覆盖 Railway、Render、Fly.io 三种常用平台的部署步骤。

## 架构职责

| 组件 | 命令 | 说明 |
|---|---|---|
| Outbox Dispatcher | `npm run dispatcher` | 每 3s 轮询 `event_outbox`，投递批次事件到 BullMQ 队列；同时执行卡死批次恢复 |
| Import Worker | `npm run worker` | 消费队列批次 Job：复用规则引擎 → SKU 批量校验 → 批量 UPSERT → 错误/性能日志 → 原子进度 |

## 前置依赖

| 依赖 | 配置项 | 说明 |
|---|---|---|
| PostgreSQL | `DATABASE_URL` | 与 Vercel 同库（含 `?schema=exam_v4`） |
| Redis | `REDIS_URL` | BullMQ 队列（Upstash / 自建 / Railway Redis） |
| 文件存储 | `STORAGE_BACKEND` | 生产必须为 `s3`（对象存储）并配置 `STORAGE_ENDPOINT/BUCKET/ACCESS_KEY/SECRET_KEY`；`local` 仅限单机开发 |

> ⚠️ 文件存储一致性：Vercel 上传的文件必须能被 Worker 读取，因此生产环境两者都必须使用**同一对象存储**（S3/R2/OSS），不能一方 local 一方 s3。

## 方式一：Railway（推荐，内置 Redis）

### 1. 创建 Redis

Railway 控制台 → New → Database → Redis，记录 `REDIS_URL`（格式 `redis://default:xxx@host:port`）。

### 2. 部署 Dispatcher

1. Railway 控制台 → New Project → Deploy from GitHub → 选择 `lushui1/order-import-exam-v4`；
2. Service 启动命令（Start Command）填写：
   ```bash
   npm run dispatcher
   ```
3. 添加环境变量：
   ```
   DATABASE_URL=postgresql://...?...&schema=exam_v4
   REDIS_URL=redis://default:xxx@host:port
   STORAGE_BACKEND=s3
   STORAGE_ENDPOINT=https://...
   STORAGE_BUCKET=...
   STORAGE_ACCESS_KEY=...
   STORAGE_SECRET_KEY=...
   ```

### 3. 部署 Worker

同样方式再建一个 Service，启动命令填写：
```bash
npm run worker
```
环境变量同 Dispatcher（可复制）。

### 4. 扩容

Worker Service → Settings → Replicas 设置为 2~4（横向扩容消费能力）。

## 方式二：Render

1. Render 控制台 → New → Web Service → 连接 GitHub 仓库；
2. **Start Command** 填写 `npm run dispatcher`（或 `npm run worker`）；
3. Environment → 添加上述环境变量；
4. 注意 Render Web Service 需要常驻进程，保持默认 Health Check 即可；
5. 若使用 Render 的 PostgreSQL/Redis 插件，直接在环境变量中引用其连接串。

## 方式三：Fly.io

```bash
# 1. 创建 Dockerfile（项目根目录）
cat > Dockerfile <<'EOF'
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate

FROM node:20-slim
WORKDIR /app
COPY --from=build /app ./
CMD ["npm", "run", "worker"]
EOF

# 2. 部署 Dispatcher 服务
fly launch --name exam-v4-dispatcher --no-deploy
fly secrets set DATABASE_URL="..." REDIS_URL="..." STORAGE_BACKEND="s3" ...
fly deploy --image-only   # 修改 CMD 为 npm run dispatcher

# 3. 部署 Worker 服务（并行消费）
fly launch --name exam-v4-worker --no-deploy
fly secrets set DATABASE_URL="..." REDIS_URL="..." ...
fly scale count 2        # 2 个实例并行消费
```

## 验证部署

```bash
# 本地可先验证脚本能启动（需配置 REDIS_URL 与 DATABASE_URL）
npm run dispatcher   # 日志出现 "[Dispatcher] 启动"
npm run worker       # 日志出现 "[Worker] 启动"
```

在线压测（完整链路）：
```bash
# 打在线地址（需可访问 Vercel 的网络环境）
LOAD_TEST_BASE_URL="https://monkeycodevercel.vercel.app" npm run load-test
```

## 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| Dispatcher 报 `REDIS_URL 未配置` | 环境变量缺失 | 检查 Redis 连接串已注入 |
| Worker 报 `REDIS_URL 未配置` | 同上 | 同上 |
| Worker 处理失败重试 5 次 | 文件读不到 / 规则缺失 | 检查 STORAGE_BACKEND 与文件 key 一致性；确认任务关联 ruleId |
| 任务卡在 processing | Worker 崩溃未恢复 | Dispatcher 内置卡死恢复：5 分钟超时自动重置为 pending 重投（最多 3 次） |
