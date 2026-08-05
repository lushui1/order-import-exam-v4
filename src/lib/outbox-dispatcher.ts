/**
 * Outbox Dispatcher（PRD 模块三）
 * 轮询 event_outbox，将批次事件投递到队列：
 * - 状态流转 pending → sent / failed
 * - 投递失败重试并记录 retry_count，指数退避
 * - 使用 SELECT ... FOR UPDATE SKIP LOCKED 防止多 Dispatcher 并发领取同一条
 * - 服务宕机恢复后继续投递（pending/failed 且 next_retry_at <= now 都会被重新领取）
 */
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { enqueueBatchJob } from '@/lib/queue';
import { recordTrace } from '@/lib/trace';
import { DB_SCHEMA } from '@/lib/config';

// 最大投递重试次数
const MAX_DISPATCH_RETRY = 5;
// 每次轮询领取条数
const CLAIM_BATCH = 50;
// 重试退避（秒）：1, 5, 30, 120, 600
const RETRY_BACKOFF_SECONDS = [1, 5, 30, 120, 600];

export interface DispatchResult {
  claimed: number;
  sent: number;
  failed: number;
}

/**
 * 领取一条 Outbox 记录（单条原子 SQL，兼容 Neon pgbouncer，不支持交互式事务）
 * - 行锁 + SKIP LOCKED 防止多 Dispatcher 并发领取同一条
 * - 领取后置为 dispatching 并设置 60 秒可重领窗口（next_retry_at）
 * - 若 Dispatcher 崩溃，60 秒后该记录可被重新领取（宕机恢复，PRD 模块三）
 */
