/**
 * 导入任务服务（PRD 模块二 + 模块三 + 8.1）
 * 上传即返回：创建 import_tasks + import_task_batches + event_outbox，同一事务完成
 */
import { prisma } from '@/lib/db';
import { randomUUID } from 'crypto';
import { newTraceId } from '@/lib/trace';
import { buildEvent } from '@/lib/events';
import { saveFile, StoredFile } from '@/lib/storage';

// 处理单元大小：2000 行/批（PRD 4.1 明确允许 500/1000/2000；
// 本环境本机→Neon 单次往返约 4s，增大批次可减少批次数量与固定往返成本；容量推导见 docs/ASSUMPTIONS.md）
export const BATCH_SIZE = 2000;

export interface BatchUnit {
  unitId: string;
  batchIndex: number;
  startRow: number;
  endRow: number;
}

// 按处理单元划分（纯函数，可单测）：unit_001, unit_002, ...
export function splitBatches(totalRows: number, batchSize = BATCH_SIZE): BatchUnit[] {
  const safeTotal = Math.max(totalRows, 0);
  if (safeTotal === 0) return [{ unitId: 'unit_001', batchIndex: 0, startRow: 1, endRow: 0 }];
  const count = Math.ceil(safeTotal / batchSize);
  return Array.from({ length: count }, (_, i) => ({
    unitId: `unit_${String(i + 1).padStart(3, '0')}`,
    batchIndex: i,
    startRow: i * batchSize + 1,
    endRow: Math.min((i + 1) * batchSize, safeTotal),
  }));
}

export interface CreateTaskResult {
  task_id: string;
  trace_id: string;
  status: string;
  total_rows: number;
  total_batches: number;
  file_key: string;
}

/**
 * 创建导入任务：
 * 1. 保存原始文件到存储，得到可复读引用 file_key
 * 2. 按 BATCH_SIZE 划分处理单元
 * 3. 同一数据库事务内写入 import_tasks + import_task_batches + event_outbox
 */
export async function createImportTask(
  fileName: string,
  buffer: Buffer,
  ruleId: string | null,
  estimatedTotalRows: number
): Promise<CreateTaskResult> {
  const traceId = newTraceId();
  const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // 1. 保存原始文件（先于事务，文件系统不属于 DB 事务）
  const ext = fileName.toLowerCase().split('.').pop() || 'bin';
  const fileKey = `import_tasks/${taskId}.${ext}`;
  const stored: StoredFile = await saveFile(fileKey, buffer);

  // 2. 划分处理单元（复用纯函数 splitBatches，保证单测与生产一致）
  const totalRows = Math.max(estimatedTotalRows, 0);
  const batches = splitBatches(totalRows, BATCH_SIZE);
  const totalBatches = batches.length;

  // 3. 同一事务：任务 + 批次 + Outbox（PRD 模块三：任务创建与 Outbox 写入同一事务）
  // 使用数组事务（Neon pgbouncer 不支持交互式事务 async callback，P2028）
  // 兼容 V2 的 Import 占位 id 需预生成（数组事务无法在中间取返回值）
  const legacyImportId = randomUUID();

  // Outbox 事件预构建
  const outboxEvents = batches.map(b =>
    buildEvent(
      'ImportBatchCreated',
      taskId,
      traceId,
      {
        task_id: taskId,
        unit_id: b.unitId,
        batch_index: b.batchIndex,
        start_row: b.startRow,
        end_row: b.endRow,
      }
    )
  );

  await prisma.$transaction([
    // 兼容 V2：Import 占位记录，作为 orders.importId 外键目标
    prisma.import.create({
      data: {
        id: legacyImportId,
        fileName,
        ruleId,
        status: 'parsing',
        totalRows,
        errorRows: 0,
      },
    }),
    prisma.importTask.create({
      data: {
        id: taskId,
        fileName,
        fileKey: stored.key,
        ruleId,
        importId: legacyImportId,
        status: 'pending',
        totalRows,
        totalBatches,
        traceId,
        createdAt: new Date(),
      },
    }),
    prisma.importTaskBatch.createMany({
      data: batches.map(b => ({
        taskId,
        unitId: b.unitId,
        batchIndex: b.batchIndex,
        startRow: b.startRow,
        endRow: b.endRow,
        status: 'pending',
        retryCount: 0,
      })),
    }),
    // Outbox：每个处理单元一个 ImportBatchCreated 事件（同事务，宕机后可恢复投递）
    // 使用 createMany 批量写入，避免逐条 create 造成的 N 次往返耗时
    prisma.eventOutbox.createMany({
      data: outboxEvents.map(event => ({
        eventId: event.event_id,
        eventType: event.event_type,
        schemaVersion: event.schema_version,
        aggregateId: event.aggregate_id,
        traceId: event.trace_id,
        payload: event.payload as object,
        status: 'pending',
        createdAt: new Date(event.occurred_at),
      })),
    }),
    // Trace：任务创建事件
    prisma.traceEvent.create({
      data: {
        traceId,
        taskId,
        eventName: 'ImportTaskCreated',
        eventStatus: 'ok',
        message: `任务创建，共 ${totalBatches} 个处理单元`,
        occurredAt: new Date(),
      },
    }),
  ]);

  return {
    task_id: taskId,
    trace_id: traceId,
    status: 'PENDING',
    total_rows: totalRows,
    total_batches: totalBatches,
    file_key: stored.key,
  };
}
