/**
 * PRD 8.4 查询批次性能：GET /api/import-tasks/:taskId/batches
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
      select: { id: true, traceId: true },
    });
    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }

    const batches = await prisma.importTaskBatch.findMany({
      where: { taskId },
      orderBy: { batchIndex: 'asc' },
    });

    const perfLogs = await prisma.batchPerformanceLog.findMany({
      where: { taskId },
      orderBy: { batchIndex: 'asc' },
    });

    return NextResponse.json({
      task_id: taskId,
      batches: batches.map(b => {
        const log = perfLogs.find(p => p.batchIndex === b.batchIndex);
        return {
          unit_id: b.unitId,
          batch_index: b.batchIndex,
          start_row: b.startRow,
          end_row: b.endRow,
          status: b.status.toUpperCase(),
          retry_count: b.retryCount,
          last_error: b.lastError,
          locked_at: b.lockedAt?.toISOString() || null,
          completed_at: b.completedAt?.toISOString() || null,
          performance: log ? {
            parse_duration_ms: log.parseDurationMs,
            rule_duration_ms: log.ruleDurationMs,
            validate_duration_ms: log.validateDurationMs,
            insert_duration_ms: log.insertDurationMs,
            total_duration_ms: log.totalDurationMs,
          } : null,
        };
      }),
    });
  } catch (error: any) {
    console.error('查询批次性能异常:', error);
    return NextResponse.json({ error: '服务器内部错误，请稍后重试' }, { status: 500 });
  }
}
