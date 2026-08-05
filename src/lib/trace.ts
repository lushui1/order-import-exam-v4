// 链路追踪：trace_id 生成与 TraceEvent 写入（PRD 5.3 链路追踪 / 考点5）

import { prisma } from '@/lib/db';

// 生成 trace_id：trace_ + 时间戳 + 随机
export function newTraceId(): string {
  return `trace_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export interface TraceEventInput {
  traceId: string;
  taskId?: string | null;
  unitId?: string | null;
  eventName: string;
  eventStatus: 'ok' | 'error' | 'warn';
  message?: string;
}

// 写入 Trace 事件（失败不阻断主流程）
export async function recordTrace(input: TraceEventInput): Promise<void> {
  try {
    await prisma.traceEvent.create({
      data: {
        traceId: input.traceId,
        taskId: input.taskId || null,
        unitId: input.unitId || null,
        eventName: input.eventName,
        eventStatus: input.eventStatus,
        message: input.message || null,
      },
    });
  } catch (err) {
    // Trace 记录失败只打日志，不抛错
    console.error('写入 Trace 事件失败:', err);
  }
}
