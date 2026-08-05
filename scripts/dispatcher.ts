/**
 * Outbox Dispatcher 常驻进程（PRD 模块三）
 * 用法：npm run dispatcher
 * 每 3 秒轮询 event_outbox 并投递批次事件到 BullMQ 队列；
 * 服务宕机后重启本进程可恢复投递（pending/failed 且到期事件）。
 * 同时扫描卡死批次（processing 超时）恢复重投（PRD 4.4 / 考点3）。
 */
import { dispatchOnce, recoverStaleBatches } from '@/lib/outbox-dispatcher';
import { closeQueue } from '@/lib/queue';
import { REDIS_URL } from '@/lib/config';

const POLL_INTERVAL_MS = 3000;

async function main() {
  if (!REDIS_URL) {
    console.error('REDIS_URL 未配置，Dispatcher 无法启动。请先配置 Redis（本地或 Upstash）。');
    process.exit(1);
  }
  console.log(`[Dispatcher] 启动，轮询间隔 ${POLL_INTERVAL_MS}ms，队列要求 REDIS_URL 已配置`);
  console.log(`[Dispatcher] 每轮最多投递 50 条，失败按指数退避重试，超过 5 次标记 failed`);
  console.log(`[Dispatcher] 卡死恢复：processing 超过 5 分钟无进展的批次恢复重投，超过 3 次标记 failed`);

  let running = true;
  const stop = async () => {
    running = false;
    await closeQueue();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  while (running) {
    try {
      const result = await dispatchOnce();
      if (result.claimed > 0) {
        console.log(`[Dispatcher] 本轮: 领取 ${result.claimed}, 投递成功 ${result.sent}, 失败 ${result.failed}`);
      }
      // 卡死恢复：每轮扫描一次超时批次
      const recovered = await recoverStaleBatches();
      if (recovered > 0) {
        console.log(`[Dispatcher] 卡死恢复: ${recovered} 个批次`);
      }
    } catch (err) {
      console.error('[Dispatcher] 轮询异常:', err);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main();
