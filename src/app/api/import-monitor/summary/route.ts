/**
 * PRD 8.6 监控聚合：GET /api/import-monitor/summary
 * 返回：实时吞吐（近5分钟）、队列积压、阶段耗时分布（P50/P95/P99）、错误类型分布
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { queueBacklogRows } from '@/lib/outbox-dispatcher';

export async function GET(req: NextRequest) {
  try {
    const now = new Date();
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);

    // ── 1. 实时吞吐：近5分钟每分钟成功入库行数 ──
    const completedTasks = await prisma.importTask.findMany({
      where: { completedAt: { gte: fiveMinAgo } },
      select: { successRows: true, completedAt: true },
    });
    const perMinute = Array.from({ length: 5 }, (_, i) => {
      const start = new Date(now.getTime() - (5 - i) * 60 * 1000);
      const end = new Date(now.getTime() - (4 - i) * 60 * 1000);
      const rows = completedTasks
        .filter(t => t.completedAt && t.completedAt >= start && t.completedAt < end)
        .reduce((sum, t) => sum + t.successRows, 0);
      return {
        minute: `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`,
        rows,
      };
    });

    // ── 2. 队列积压：等待处理的批次数（换算为行数估算） ──
    const backlogRows = await queueBacklogRows();

    // ── 3. 阶段耗时分布：P50/P95/P99（parse/rule/validate/insert/total） ──
    const perfLogs = await prisma.batchPerformanceLog.findMany({
      select: {
        parseDurationMs: true,
        ruleDurationMs: true,
        validateDurationMs: true,
        insertDurationMs: true,
        totalDurationMs: true,
      },
    });
    const stageDist = (key: 'parseDurationMs' | 'ruleDurationMs' | 'validateDurationMs' | 'insertDurationMs' | 'totalDurationMs') => {
      const vals = perfLogs.map(p => p[key]).sort((a, b) => a - b);
      if (vals.length === 0) return { p50: 0, p95: 0, p99: 0 };
      const pct = (p: number) => vals[Math.min(vals.length - 1, Math.floor(vals.length * p))] || 0;
      return { p50: pct(0.5), p95: pct(0.95), p99: pct(0.99) };
    };

    // ── 4. 错误类型分布 ──
    const errorGroups = await prisma.importTaskError.groupBy({
      by: ['errorCode'],
      _count: { _all: true },
    });
    const errorDistribution = errorGroups.map(g => ({
      error_code: g.errorCode,
      count: g._count._all,
    }));

    // ── 5. 任务状态分布 ──
    const taskGroups = await prisma.importTask.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const taskDistribution = taskGroups.map(g => ({
      status: g.status,
      count: g._count._all,
    }));

    // ── 6. 慢批次 TOP 10 ──
    const slowBatches = await prisma.batchPerformanceLog.findMany({
      orderBy: { totalDurationMs: 'desc' },
      take: 10,
      select: { taskId: true, unitId: true, batchIndex: true, totalDurationMs: true },
    });

    // ── 7. 降级任务数 ──
    const degradedCount = await prisma.importTask.count({ where: { degraded: true } });

    // ── 8. 最近有错误的任务（供前端"错误分布 → 跳转错误明细"使用，PRD 模块八） ──
    const recentErrorTasks = await prisma.importTask.findMany({
      where: { failedRows: { gt: 0 } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, fileName: true, failedRows: true },
    });

    return NextResponse.json({
      throughput_per_minute: perMinute,
      queue_backlog_rows: backlogRows,
      queue_backlog_warning: backlogRows > 5000,
      recent_error_tasks: recentErrorTasks.map(t => ({ task_id: t.id, file_name: t.fileName, failed_rows: t.failedRows })),
      stage_duration_ms: {
        parse: stageDist('parseDurationMs'),
        rule: stageDist('ruleDurationMs'),
        validate: stageDist('validateDurationMs'),
        insert: stageDist('insertDurationMs'),
        total: stageDist('totalDurationMs'),
      },
      error_distribution: errorDistribution,
      task_distribution: taskDistribution,
      slow_batches_top10: slowBatches.map(b => ({
        task_id: b.taskId,
        unit_id: b.unitId,
        batch_index: b.batchIndex,
        total_duration_ms: b.totalDurationMs,
      })),
      degraded_tasks: degradedCount,
    });
  } catch (error: any) {
    console.error('监控聚合异常:', error);
    return NextResponse.json({ error: '服务器内部错误，请稍后重试' }, { status: 500 });
  }
}
