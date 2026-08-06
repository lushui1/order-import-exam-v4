# 万能导入 V4 — 异步事件驱动批量导入系统

基于 V2「万能导入解析系统」的异步事件驱动重构（PRD V4.0）。上传即返回 task_id，文件解析、规则执行、SKU 批量校验、批量写库由队列 + Worker 异步完成，全链路 trace_id 追踪 + 监控看板。

## 技术栈

- Next.js 16 App Router + TypeScript + React 19（Vercel）
- PostgreSQL + Prisma 6
- BullMQ + Redis（本地 / Upstash）
- 文件解析复用 V2 规则引擎（Excel/Word/PDF）

## 目录结构

```text
src/
├── app/
│   ├── page.tsx                    # 上传首页（上传即返回 task_id）
│   ├── tasks/[id]/page.tsx         # 任务进度页（1.5s 轮询）
│   ├── tasks/[id]/errors/page.tsx  # 错误明细页（筛选/分页/脱敏）
│   ├── monitor/page.tsx            # 监控看板（吞吐/积压/耗时/错误分布）
│   ├── traces/page.tsx             # Trace 检索页（时间线）
│   └── api/
│       ├── import-tasks/           # 创建任务 / 查询进度 / 错误 / 批次
│       ├── traces/[traceId]        # Trace 搜索
│       └── import-monitor/summary  # 监控聚合
├── lib/
│   ├── import-task-service.ts      # 任务+批次+Outbox 同事务创建
│   ├── batch-processor.ts          # Worker 批次处理（幂等/批量校验/批量写/降级）
│   ├── outbox-dispatcher.ts        # Outbox 轮询投递
│   ├── queue.ts                    # BullMQ 封装
│   ├── events.ts / trace.ts        # 事件信封 / trace_id
│   ├── masking.ts                  # 敏感字段脱敏
│   └── rule-engine/                # V2 复用规则引擎
├── scripts/
│   ├── seed-data.ts                # 压测数据（20k SKU + 10k 行 Excel + 规则）
│   ├── dispatcher.ts               # Outbox Dispatcher 常驻进程
│   ├── worker.ts                   # Import Worker 常驻进程
│   └── load-test.ts                # 压测脚本
├── test/                           # vitest 自动化测试
└── docs/                           # 架构/接口/假设/压测报告
```

## 本地启动

### 1. 环境变量

复制 `.env.example` 为 `.env`，配置：

```bash
DATABASE_URL="postgresql://user:pass@host:5432/db"
REDIS_URL="redis://localhost:6379"        # 本地 Redis 或 Upstash
STORAGE_BACKEND="local"                   # local | s3
V2_API_KEY=""                             # 未配置时 v2 接口拒绝所有请求
LLM_API_KEY=""                            # AI 规则生成（可选）
```

> API Key、数据库、Redis 连接串全部通过环境变量配置，代码不含任何明文密钥。

### 2. 初始化数据库

```bash
npm install
npx prisma generate
npx prisma migrate dev --name init        # 或 npx prisma db push
```

### 3. 生成压测数据（PRD 模块一）

```bash
npm run seed:sku
```

- 灌入 20,000 条 SKU 主数据（SKU_00001 ~ SKU_20000）；
- 生成 `test-data/10000-orders.xlsx`（10,000 行，含故意注入的非法 SKU/电话/数量）；
- 生成解析规则 `load-test-rule`；
- 可重复执行（按前缀/名称清理重建，无脏数据累积）。

### 4. 启动服务

```bash
# 终端1：Next.js
npm run dev

# 终端2：Outbox Dispatcher（投递批次事件到队列）
npm run dispatcher

# 终端3：Import Worker（消费批次，批量校验/写入）
npm run worker
```

访问 http://localhost:3000 → 上传 `test-data/10000-orders.xlsx` → 选择 `load-test-rule` → 自动进入任务进度页。

## 压测（PRD 10.2）

```bash
# 本地直连压测（无需 Redis，复用生产核心链路 createImportTask + processBatch）
# 实测：10,000 行全链路 53.5s ≤ 60s ✅（处理单元 2,000 行/批 × 6 批，并发 6）
npm run load-test:direct

# 在线完整链路压测（上传打 Vercel 在线接口 + Worker 消费；本机需配置代理访问 Vercel）
# 实测：10,000 行全链路 39.6s ≤ 60s ✅（经代理上传耗时 9s，含跨区域网络延迟）
npm run load-test:online

# 在线 HTTP 压测（需 Redis + Worker，以及可访问 Vercel 的网络）
npm run load-test          # 默认使用 10000-orders.xlsx + load-test-rule
LOAD_TEST_BASE_URL="https://monkeycodevercel.vercel.app" npm run load-test   # 打在线地址
```

