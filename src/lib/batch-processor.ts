/**
 * Worker 批次处理器（PRD 模块四五六）
 * 消费单个处理单元（batch）Job，必须完成：
 * 1. 幂等：已完成批次直接返回；同一 task_id+unit_id 不重复写库、不重复累计进度
 * 2. 复用 V2 规则引擎 executeParse 解析数据
 * 3. 收集 SKU 批量查询 sku_master（禁止逐行查询）
 * 4. 结构化校验（必填/电话/数量/重复外部编码）→ 错误码 E001-E008
 * 5. 成功行批量 UPSERT（基于 task_id+row_index 稳定键）
 * 6. 失败行写入 import_task_errors（敏感字段脱敏）
 * 7. 写入 batch_performance_log（解析/规则/校验/写入耗时）
 * 8. 原子更新 import_tasks 进度，全部批次完成后置任务终态
 * 9. SKU 校验降级：主数据查询超时/失败时进入降级模式（PRD 模块十）
 */
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { readStoredFile } from '@/lib/storage';
import { executeParse, ParseRule, ParsedRow } from '@/lib/rule-engine/engine';
import { validateOrderRowDetail, FieldError } from '@/lib/rule-engine/validation';
import { maskValue } from '@/lib/masking';
import { recordTrace } from '@/lib/trace';
import { SKU_VALIDATE_TIMEOUT_MS, DB_SCHEMA } from '@/lib/config';
import { BatchJobData } from '@/lib/queue';
import { BATCH_SIZE } from '@/lib/import-task-service';

// 内存缓存解析结果（同一 task 的批次共享，避免重复解析整文件）
// 缓存 Promise 而非结果：并发批次同时到达时共享同一个解析任务，避免解析竞态
const parseCache = new Map<string, Promise<ParsedRow[]>>();

function getRule(ruleJson: string | null): ParseRule | null {
  if (!ruleJson) return null;
  try {
    return JSON.parse(ruleJson) as ParseRule;
  } catch {
    return null;
  }
}

// 批量校验 SKU：每批一次 IN 查询（PRD 4.1 允许批量 IN 查询策略），
// 超时/失败进入降级模式（PRD 模块十）。不采用全量缓存——Neon 高延迟下全量加载 68s 反而拖慢首批。
async function batchLoadSkuMap(
  skuCodes: string[],
  traceId: string,
  taskId: string
): Promise<{ map: Map<string, boolean>; degraded: boolean; reason?: string }> {
  const uniqueCodes = [...new Set(skuCodes.filter(c => c))];
  if (uniqueCodes.length === 0) return { map: new Map(), degraded: false };

  try {
    // 批量 IN 查询（一次往返），超时用 Promise.race 实现真实降级
    // 注意：$queryRaw tagged template 中 schema 名必须用 Prisma.raw 注入，否则被当作参数绑定
    const queryPromise = prisma.$queryRaw<{ sku_code: string }[]>`
      SELECT sku_code FROM "${Prisma.raw(DB_SCHEMA)}"."sku_master" WHERE sku_code IN (${Prisma.join(uniqueCodes)})
    `;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`SKU 主数据查询超时（${SKU_VALIDATE_TIMEOUT_MS}ms）`)), SKU_VALIDATE_TIMEOUT_MS)
    );
    const masters = await Promise.race([queryPromise, timeoutPromise]);

    const map = new Map<string, boolean>();
    for (const m of masters) map.set(m.sku_code, true);
    return { map, degraded: false };
  } catch (err: any) {
    // 查询超时/失败 → 降级模式（PRD 模块十）
    await recordTrace({
      traceId,
      taskId,
      eventName: 'SkuValidationDegraded',
      eventStatus: 'warn',
      message: `SKU 主数据查询失败，进入降级模式: ${err?.message || '未知错误'}`,
    });
    return { map: new Map(), degraded: true, reason: err?.message || 'SKU 主数据查询失败' };
  }
}

/**
 * 处理单个批次。幂等保证：
 * - 批次状态为 completed 时直接返回（快速幂等）
 * - 通过 UPDATE ... WHERE status='pending' 原子抢占，仅抢占者执行
 */
