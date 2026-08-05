/**
 * PRD 8.2 查询任务进度：GET /api/import-tasks/:taskId
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const task = await prisma.importTask.findUnique({
      where: { id: taskId },
      include: {
        batches: {
          select: {
            unitId: true,
            batchIndex: true,
            status: true,
            retryCount: true,
            startRow: true,
            endRow: true,
            completedAt: true,
          },
          orderBy: { batchIndex: 'asc' },
        },
        errors: {
          select: { errorCode: true, errorReason: true, rowNumber: true },
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }

    // 吞吐量（行/分钟）：基于 completedAt 与 processedRows 估算
    const elapsedMs = task.completedAt
      ? task.completedAt.getTime() - task.createdAt.getTime()
      : Date.now() - task.createdAt.getTime();
    const throughput = elapsedMs > 0
      ? Math.round((task.processedRows / Math.max(elapsedMs / 60000, 0.01)))
      : 0;
    const estimatedRemainingSeconds = task.status === 'processing' && throughput > 0
      ? Math.max(0, Math.ceil((task.totalRows - task.processedRows) / (throughput / 60)))
      : 0;

    return NextResponse.json({
      task_id: task.id,
      trace_id: task.traceId,
      file_name: task.fileName,
      status: task.status.toUpperCase(),
      total_rows: task.totalRows,
      processed_rows: task.processedRows,
      success_rows: task.successRows,
      failed_rows: task.failedRows,
      total_batches: task.totalBatches,
      completed_batches: task.completedBatches,
      throughput,
      estimated_remaining_seconds: estimatedRemainingSeconds,
      degraded: task.degraded,
      degraded_reason: task.degradedReason,
      error_message: task.errorMessage,
      created_at: task.createdAt.toISOString(),
      completed_at: task.completedAt?.toISOString() || null,
      batches: task.batches.map(b => ({
        unit_id: b.unitId,
        batch_index: b.batchIndex,
        status: b.status.toUpperCase(),
        retry_count: b.retryCount,
        start_row: b.startRow,
        end_row: b.endRow,
        completed_at: b.completedAt?.toISOString() || null,
      })),
      recent_errors: task.errors.map(e => ({
        row: e.rowNumber,
        code: e.errorCode,
        reason: e.errorReason,
      })),
    });
  } catch (error: any) {
    console.error('查询任务进度异常:', error);
    return NextResponse.json({ error: '服务器内部错误，请稍后重试' }, { status: 500 });
  }
}
