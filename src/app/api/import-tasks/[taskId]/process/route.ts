/**
 * 在线处理端点：POST /api/import-tasks/:taskId/process
 * 无 Redis 环境下的兜底消费：直接复用 Worker 核心链路 processBatch 消费任务的所有 pending 批次，
 * 让线上任务真正跑出进度（PRD 3.1：Worker 可部署为常驻进程；本端点等价于一次手动触发消费）。
 * 生产环境有 Redis 时，由 Dispatcher + Worker 自动消费，本端点仅作演示/兜底。
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { processBatch } from '@/lib/batch-processor';

// Vercel Serverless 函数最大执行时长（Hobby 上限 60s）
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;

    const task = await prisma.importTask.findUnique({
      where: { id: taskId },
      include: { batches: { orderBy: { batchIndex: 'asc' } } },
    });
    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }

    // 终态任务无需处理
    if (['completed', 'partial_success', 'failed'].includes(task.status)) {
      return NextResponse.json({
        task_id: taskId,
        status: task.status,
        message: '任务已结束，无需重复处理',
      });
    }

    // 待处理批次（pending 状态；processing 超时批次由 Dispatcher 卡死恢复处理）
    const pendingBatches = task.batches.filter(b => b.status === 'pending');
    if (pendingBatches.length === 0) {
      return NextResponse.json({
        task_id: taskId,
        status: task.status,
        message: '没有待处理的批次',
      });
    }

    const startedAt = Date.now();
    const results: { unit_id: string; batch_index: number; ok: boolean; error?: string }[] = [];

    // 顺序消费（避免并发打满连接池；Vercel 60s 上限内尽量多处理）
    for (const batch of pendingBatches) {
      try {
        await processBatch({
          taskId: task.id,
          traceId: task.traceId,
          unitId: batch.unitId,
          batchIndex: batch.batchIndex,
          fileKey: task.fileKey,
          ruleId: task.ruleId,
          ruleJson: null, // Worker 从任务关联读取规则
          startRow: batch.startRow,
          endRow: batch.endRow,
        });
        results.push({ unit_id: batch.unitId, batch_index: batch.batchIndex, ok: true });
      } catch (err: any) {
        results.push({ unit_id: batch.unitId, batch_index: batch.batchIndex, ok: false, error: err?.message });
      }
    }

    // 读取处理后最新状态
    const latest = await prisma.importTask.findUnique({
      where: { id: taskId },
      select: {
        status: true,
        processedRows: true,
        successRows: true,
        failedRows: true,
        completedBatches: true,
        totalBatches: true,
        degraded: true,
      },
    });

    return NextResponse.json({
      task_id: taskId,
      processed: results.filter(r => r.ok).length,
      failed_batches: results.filter(r => !r.ok).length,
      elapsed_ms: Date.now() - startedAt,
      task_status: latest?.status,
      processed_rows: latest?.processedRows,
      success_rows: latest?.successRows,
      failed_rows: latest?.failedRows,
      completed_batches: latest?.completedBatches,
      total_batches: latest?.totalBatches,
      degraded: latest?.degraded,
    });
  } catch (error: any) {
    console.error('在线处理任务异常:', error);
    return NextResponse.json({ error: '处理失败，请稍后重试' }, { status: 500 });
  }
}
