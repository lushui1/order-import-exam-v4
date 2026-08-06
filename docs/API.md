# 接口文档（PRD 第八章）

## 8.1 上传接口（上传即返回）

### POST /api/import-tasks

接收文件并创建异步导入任务（任务 + 批次 + Outbox 同事务），≤1s 返回，不等待后台处理。

**请求**：`multipart/form-data`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| file | File | 是 | xlsx/xls/docx/pdf，≤10MB |
| ruleId | string | 否 | 已保存解析规则 ID（缺省时由前端先保存 AI 规则） |

**响应 201**：

```json
{
  "task_id": "task_xxx",
  "trace_id": "trace_xxx",
  "status": "PENDING",
  "total_rows": 10000,
  "total_batches": 6,
  "file_key": "import_tasks/task_xxx.xlsx"
}
```

**错误**：400 缺少文件/格式不支持；413 超过大小限制；500 服务器错误。

---

## 8.2 查询任务进度

### GET /api/import-tasks/:taskId

**响应 200**：

```json
{
  "task_id": "task_123",
  "trace_id": "trace_abc",
  "file_name": "10000-orders.xlsx",
  "status": "PROCESSING",
  "total_rows": 10000,
  "processed_rows": 6000,
  "success_rows": 5988,
  "failed_rows": 12,
  "total_batches": 10,
  "completed_batches": 6,
  "throughput": 1200,
  "estimated_remaining_seconds": 4,
  "degraded": false,
  "degraded_reason": null,
  "error_message": null,
  "created_at": "2026-08-05T10:00:00.000Z",
  "completed_at": null,
  "batches": [
    {
      "unit_id": "unit_001",
      "batch_index": 0,
      "status": "COMPLETED",
      "retry_count": 0,
      "start_row": 1,
      "end_row": 2000,
      "completed_at": "2026-08-05T10:00:03.000Z"
    }
  ],
  "recent_errors": [
    { "row": 101, "code": "E001", "reason": "SKU 不存在: SKU_99999_00001" }
  ]
}
```

**错误**：404 任务不存在。

---

## 8.3 查询错误明细

### GET /api/import-tasks/:taskId/errors

**查询参数**：

| 参数 | 说明 |
|---|---|
| batch | 批次号筛选 |
| error_code | 错误码筛选（E001~E008） |
| page | 页码（默认 1） |
| page_size | 每页条数（默认 50，最大 100） |

**响应 200**：

```json
{
  "task_id": "task_123",
  "errors": [
    {
      "id": "cmx_xxx",
      "unit_id": "unit_001",
      "batch_index": 0,
      "row_number": 101,
      "field_name": "skuCode",
      "raw_value": "SKU_99999_00001",
      "error_code": "E001",
      "error_reason": "SKU 不存在: SKU_99999_00001",
      "trace_id": "trace_abc",
      "created_at": "2026-08-05T10:00:03.000Z"
    }
  ],
  "total": 12,
  "page": 1,
  "page_size": 50,
  "total_pages": 1
}
```

> `raw_value` 对手机号/姓名/地址已脱敏（138****5678）。

---

## 8.4 查询批次性能

### GET /api/import-tasks/:taskId/batches

**响应 200**：批次列表，每个批次含 `performance`（parse/rule/validate/insert/total 各阶段耗时 ms）。

---

## 8.4b 手动触发消费（无 Worker 环境兜底）

### POST /api/import-tasks/:taskId/process

直接复用 Worker 核心链路 `processBatch` 消费任务所有 pending 批次（无需 Redis）。
生产环境由 Dispatcher + Worker 自动消费；本端点用于无常驻 Worker 环境的演示/兜底，幂等安全。

**响应 200**：

```json
{
  "task_id": "task_xxx",
  "processed": 6,
  "failed_batches": 0,
  "task_status": "partial_success",
  "processed_rows": 10000,
  "success_rows": 9950,
  "failed_rows": 50,
  "completed_batches": 6,
  "total_batches": 6,
  "degraded": false
}
```

> 前端任务页进入时自动调用一次本端点（自动触发消费），任务完成后停止轮询与计时。

---

## 8.5 Trace 搜索

### GET /api/traces/:traceId

支持传入 `trace_id` 或 `task_id`（task_id 会自动反查 trace_id）。

**响应 200**：按时间升序的全链路事件时间线（ImportTaskCreated → ImportBatchSucceeded → ImportTaskCompleted 等）。

---

## 8.6 监控聚合

### GET /api/import-monitor/summary

**响应 200**：

```json
{
  "throughput_per_minute": [{ "minute": "10:00", "rows": 2000 }],
  "queue_backlog_rows": 4,
  "queue_backlog_warning": false,
  "stage_duration_ms": {
    "parse": { "p50": 120, "p95": 300, "p99": 500 },
    "rule": { "p50": 80, "p95": 200, "p99": 400 },
    "validate": { "p50": 15, "p95": 40, "p99": 80 },
    "insert": { "p50": 900, "p95": 1500, "p99": 2200 },
    "total": { "p50": 1200, "p95": 2100, "p99": 3200 }
  },
  "error_distribution": [{ "error_code": "E001", "count": 20 }],
  "task_distribution": [{ "status": "partial_success", "count": 1 }],
  "slow_batches_top10": [{ "task_id": "task_x", "unit_id": "unit_001", "batch_index": 0, "total_duration_ms": 3200 }],
  "degraded_tasks": 0
}
```

---

## 错误码对照（PRD 模块六）

| 错误码 | 含义 |
|---|---|
| E001 | SKU 不存在 |
| E002 | 必填字段缺失 |
| E003 | 电话格式错误 |
| E004 | 数量不是正数 |
| E005 | 外部编码重复 |
| E006 | 规则映射失败 |
| E007 | 数据库写入失败 |
| E008 | 文件格式不支持 |