export async function processBatch(job: BatchJobData): Promise<void> {
  const { taskId, traceId, unitId, batchIndex, fileKey, ruleJson } = job;

  // 原子抢占 + 幂等检查合并为一次 updateMany（正常路径省 1 次 DB 往返）：
  // - 批次不存在：updateMany 影响 0 行，再查一次确认
  // - 已完成批次：updateMany 影响 0 行，快速幂等返回
  // - 其他实例处理中：updateMany 影响 0 行，跳过
  const claimed = await prisma.importTaskBatch.updateMany({
    where: { taskId, unitId, status: 'pending' },
    data: { status: 'processing', lockedAt: new Date() },
  });
  if (claimed.count === 0) {
    const existing = await prisma.importTaskBatch.findUnique({
      where: { taskId_unitId: { taskId, unitId } },
      select: { status: true },
    });
    if (!existing) {
      throw new Error(`批次不存在: ${taskId}/${unitId}`);
    }
    if (existing.status === 'completed') {
      console.log(`[Worker] ${taskId}/${unitId} 已处理，幂等返回`);
      return;
    }
    console.log(`[Worker] ${taskId}/${unitId} 被其他实例处理中，跳过`);
    return;
  }

  const task = await prisma.importTask.findUnique({ where: { id: taskId } });
  if (!task) throw new Error(`任务不存在: ${taskId}`);

  // 任务级幂等：首个批次抢占成功后记录 started_at 并将任务置为 processing
  // （updateMany 条件 startedAt: null，并发批次仅首个能写入；
  //   PRD 状态机 pending→processing→终态，吞吐/已用时间基于 started_at 计算真实处理耗时）
  await prisma.importTask.updateMany({
    where: { id: taskId, startedAt: null },
    data: { startedAt: new Date(), status: 'processing' },
  });

  const t0 = Date.now();
  try {
    // ── 阶段1: 文件解析（读文件） ──
    const tParseStart = Date.now();
    // 优先使用任务表中保存的文件内容（Vercel Serverless /tmp 不共享，跨实例需从 DB 读，PRD 3.1）
    let buffer: Buffer;
    if (task.fileData && task.fileData.length > 0) {
      buffer = Buffer.from(task.fileData);
    } else {
      buffer = await readStoredFile(fileKey || task.fileKey);
    }
    const tReadEnd = Date.now();
    const parseDurationMs = tReadEnd - tParseStart;

    // ── 阶段2: 规则引擎（含解析器，复用 V2 规则引擎） ──
    const tRuleStart = Date.now();
    let rows: ParsedRow[];
    let cached = parseCache.get(taskId);
    if (!cached) {
      // 规则从任务关联读取（PRD 模块四：根据 task_id 读取待处理数据，不依赖 Job 负载）
      const parsePromise = (async () => {
        let ruleJsonStr = ruleJson;
        if (!ruleJsonStr && task.ruleId) {
          const ruleRec = await prisma.parseRule.findUnique({ where: { id: task.ruleId } });
          ruleJsonStr = ruleRec?.ruleJson || null;
        }
        const rule = getRule(ruleJsonStr);
        if (!rule) throw new Error('解析规则无效');
        return executeParse(buffer, task.fileName, rule);
      })();
      // 先写入缓存再 await：并发批次共享同一个解析 Promise，避免重复解析
      parseCache.set(taskId, parsePromise);
      cached = parsePromise;
    }
    rows = await cached;
    const tRuleEnd = Date.now();
    const ruleDurationMs = tRuleEnd - tRuleStart;

    // 取出本批次行：按处理单元索引切片实际解析行（PRD 4.1 动态批次，
    // 不依赖预扫描行号，避免 docx/pdf 预扫描为 0 时丢数据）
    // 最后一个批次处理到文件末尾，吸收预扫描行数偏差导致的多余行
    const isLastBatch = batchIndex >= task.totalBatches - 1;
    const batchRows = isLastBatch
      ? rows.slice(batchIndex * BATCH_SIZE)
      : rows.slice(batchIndex * BATCH_SIZE, (batchIndex + 1) * BATCH_SIZE);

    // ── 阶段3: 批量 SKU 校验 + 结构化校验 ──
    const tValidateStart = Date.now();
    const skuCodes = batchRows.map(r => r.data.skuCode || '');
    const { map: skuMap, degraded, reason } = await batchLoadSkuMap(skuCodes, traceId, taskId);

    // 校验分类（纯函数，可单测）：成功行 / 失败行（含 E001/E005 及字段级错误）
    const { successRows, rowErrors } = classifyRows(batchRows, skuMap, degraded);
    const tValidateEnd = Date.now();
    const validateDurationMs = tValidateEnd - tValidateStart;

    // ── 阶段4: 失败行写错误表 + 成功行批量 UPSERT ──
    const tInsertStart = Date.now();

    // 失败行写入 import_task_errors（敏感字段脱敏）
    const errorRecords = Object.entries(rowErrors).flatMap(([rowNum, errors]) =>
      errors.map(e => ({
        taskId,
        unitId,
        batchIndex,
        rowNumber: Number(rowNum),
        fieldName: e.fieldName,
        rawValue: maskValue(e.fieldName, batchRows.find(r => r.rowIndex === Number(rowNum))?.data?.[e.fieldName] || ''),
        errorCode: e.errorCode,
        errorReason: e.errorReason,
        traceId,
      }))
    );
    if (errorRecords.length > 0) {
      await prisma.importTaskError.createMany({ data: errorRecords });
    }

    // 成功行批量 UPSERT（基于 task_id + row_index 幂等键，重复消费不重复写入）
    if (successRows.length > 0) {
      await upsertOrders(task.importId, taskId, successRows);
    }

    const tInsertEnd = Date.now();
    const insertDurationMs = tInsertEnd - tInsertStart;
    const totalDurationMs = tInsertEnd - t0;

    // ── 阶段5: 性能日志 + 原子更新进度 + 批次完成 ──
    // 使用幂等门闩（updateMany 条件更新）替代交互式事务（Neon pgbouncer 不支持 $transaction(async)，P2028）
    // 幂等保证：仅 processing→completed 成功的执行者累计进度，重复消费不重复累计
    await prisma.batchPerformanceLog.create({
      data: {
        taskId,
        unitId,
        batchIndex,
        parseDurationMs,
        ruleDurationMs,
        validateDurationMs,
        insertDurationMs,
        totalDurationMs,
        status: 'completed',
        traceId,
      },
    });

    // 幂等门闩：原子更新批次状态（仅当前 processing → completed 成功者继续）
    const done = await prisma.importTaskBatch.updateMany({
      where: { taskId, unitId, status: 'processing' },
      data: { status: 'completed', completedAt: new Date() },
    });

    if (done.count > 0) {
      // 仅门闩成功者累计任务进度（避免重复累计）
      const batchSuccess = successRows.length;
      const batchFailed = errorRecords.length;
      await prisma.importTask.update({
        where: { id: taskId },
        data: {
          processedRows: { increment: batchSuccess + batchFailed },
          successRows: { increment: batchSuccess },
          failedRows: { increment: batchFailed },
          completedBatches: { increment: 1 },
        },
      });

      // 检查是否全部批次完成 → 任务终态（一次查询取总数与完成数，省 1 次往返）
      // 注意：import_task_batches 列名为 task_id（schema 有 @map），原生 SQL 需用下划线
      const agg = await prisma.$queryRaw<{ total: bigint; done: bigint }[]>`
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE status = 'completed') AS done
        FROM "${Prisma.raw(DB_SCHEMA)}"."import_task_batches"
        WHERE "task_id" = ${taskId}
      `;
      const batchCount = Number(agg[0]?.total ?? 0);
      const completedCount = Number(agg[0]?.done ?? 0);
      if (completedCount >= batchCount) {
        const taskState = await prisma.importTask.findUnique({ where: { id: taskId } });
        if (taskState) {
          const finalStatus = taskState.failedRows > 0 ? 'partial_success' : 'completed';
          await prisma.importTask.update({
            where: { id: taskId },
            data: { status: finalStatus, completedAt: new Date() },
          });
          // 任务终态：释放解析缓存，避免常驻 Worker 内存泄漏
          parseCache.delete(taskId);
          await prisma.traceEvent.create({
            data: {
              traceId,
              taskId,
              unitId,
              eventName: finalStatus === 'completed' ? 'ImportTaskCompleted' : 'ImportTaskPartialSuccess',
              eventStatus: 'ok',
              message: `任务结束: 成功 ${taskState.successRows}, 失败 ${taskState.failedRows}`,
              occurredAt: new Date(),
            },
          });
        }
      }
    }

    // 降级标记（不阻断处理）
    if (degraded) {
      await prisma.importTask.update({
        where: { id: taskId },
        data: { degraded: true, degradedReason: reason || 'SKU 主数据查询失败' },
      });
      await recordTrace({
        traceId,
        taskId,
        unitId,
        eventName: 'ImportTaskDegraded',
        eventStatus: 'warn',
        message: `SKU 校验降级: ${reason || '主数据查询失败'}`,
      });
    }

    await recordTrace({
      traceId,
      taskId,
      unitId,
      eventName: 'ImportBatchSucceeded',
      eventStatus: 'ok',
      message: `批次完成: 成功 ${successRows.length}, 失败 ${errorRecords.length}, 耗时 ${totalDurationMs}ms`,
    });

    console.log(`[Worker] ${taskId}/${unitId} 完成: 成功 ${successRows.length} / 失败 ${errorRecords.length} / ${totalDurationMs}ms`);
  } catch (err: any) {
    // 批次失败：回滚状态为 pending（可重试），记录失败
    await prisma.importTaskBatch.updateMany({
      where: { taskId, unitId, status: 'processing' },
      data: {
        status: 'pending',
        lastError: err?.message || '未知错误',
      },
    });
    await recordTrace({
      traceId,
      taskId,
      unitId,
      eventName: 'ImportBatchFailed',
      eventStatus: 'error',
      message: `批次处理失败: ${err?.message || '未知错误'}`,
    });
    throw err; // 交给 BullMQ 重试
  }
}

