// 队列抽象（PRD 三章：必须引入队列/任务系统；推荐 BullMQ + Redis / Upstash Redis）
// 使用 BullMQ + Redis。未配置 REDIS_URL 时队列不可用，由上层显式处理（不得静默降级）。

import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { REDIS_URL, isQueueAvailable } from '@/lib/config';

export const BATCH_QUEUE_NAME = 'import-batch-queue';

// 批次 Job 数据
export interface BatchJobData {
  taskId: string;
  traceId: string;
  unitId: string;
  batchIndex: number;
  fileKey: string;
  ruleId: string | null;
  ruleJson: string | null;
  startRow: number;
  endRow: number;
}

let connection: IORedis | null = null;
let queue: Queue | null = null;

function getConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
    });
  }
  return connection;
}

function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(BATCH_QUEUE_NAME, { connection: getConnection() });
  }
  return queue;
}

// 入队一个批次 Job（Dispatcher 使用）
export async function enqueueBatchJob(job: BatchJobData): Promise<void> {
  if (!isQueueAvailable()) {
    throw new Error('REDIS_URL 未配置，队列不可用');
  }
  const q = getQueue();
  await q.add(
    `batch:${job.taskId}:${job.unitId}`,
    job,
    {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 500,
      removeOnFail: 1000,
    }
  );
}

export interface BatchJobHandler {
  (job: BatchJobData): Promise<void>;
}

// 启动 Worker（常驻进程使用）
export function startBatchWorker(handler: BatchJobHandler): Worker {
  if (!isQueueAvailable()) {
    throw new Error('REDIS_URL 未配置，无法启动 Worker');
  }
  const worker = new Worker(
    BATCH_QUEUE_NAME,
    async (job) => {
      await handler(job.data as BatchJobData);
    },
    { connection: getConnection(), concurrency: 2 }
  );
  worker.on('failed', (job, err) => {
    console.error(`Worker Job 失败: ${job?.id}`, err?.message);
  });
  return worker;
}

// 优雅关闭
export async function closeQueue(): Promise<void> {
  if (queue) { await queue.close(); queue = null; }
  if (connection) { await connection.quit(); connection = null; }
}