async function claimOne(): Promise<{ id: string } | null> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "${Prisma.raw(DB_SCHEMA)}"."event_outbox"
    SET "status" = 'dispatching', "next_retry_at" = NOW() + INTERVAL '60 seconds'
    WHERE "id" = (
      SELECT "id" FROM "${Prisma.raw(DB_SCHEMA)}"."event_outbox"
      WHERE ("status" IN ('pending', 'failed') AND ("next_retry_at" IS NULL OR "next_retry_at" <= NOW()))
         OR ("status" = 'dispatching' AND "next_retry_at" <= NOW())
      ORDER BY "created_at" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id"
  `;
  if (rows.length === 0) return null;
  return { id: rows[0].id };
}

/**
 * 执行一轮投递：领取 → 入队 → 更新状态
 */
export async function dispatchOnce(maxClaim = CLAIM_BATCH): Promise<DispatchResult> {
  const result: DispatchResult = { claimed: 0, sent: 0, failed: 0 };

  for (let i = 0; i < maxClaim; i++) {
    const claimed = await claimOne();
    if (!claimed) break;
    result.claimed++;

    const outbox = await prisma.eventOutbox.findUnique({ where: { id: claimed.id } });
    if (!outbox) continue;

    const payload = (outbox.payload as { task_id?: string; unit_id?: string; batch_index?: number; start_row?: number; end_row?: number }) || {};

    try {
      // 投递到队列（Worker 幂等，重复投递安全）
      await enqueueBatchJob({
        taskId: payload.task_id || outbox.aggregateId,
        traceId: outbox.traceId || '',
        unitId: payload.unit_id || '',
        batchIndex: payload.batch_index ?? 0,
        fileKey: '',
        ruleId: null,
        ruleJson: null,
        startRow: payload.start_row ?? 0,
        endRow: payload.end_row ?? 0,
      });

      await prisma.eventOutbox.update({
        where: { id: outbox.id },
        data: { status: 'sent', sentAt: new Date(), lastError: null },
      });
      result.sent++;
    } catch (err: any) {
      const nextRetry = outbox.retryCount + 1;
      const lastError = err?.message || '投递失败';

      if (nextRetry > MAX_DISPATCH_RETRY) {
        // 超过最大重试：标记 failed，记录告警 Trace
        await prisma.eventOutbox.update({
          where: { id: outbox.id },
          data: {
            status: 'failed',
            retryCount: nextRetry,
            lastError,
          },
        });
        await recordTrace({
          traceId: outbox.traceId || '',
          taskId: outbox.aggregateId,
          eventName: 'OutboxDispatchFailed',
          eventStatus: 'error',
          message: `Outbox ${outbox.eventType} 投递失败超过 ${MAX_DISPATCH_RETRY} 次: ${lastError}`,
        });
        result.failed++;
      } else {
        const delay = RETRY_BACKOFF_SECONDS[Math.min(nextRetry - 1, RETRY_BACKOFF_SECONDS.length - 1)] ?? 60;
        await prisma.eventOutbox.update({
          where: { id: outbox.id },
          data: {
            status: 'failed',
            retryCount: nextRetry,
            lastError,
            nextRetryAt: new Date(Date.now() + delay * 1000),
          },
        });
      }
    }
  }

  return result;
}

// 队列积压深度（监控用）：等待处理的批次行数
export async function queueBacklogRows(): Promise<number> {
  const pendingBatches = await prisma.importTaskBatch.count({
    where: { status: { in: ['pending', 'processing'] } },
  });
  return pendingBatches;
}

// ── 卡死恢复（PRD 4.4 风险表 / 考点3：卡死恢复） ──
// Worker 崩溃或 Job 长时间无进展时，将 processing 超过阈值的批次恢复为 pending 重新投递；
// 超过最大恢复次数的批次标记 failed，避免无限循环。

// 批次 processing 卡死阈值：5 分钟无进展视为卡死
const STALE_BATCH_TIMEOUT_MS = 5 * 60 * 1000;
// 单批次最大恢复次数，超过则标记 failed
const MAX_RECOVER_RETRY = 3;

/**
 * 扫描并恢复卡死批次：
 * - status=processing 且 locked_at 超过 STALE_BATCH_TIMEOUT_MS → 恢复为 pending（retry_count+1）
 * - retry_count 超过 MAX_RECOVER_RETRY → 标记 failed 并写 Trace
 * @returns 恢复/失败的批次数量
 */
export async function recoverStaleBatches(): Promise<number> {
  const staleThreshold = new Date(Date.now() - STALE_BATCH_TIMEOUT_MS);

  const staleBatches = await prisma.importTaskBatch.findMany({
    where: {
      status: 'processing',
      lockedAt: { lt: staleThreshold },
    },
    select: { id: true, taskId: true, unitId: true, batchIndex: true, retryCount: true },
  });

  let handled = 0;
  for (const batch of staleBatches) {
    const task = await prisma.importTask.findUnique({
      where: { id: batch.taskId },
      select: { traceId: true },
    });

    if (batch.retryCount >= MAX_RECOVER_RETRY) {
      // 超过最大恢复次数 → 标记 failed（PRD 状态规则：全部处理单元失败 → failed）
      await prisma.importTaskBatch.update({
        where: { id: batch.id },
        data: { status: 'failed', lastError: `批次卡死超过 ${MAX_RECOVER_RETRY} 次，标记失败` },
      });
      await recordTrace({
        traceId: task?.traceId || '',
        taskId: batch.taskId,
        unitId: batch.unitId,
        eventName: 'ImportBatchFailed',
        eventStatus: 'error',
        message: `批次 ${batch.unitId} 卡死超过 ${MAX_RECOVER_RETRY} 次，标记失败（卡死恢复）`,
      });
    } else {
      // 恢复为 pending，等待 Dispatcher 重新投递
      await prisma.importTaskBatch.update({
        where: { id: batch.id },
        data: {
          status: 'pending',
          retryCount: { increment: 1 },
          lockedAt: null,
          lastError: `批次处理超时（>${STALE_BATCH_TIMEOUT_MS / 1000}s），已恢复待重投`,
        },
      });
      await recordTrace({
        traceId: task?.traceId || '',
        taskId: batch.taskId,
        unitId: batch.unitId,
        eventName: 'ImportBatchRecovered',
        eventStatus: 'warn',
        message: `批次 ${batch.unitId} 卡死恢复，重试第 ${batch.retryCount + 1} 次`,
      });
    }
    handled++;
  }

  return handled;
}
