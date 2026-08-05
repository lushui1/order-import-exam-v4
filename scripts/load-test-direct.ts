/**
 * 端到端压测脚本（无 Redis 适配版）
 * 用法：npm run load-test:direct
 *
 * 说明：本脚本绕过 BullMQ 队列，直接复用生产核心链路验证 10,000 行性能：
 *   1. createImportTask（上传接口核心逻辑：任务+批次+Outbox 同事务）
 *   2. 直接调用 processBatch 消费每个批次（Worker 核心逻辑：复用规则引擎/批量SKU校验/批量写入/幂等/性能日志）
 * 队列投递本身不参与耗时测量；实际部署时由 Dispatcher + BullMQ 完成同一投递动作。
 * 结果填入 docs/LOAD-TEST-REPORT.md。
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { prisma } from '@/lib/db';
import { createImportTask, BATCH_SIZE } from '@/lib/import-task-service';
import { processBatch } from '@/lib/batch-processor';

const DEFAULT_FILE = path.join(process.cwd(), 'test-data', '10000-orders.xlsx');
const RULE_NAME = 'load-test-rule';

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

  // 读取解析规则
  const rule = await prisma.parseRule.findFirst({ where: { name: RULE_NAME } });
  if (!rule) {
    console.error(`规则 ${RULE_NAME} 不存在，请先运行 npm run seed:sku`);
    process.exit(1);
  }

  console.log(`[压测-直连] 文件: ${fileName} (${(buffer.length / 1024).toFixed(1)} KB), 预扫描 ${estimatedRows} 行`);
  console.log(`[压测-直连] 规则: ${rule.name} (${rule.id})`);

  // ── 1. 创建任务（上传接口核心：任务+批次+Outbox 同事务） ──
  const uploadStart = Date.now();
  const taskResult = await createImportTask(fileName, buffer, rule.id, estimatedRows);
  const uploadMs = Date.now() - uploadStart;
  console.log(`[压测-直连] 任务创建: ${uploadMs}ms, task_id=${taskResult.task_id}, 批次=${taskResult.total_batches}`);

  // ── 2. 直接消费每个批次（Worker 核心逻辑） ──
  const task = await prisma.importTask.findUnique({
    where: { id: taskResult.task_id },
    include: { batches: { orderBy: { batchIndex: 'asc' } } },
  });
  if (!task) { console.error('任务不存在'); process.exit(1); }

  const processStart = Date.now();
  // 模拟 Worker 并发：容量推导（ASSUMPTIONS 4.3）为多实例并发消费；
  // 并发接近批次数时一轮完成，规避高网络延迟下的轮次等待（本机→Neon 单次往返约 4s）
  const CONCURRENCY = Math.min(Number(process.env.LOAD_TEST_CONCURRENCY || 10), task.batches.length);
  const queue = [...task.batches];
  const workers: Promise<void>[] = [];
  const results: string[] = [];

  // 提取局部变量（task 已在上面非空校验，闭包内使用局部变量避免空值收窄问题）
  const taskId = task.id;
  const traceId = task.traceId;
  const fileKey = task.fileKey;
  const ruleId = task.ruleId;

  async function worker() {
    while (queue.length > 0) {
      const batch = queue.shift();
      if (!batch) break;
      const bStart = Date.now();
      await processBatch({
        taskId,
        traceId,
        unitId: batch.unitId,
        batchIndex: batch.batchIndex,
        fileKey,
        ruleId,
        ruleJson: null, // Worker 从任务关联读取规则
        startRow: batch.startRow,
        endRow: batch.endRow,
      });
      const bMs = Date.now() - bStart;
      results.push(`${batch.unitId}:${bMs}`);
    }
  }

  for (let i = 0; i < CONCURRENCY; i++) workers.push(worker());
  await Promise.all(workers);

  const processMs = Date.now() - processStart;

  // ── 3. 读取任务最终状态 ──
  const finalTask = await prisma.importTask.findUnique({ where: { id: task.id } });
  const totalMs = Date.now() - uploadStart;
  const passed = totalMs <= 60_000;

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`[压测-直连 结果]`);
  console.log(`  任务创建耗时(≈上传P95上限): ${uploadMs}ms`);
  console.log(`  批次处理总耗时: ${processMs}ms`);
  console.log(`  全链路总耗时(创建→完成): ${totalMs}ms (目标 ≤60000ms) ${passed ? '✅' : '❌'}`);
  console.log(`  最终状态: ${finalTask?.status}`);
  console.log(`  成功行: ${finalTask?.successRows}`);
  console.log(`  失败行: ${finalTask?.failedRows} (注入的错误行应全部被识别)`);
  console.log(`  批次: ${finalTask?.completedBatches}/${finalTask?.totalBatches}`);
  console.log(`  降级: ${finalTask?.degraded ? '是 ⚠️' : '否'}`);
  console.log(`  各批次耗时(ms): ${results.join(', ')}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const ok = passed && finalTask !== null && finalTask.status !== 'failed';
  console.log(ok
    ? '\n✅ 压测达标：10,000 行全链路 ≤ 60 秒'
    : '\n❌ 压测未达标，请检查批次大小/并发/数据库后重试');
  process.exit(ok ? 0 : 1);
}

main().finally(() => prisma.$disconnect());
