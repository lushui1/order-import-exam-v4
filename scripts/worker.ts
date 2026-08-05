/**
 * Import Worker 常驻进程（PRD 模块四）
 * 用法：npm run worker
 * 消费 BullMQ 队列中的批次 Job，复用 V2 规则引擎，批量校验/写入，记录错误与性能日志。
 */
import { startBatchWorker } from '@/lib/queue';
import { processBatch } from '@/lib/batch-processor';
import { REDIS_URL } from '@/lib/config';

async function main() {
  if (!REDIS_URL) {
    console.error('REDIS_URL 未配置，Worker 无法启动。请先配置 Redis（本地或 Upstash）。');
    process.exit(1);
  }

  console.log('[Worker] 启动，监听队列 import-batch-queue，并发 2');
  const worker = startBatchWorker(async (job) => {
    await processBatch(job);
  });

  worker.on('ready', () => console.log('[Worker] 队列连接就绪'));
  worker.on('completed', (job) => console.log(`[Worker] Job 完成: ${job.id}`));
  worker.on('failed', (job, err) => console.error(`[Worker] Job 失败(将重试): ${job?.id} - ${err?.message}`));

  const stop = async () => {
    console.log('[Worker] 正在关闭...');
    await worker.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main();
