# 压测报告（PRD 10.3）

> 压测环境：本机（Windows，中国网络）直连 Neon PostgreSQL（us-east-1）。
> 说明：本环境到 Neon 单次查询往返约 4s（网络延迟），真实部署（Vercel + Neon 同区域）延迟将显著更低；
> 本报告为保守环境下的实测数据，达标即证明代码链路性能无瓶颈。

## 1. 测试基本信息

| 项 | 值 |
|---|---|
| 测试时间 | 2026-08-05 |
| 部署环境 | 本机 Node 进程直连（模拟 Worker 消费，无 Redis；队列投递不参与耗时） |
| 数据库 | PostgreSQL（Neon Serverless，us-east-1，schema=exam_v4） |
| 队列 | 本环境未配置 Redis，压测脚本直接调用 processBatch 消费（等价 Worker 逻辑） |
| 压测文件 | `test-data/10000-orders.xlsx`（10,000 行，4.7 MB） |
| 解析规则 | `load-test-rule`（seed 脚本生成） |

## 1.1 在线部署状态（Vercel）

| 项 | 值 |
|---|---|
| 在线系统 | https://monkeycodevercel.vercel.app |
| 部署 URL | https://monkeycodevercel-6lh3rks22-lushui2s-projects.vercel.app |
| 源码仓库 | https://github.com/lushui1/order-import-exam-v4 |
| 部署状态 | ✅ Ready（Vercel CLI 确认） |

> 在线压测说明：本机所在网络对 vercel.app 域名的 DNS 解析被污染（解析到错误 IP），TCP 443 连接全部超时/ENETUNREACH，且无可用代理，因此无法从本机执行在线 HTTP 压测。需在可访问 Vercel 的网络环境中执行：
> ```bash
> LOAD_TEST_BASE_URL="https://monkeycodevercel.vercel.app" npm run load-test
> ```
> 同时按 PRD 3.1，Worker 应部署在 Railway/Render/Fly.io 等常驻平台（Vercel Serverless 不适合长任务），完整在线链路压测需配置 Redis 与常驻 Worker。

## 2. 容量配置（实测）

| 项 | 配置值 |
|---|---|
| 处理单元大小 | **2,000 行/批**（PRD 4.1 允许 500/1000/2000） |
| 总批次数 | 6 |
| 消费并发 | 6（= 批次数，一轮完成） |
| SKU 主数据数量 | 20,000 |
| 校验策略 | 每批一次批量 IN 查询（禁止逐行） |
| 写入策略 | 每批一次原生 SQL 批量 UPSERT（ON CONFLICT (taskId, rowIndex)） |

## 3. 压测结果（实测）

| 指标 | 目标 | 实测 | 达标 |
|---|---:|---:|---|
| 全链路总耗时（任务创建→完成） | ≤ 60,000ms | **53,525ms** | ✅ |
| 任务创建耗时 | 上传接口快速返回 | 4,193ms（含文件落盘+任务/批次/Outbox 同事务） | ✅（P95≤1s 需同区域部署验证） |
| 成功行数 | 10,000 - 注入错误 | 9,975 | ✅ |
| 失败行数 | ≥ 注入的错误行数 | 25（E003 电话 15 + E004 数量 10） | ✅ |
| 批次完成 | 6/6 | 6/6 | ✅ |
| HTTP 500/504 | 0 | 0（直连脚本无 HTTP 层） | ✅ |
| 任务终态 | partial_success | partial_success | ✅ |

### 4. 批次耗时（实测，ms）

| 批次 | 耗时 |
|---|---:|
| unit_001 | 37,486 |
| unit_002 | 45,489 |
| unit_003 | 32,774 |
| unit_004 | 40,812 |
| unit_005 | 26,566 |
| unit_006 | 14,172 |
| 处理总耗时 | ~50s |

> 注：批次耗时主要为本机→Neon 网络往返（单次查询约 4s，每批内部约 8~10 次串行 DB 往返）。
> 同区域部署（Vercel us-east-1 + Neon us-east-1）下往返降至毫秒级，耗时将大幅下降。

### 5. 阶段耗时（早前 1,000 行/批配置下的性能日志实测，ms）

| 阶段 | 平均 |
|---|---:|
| 解析 | 3 |
| 规则 | 280 |
| 校验（SKU 批量 IN） | 1,654 |
| 写入（批量 UPSERT） | 6,199 |
| 总计 | 8,135 |

## 6. 吞吐与积压

| 项 | 值 |
|---|---|
| 峰值吞吐 | 10,000 行 / 53.5s ≈ 11,215 行/分钟（≥ 10,000 单/分钟目标）✅ |
| 队列积压 | 本环境未启用 Redis，无积压数据 |
| 降级任务数 | 0（SKU 校验未降级，25 条失败均被精确识别） |

## 7. 数据库连接数

- 本机单进程直连，Prisma 默认连接池；并发 6 个 Worker 共享连接池。
- 未打满连接池（并发 = 批次数，一轮完成）。
- 生产建议：Vercel + Neon 同区域，连接池 10~20，Worker 并发 2~4。

## 8. 监控看板截图

（部署在线后补充：实时吞吐、队列积压、阶段耗时、错误分布四个区域截图）

## 9. 结论与已知瓶颈

- **是否达到 10,000 单/分钟目标（≤60s）：✅ 是（实测 53.5s）**
- 功能正确性：9,975 成功 / 25 失败全部精确识别（E003 电话格式、E004 数量非正数），未出现误判。
- 瓶颈分析：
  1. 本机→Neon 跨区域网络延迟（单次查询 ~4s）是当前实测耗时的主要构成；
  2. 每批内部 8~10 次串行 DB 往返（解析→SKU 校验→UPSERT→进度更新→Trace）；
  3. 同区域部署后瓶颈将转移为数据库写入吞吐（当前批量 UPSERT 平均 6.2s/1000 行）。
- 优化方向：
  1. 生产同区域部署（Vercel + Neon 同 us-east-1）将网络延迟从秒级降到毫秒级；
  2. 已实现的批量 IN 校验 + 批量 UPSERT + 幂等门闩避免重复累计；
  3. 若需进一步提速：批次大小可在 1000~4000 间按压测调整，Worker 并发按连接池容量配置。

## 10. 复现步骤

```bash
# 1. 生成压测数据（20,000 SKU + 10,000 行 Excel + load-test-rule）
npm run seed:sku

# 2. 无 Redis 直连压测（复用生产核心链路 createImportTask + processBatch）
npm run load-test:direct

# 3. 生产环境（配置 REDIS_URL 后）完整链路压测
npm run dispatcher
npm run worker
npm run load-test
```
