/**
 * 复现场景验证：任务创建后长时间未消费（排队 15h），再消费处理。
 * 验证目标（对应线上 55980s bug）：
 * 1. started_at 在首个批次处理时落库（接近处理时刻，而非创建时刻）
 * 2. 吞吐 = processedRows / (completedAt - startedAt)，不再被排队时间稀释
 * 3. 已用时间 = completedAt - startedAt ≈ 真实处理耗时（秒级），而非 15h
 * 用法：npx tsx scripts/verify-elapsed.ts
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { prisma } from '../src/lib/db';
import { createImportTask } from '../src/lib/import-task-service';
import { processBatch } from '../src/lib/batch-processor';

const DEFAULT_FILE = path.join(__dirname, '..', 'test-data', '10000-orders.xlsx');
const RULE_NAME = 'load-test-rule';
const QUEUE_HOURS = 15; // 模拟任务创建后排队 15 小时才被消费

async function main() {
  const filePath = process.argv[2] || DEFAULT_FILE;
  if (!existsSync(filePath)) {
    console.error(`压测文件不存在: ${filePath}\n请先运行 npm run seed:sku`);
    process.exit(1);
  }

  const buffer = readFileSync(filePath);
  const fileName = path.basename(filePath);

  // 预扫描行数（与上传接口一致）
  let estimatedRows = 0;
  try {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const firstSheet = wb.SheetNames[0];
    if (firstSheet) {
      const ws = wb.Sheets[firstSheet];
      if (ws?.['!ref']) {
        const range = XLSX.utils.decode_range(ws['!ref']);
        estimatedRows = range.e.r + 1;
      }
    }
  } catch { /* 预扫描失败则按 0 处理 */ }

  const rule = await prisma.parseRule.findFirst({ where: { name: RULE_NAME } });
  if (!rule) {
    console.error(`规则 ${RULE_NAME} 不存在，请先运行 npm run seed:sku`);
    process.exit(1);
  }

  console.log(`[验证] 文件: ${fileName} (${(buffer.length / 1024).toFixed(1)} KB), 预扫描 ${estimatedRows} 行`);

  // ── 1. 创建任务（此时 created_at = now） ──
  const taskResult = await createImportTask(fileName, buffer, rule.id, estimatedRows);
  const taskId = taskResult.task_id;
  console.log(`[验证] 任务创建: task_id=${taskId}, 批次=${taskResult.total_batches}`);

  // ── 2. 模拟排队：把 created_at 改到 15 小时前（线上场景：文件上传后迟迟未被消费） ──
  const queuedAt = new Date(Date.now() - QUEUE_HOURS * 3600 * 1000);
  await prisma.importTask.update({
    where: { id: taskId },
    data: { createdAt: queuedAt },
  });
  console.log(`[验证] 模拟排队: created_at 回拨 ${QUEUE_HOURS}h → ${queuedAt.toISOString()}`);

  // ── 3. 消费所有批次（processBatch，首个批次应落库 started_at） ──
  const task = await prisma.importTask.findUnique({
    where: { id: taskId },
    include: { batches: { orderBy: { batchIndex: 'asc' } } },
  });
  if (!task) { console.error('任务不存在'); process.exit(1); }

  // 并发消费（本机→Neon 跨区单批 14~45s，串行 6 批会超时；并发一轮完成）
  const processStart = Date.now();
  const CONCURRENCY = Math.min(Number(process.env.VERIFY_CONCURRENCY || 6), task.batches.length);
  const queue = [...task.batches];
  const workers: Promise<void>[] = [];
  const taskId2 = task.id;
  const traceId2 = task.traceId;
  const fileKey2 = task.fileKey;
  const ruleId2 = task.ruleId;
  async function worker() {
    while (queue.length > 0) {
      const batch = queue.shift();
      if (!batch) break;
      await processBatch({
        taskId: taskId2,
        traceId: traceId2,
        unitId: batch.unitId,
        batchIndex: batch.batchIndex,
        fileKey: fileKey2,
        ruleId: ruleId2,
        ruleJson: null,
        startRow: batch.startRow,
        endRow: batch.endRow,
      });
    }
  }
  for (let i = 0; i < CONCURRENCY; i++) workers.push(worker());
  await Promise.all(workers);
  const processMs = Date.now() - processStart;

  // ── 4. 读取终态并复算 API 指标（与 route.ts 同公式） ──
  const finalTask = await prisma.importTask.findUnique({ where: { id: taskId } });
  if (!finalTask) { console.error('终态读取失败'); process.exit(1); }

  const baseStartMs = finalTask.startedAt ? finalTask.startedAt.getTime() : finalTask.createdAt.getTime();
  const elapsedMs = finalTask.completedAt
    ? finalTask.completedAt.getTime() - baseStartMs
    : Date.now() - baseStartMs;
  const throughput = elapsedMs > 0
    ? Math.round((finalTask.processedRows / Math.max(elapsedMs / 60000, 0.01)))
    : 0;
  const elapsedSec = Math.max(0, Math.round(elapsedMs / 1000));

  console.log('\n━━━ [验证结果] ━━━');
  console.log(`  created_at   : ${finalTask.createdAt.toISOString()}`);
  console.log(`  started_at   : ${finalTask.startedAt?.toISOString() ?? 'NULL(未落库!)'}`);
  console.log(`  completed_at : ${finalTask.completedAt?.toISOString() ?? 'NULL'}`);
  console.log(`  状态          : ${finalTask.status} | 成功 ${finalTask.successRows} / 失败 ${finalTask.failedRows}`);
  console.log(`  消费耗时(脚本): ${processMs}ms`);
  console.log(`  已用时间(API) : ${elapsedSec}s（应为秒级，而非 ${QUEUE_HOURS * 3600}s）`);
  console.log(`  吞吐(API)     : ${throughput} 行/分（应为数万级，而非个位数）`);
  console.log(`  队列污染差    : ${Math.abs(elapsedSec - Math.round(processMs / 1000))}s`);

  const okElapsed = elapsedSec < 600; // 已用时间应远小于 15h（<10 分钟）
  const okThroughput = throughput > 1000; // 吞吐不应被排队时间稀释成个位数
  const okStarted = finalTask.startedAt !== null;
  console.log(`\n  ✅ started_at 落库: ${okStarted ? '是' : '否'}`);
  console.log(`  ✅ 已用时间未含排队: ${okElapsed ? `是 (${elapsedSec}s)` : `否 (${elapsedSec}s!)`}`);
  console.log(`  ✅ 吞吐未被稀释: ${okThroughput ? `是 (${throughput} 行/分)` : `否 (${throughput}!)`}`);

  const allOk = okStarted && okElapsed && okThroughput;
  console.log(`\n  总体: ${allOk ? '✅ 验证通过（55980s 场景已修复）' : '❌ 仍存在问题'}`);

  // 清理验证任务（保留 orders/errors 不删，避免误删；仅删任务与批次，供再次运行）
  await prisma.importTaskBatch.deleteMany({ where: { taskId } });
  await prisma.importTaskError.deleteMany({ where: { taskId } });
  await prisma.eventOutbox.deleteMany({ where: { aggregateId: taskId } });
  await prisma.traceEvent.deleteMany({ where: { taskId } });
  await prisma.importTask.delete({ where: { id: taskId } });
  console.log('[验证] 已清理验证任务数据');

  process.exit(allOk ? 0 : 1);
}

main().catch(err => {
  console.error('[验证] 异常:', err);
  process.exit(1);
});
