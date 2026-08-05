// PRD 9.1 事件信封：所有事件统一信封结构
export interface EventEnvelope<T = Record<string, unknown>> {
  event_id: string;
  event_type: EventType;
  schema_version: number;
  aggregate_id: string;
  trace_id: string;
  occurred_at: string;
  payload: T;
}

// PRD 9.2 至少定义的事件
export type EventType =
  | 'ImportTaskCreated'
  | 'ImportBatchCreated'
  | 'ImportBatchStarted'
  | 'ImportBatchSucceeded'
  | 'ImportBatchFailed'
  | 'ImportTaskCompleted'
  | 'ImportTaskPartialSuccess'
  | 'ImportTaskDegraded';

export const EVENT_TYPES: EventType[] = [
  'ImportTaskCreated',
  'ImportBatchCreated',
  'ImportBatchStarted',
  'ImportBatchSucceeded',
  'ImportBatchFailed',
  'ImportTaskCompleted',
  'ImportTaskPartialSuccess',
  'ImportTaskDegraded',
];

// 批次负载（ImportBatchCreated 等）
export interface ImportBatchPayload {
  task_id: string;
  unit_id: string;
  batch_index: number;
  start_row: number;
  end_row: number;
}

let eventSeq = 0;

// 生成事件 ID（保证同进程内唯一，跨进程由 DB 主键兜底）
export function newEventId(): string {
  eventSeq += 1;
  return `evt_${Date.now()}_${process.pid}_${eventSeq}`;
}

// 构建统一事件信封
export function buildEvent<T>(
  eventType: EventType,
  aggregateId: string,
  traceId: string,
  payload: T,
  schemaVersion = 1
): EventEnvelope<T> {
  return {
    event_id: newEventId(),
    event_type: eventType,
    schema_version: schemaVersion,
    aggregate_id: aggregateId,
    trace_id: traceId,
    occurred_at: new Date().toISOString(),
    payload,
  };
}