脚本执行：上传计时（P95 ≤ 1s）→ 轮询任务状态 → 统计总耗时（≤ 60s）→ 校验成功/失败行 → 输出 500/504 统计。结果填入 `docs/LOAD-TEST-REPORT.md`。

## 自动化测试（PRD 10.1）

```bash
npm test
```

覆盖：错误码校验（E001-E008）、批次校验分类（部分行失败/幂等）、敏感字段脱敏、事件信封、处理单元划分、正则 ReDoS 防护。

## 部署（Vercel）

### 在线地址（已部署）

| 项 | 地址 |
|---|---|
| 在线系统 | https://monkeycodevercel.vercel.app |
| 部署 URL | https://monkeycodevercel-6lh3rks22-lushui2s-projects.vercel.app |
| 源码仓库 | https://github.com/lushui1/order-import-exam-v4 |

> 注意：本机所在网络对 vercel.app 域名的 DNS 解析异常（被污染到错误 IP），在线 HTTP 压测需在可访问 Vercel 的网络环境中执行：
> ```bash
> LOAD_TEST_BASE_URL="https://monkeycodevercel.vercel.app" npm run load-test
> ```

### 部署步骤

1. 推送到 GitHub 仓库；
2. Vercel 导入项目，配置环境变量（DATABASE_URL / REDIS_URL / STORAGE_* / V2_API_KEY）；
3. 部署 API + 前端到 Vercel；
4. Dispatcher 与 Worker 部署为常驻进程（Railway/Render/Fly.io）：

```bash
npm run dispatcher   # Outbox Dispatcher
npm run worker       # Import Worker
```

详见 `docs/ARCHITECTURE.md` 部署拓扑。

## 故障模拟（验收演示）

| 场景 | 操作 | 预期 |
|---|---|---|
| 队列投递中断恢复 | 停 dispatcher → 上传文件 → 重启 dispatcher | Outbox 未 sent 事件继续投递 |
| Worker 重复消费 | 重启 worker 使 Job 重投 | 幂等：不重复写库/不重复累计进度 |
| 部分行失败 | 上传含非法数据的压测文件 | 成功行入库，失败行进错误明细，状态 partial_success |
| SKU 降级 | 停 SKU 主数据或制造超时 | 任务 degraded=true，前端明确提示，跳过 E001 校验 |
| 卡死恢复 | 批次长时间 processing | 可手动重置批次状态为 pending 重新处理（或由队列重试） |

## 文档

- `docs/ARCHITECTURE.md` — 架构设计（异步任务/Outbox/批量策略/事件契约）
- `docs/ASSUMPTIONS.md` — 重构假设说明（PRD 模块十一 12 项）
- `docs/API.md` — 接口文档（上传/任务/错误/批次/Trace/监控）
- `docs/LOAD-TEST-REPORT.md` — 压测报告模板

## 已实现能力对照 PRD

| PRD 模块 | 状态 |
|---|---|
| 模块一 压测数据自动准备 | ✅ scripts/seed-data.ts |
| 模块二 上传即返回 | ✅ POST /api/import-tasks（同事务 Outbox） |
| 模块三 Outbox 投递 | ✅ dispatcher + SKIP LOCKED + 指数退避 |
| 模块四 Worker 异步处理 | ✅ worker.ts（复用规则引擎/批量校验/批量写/原子进度） |
| 模块五 幂等与重复保护 | ✅ task_id+row_index 唯一键 + 批次状态机 |
| 模块六 精细化错误 | ✅ import_task_errors（E001-E008/脱敏/筛选分页） |
| 模块七 任务进度页 | ✅ /tasks/:id（轮询/吞吐/剩余时间/降级提示） |
| 模块八 监控看板 | ✅ /monitor（吞吐/积压/耗时/错误分布/慢批次） |
| 模块九 Trace 检索 | ✅ /traces（时间线） |
| 模块十 容灾降级 | ✅ SKU 查询超时降级 + 显式提示 |
| 模块十一 假设说明 | ✅ docs/ASSUMPTIONS.md |
| 十章 测试与压测 | ✅ vitest + load-test.ts + 压测报告 |
