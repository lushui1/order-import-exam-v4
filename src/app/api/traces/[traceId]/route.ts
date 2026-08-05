/**
 * PRD 8.5 Trace 搜索：GET /api/traces/:traceId
 * 返回按时间线排序的全链路事件（任务创建 → 批次入队 → Worker 处理 → 完成）
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ traceId: string }> }
) {
  try {
    const { traceId } = await params;

    // 支持按 task_id 检索：/api/traces/:traceId 中 traceId 也可能是 taskId
    const events = await prisma.traceEvent.findMany({
      where: { traceId },
      orderBy: { occurredAt: 'asc' },
    });

    if (events.length === 0) {
      // 按 taskId 反查 traceId
      const task = await prisma.importTask.findUnique({ where: { id: traceId } });
      if (!task) {
        return NextResponse.json({ error: 'Trace 不存在' }, { status: 404 });
      }
      const taskEvents = await prisma.traceEvent.findMany({
        where: { traceId: task.traceId },
        orderBy: { occurredAt: 'asc' },
      });
      return NextResponse.json({
        trace_id: task.traceId,
        task_id: task.id,
        events: taskEvents.map(mapEvent),
      });
    }

    return NextResponse.json({
      trace_id: traceId,
      events: events.map(mapEvent),
    });
  } catch (error: any) {
    console.error('查询 Trace 异常:', error);
    return NextResponse.json({ error: '服务器内部错误，请稍后重试' }, { status: 500 });
  }
}

function mapEvent(e: any) {
  return {
    id: e.id,
    task_id: e.taskId,
    unit_id: e.unitId,
    event_name: e.eventName,
    event_status: e.eventStatus,
    message: e.message,
    occurred_at: e.occurredAt.toISOString(),
  };
}