// 校验分类（纯函数，可单测）：按错误码分类成功行/失败行
// - E001 SKU 不存在（降级模式下跳过）
// - E005 外部编码重复（批内）
// - E002/E003/E004 字段级校验
export function classifyRows(
  rows: ParsedRow[],
  skuMap: Map<string, boolean>,
  degraded: boolean
): { successRows: ParsedRow[]; rowErrors: Record<number, FieldError[]> } {
  const externalCodeSeen = new Map<string, number>();
  const rowErrors: Record<number, FieldError[]> = {};
  const successRows: ParsedRow[] = [];

  for (const row of rows) {
    const fieldErrors = validateOrderRowDetail(row.data);

    // SKU 主数据校验（E001），降级模式下跳过
    if (!degraded && row.data.skuCode && !skuMap.get(row.data.skuCode)) {
      fieldErrors.push({
        fieldName: 'skuCode',
        errorCode: 'E001',
        errorReason: `SKU 不存在: ${row.data.skuCode}`,
      });
    }

    // 重复外部编码（E005）
    if (row.data.externalCode) {
      const seen = externalCodeSeen.get(row.data.externalCode) || 0;
      if (seen > 0) {
        fieldErrors.push({
          fieldName: 'externalCode',
          errorCode: 'E005',
          errorReason: `外部编码重复: ${row.data.externalCode}`,
        });
      }
      externalCodeSeen.set(row.data.externalCode, seen + 1);
    }

    if (fieldErrors.length > 0) {
      rowErrors[row.rowIndex] = fieldErrors;
    } else {
      successRows.push(row);
    }
  }

  return { successRows, rowErrors };
}

// 批量 UPSERT：基于 task_id + row_index 稳定业务键
// 使用原生 SQL 单次 INSERT ... ON CONFLICT DO UPDATE（PRD 考点2：禁止逐行 INSERT，必须批量写入）
// 单条 SQL 一次提交 1000 行，减少 DB 往返（Neon 远程高延迟下往返次数是主要瓶颈）
async function upsertOrders(importId: string | null, taskId: string, rows: ParsedRow[]): Promise<void> {
  if (rows.length === 0) return;
  // orders.importId 为 V2 非空外键，使用任务创建时的兼容占位 Import
  const legacyImportId = importId || '';

  // 字段顺序（与 orders 表列一致，id 由本进程生成）
  const params: unknown[] = [];
  const valueClauses = rows.map((r) => {
    const v = [
      randomUUID(),             // id
      legacyImportId,           // importId
      taskId,                   // taskId
      r.data.externalCode || null,
      r.data.receiverStore || null,
      r.data.receiverName || null,
      r.data.receiverPhone || null,
      r.data.receiverAddress || null,
      r.data.skuCode || '',
      r.data.skuName || '',
      r.data.skuQuantity || '0',
      r.data.skuSpec || null,
      r.data.remark || null,
      r.rowIndex,               // rowIndex
    ];
    const base = params.length;
    params.push(...v);
    return `(${v.map((_, i) => `$${base + i + 1}`).join(', ')})`;
  }).join(', ');

  const sql = `
    INSERT INTO "${DB_SCHEMA}"."orders" (
      "id", "importId", "taskId", "externalCode", "receiverStore", "receiverName",
      "receiverPhone", "receiverAddress", "skuCode", "skuName", "skuQuantity",
      "skuSpec", "remark", "rowIndex"
    )
    VALUES ${valueClauses}
    ON CONFLICT ("taskId", "rowIndex") DO UPDATE SET
      "externalCode" = EXCLUDED."externalCode",
      "receiverStore" = EXCLUDED."receiverStore",
      "receiverName" = EXCLUDED."receiverName",
      "receiverPhone" = EXCLUDED."receiverPhone",
      "receiverAddress" = EXCLUDED."receiverAddress",
      "skuCode" = EXCLUDED."skuCode",
      "skuName" = EXCLUDED."skuName",
      "skuQuantity" = EXCLUDED."skuQuantity",
      "skuSpec" = EXCLUDED."skuSpec",
      "remark" = EXCLUDED."remark"
  `;

  await prisma.$executeRawUnsafe(sql, ...params);
}
