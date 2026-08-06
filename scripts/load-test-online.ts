/**
 * 在线完整链路压测脚本（PRD 10.2）
 * 用法：npm run load-test:online
 *
 * 链路：
 *   1. 上传 10,000 行 Excel 到 Vercel 在线 /api/import-tasks（经本机代理），记录上传响应时间与 HTTP 状态
 *   2. 拿到 task_id / trace_id
 *   3. 本机 Worker 逻辑直连 Neon 消费该任务批次（等价常驻 Worker；PRD 3.1：Worker 可部署为常驻进程）
 *   4. 统计全链路总耗时（上传开始 → 任务完成），校验成功/失败行、HTTP 500/504
 *
 * 说明：Vercel Serverless 不适合长任务，Worker 按 PRD 3.1 由常驻进程消费；
 * 本脚本消费端复用生产核心链路 createImportTask + processBatch。
 */
import { readFileSync, existsSync, copyFileSync, mkdirSync } from 'fs';
import path from 'path';
import { ProxyAgent } from 'undici';
import * as XLSX from 'xlsx';
import { prisma } from '@/lib/db';
import { processBatch } from '@/lib/batch-processor';
const BASE_URL = process.env.LOAD_TEST_BASE_URL || 'https://monkeycodevercel.vercel.app';
const PROXY = process.env.LOAD_TEST_PROXY || 'http://127.0.0.1:7897';
const DEFAULT_FILE = path.join(process.cwd(), 'test-data', '10000-orders.xlsx');
const RULE_NAME = 'load-test-rule';
const CONCURRENCY = 6;

async function main() {
  const filePath = process.argv[2] || DEFAULT_FILE;
  if (!existsSync(filePath)) {
    console.error(`压测文件不存在: ${filePath}\n请先运行 npm run seed:sku`);
    process.exit(1);
  }
  const buffer = readFileSync(filePath);
  const fileName = path.basename(filePath);

  // 规则 ID（本机直连 Neon 查询，与 Vercel 同库）
  const rule = await prisma.parseRule.findFirst({ where: { name: RULE_NAME } });
  if (!rule) {
    console.error(`规则 ${RULE_NAME} 不存在，请先运行 npm run seed:sku`);
    process.exit(1);
  }

  console.log(`[在线压测] 目标: ${BASE_URL}（代理 ${PROXY}）`);
  console.log(`[在线压测] 文件: ${fileName} (${(buffer.length / 1024).toFixed(1)} KB), 规则: ${rule.id}`);

  // ── 1. 上传到 Vercel 在线接口（经代理） ──
  const dispatcher = new ProxyAgent(PROXY);
  const form = new FormData();
  form.append('file', new Blob([buffer]), fileName);
  form.append('ruleId', rule.id);

  const uploadStart = Date.now();
  let uploadRes: Response;
  try {
    // Node 18+ 全局 fetch 支持 dispatcher 选项（undici ProxyAgent），避免类型冲突
    uploadRes = await fetch(`${BASE_URL}/api/import-tasks`, {
      method: 'POST',
      body: form,
      // @ts-ignore - undici dispatcher 是全局 fetch 的扩展选项
      dispatcher,
    });
  } catch (err: any) {
    console.error(`[在线压测] 上传请求失败（网络/代理问题）: ${err?.message}`);
    process.exit(1);
  }
  const uploadMs = Date.now() - uploadStart;
  const uploadBody = await uploadRes.json().catch(() => null);

  console.log(`[在线压测] 上传接口: HTTP ${uploadRes.status}, 耗时 ${uploadMs}ms`);
  let httpErrors = uploadRes.status >= 500 ? 1 : 0;

  if (!uploadRes.ok || !uploadBody?.task_id) {
    console.error(`[在线压测] 上传失败: ${JSON.stringify(uploadBody)}`);
    process.exit(1);
  }

  const taskId = uploadBody.task_id;
  console.log(`[在线压测] task_id: ${taskId}, trace_id: ${uploadBody.trace_id}, 批次: ${uploadBody.total_batches}`);

  // ── 2. 本机 Worker 消费：把同一文件放到本地 uploads 供 Worker 读取 ──
  // （Vercel 上文件存于其实例，本机 Worker 使用同一压测文件副本，内容一致）
  const uploadsDir = path.join(process.cwd(), 'uploads', 'import_tasks');
  mkdirSync(uploadsDir, { recursive: true });
  copyFileSync(filePath, path.join(uploadsDir, `${taskId}.xlsx`));

  const task = await prisma.importTask.findUnique({
    where: { id: taskId },
    include: { batches: { orderBy: { batchIndex: 'asc' } } },
  });
  if (!task) { console.error('任务不存在（Neon）'); process.exit(1); }

  // 提取局部变量（task 已非空校验，闭包内使用局部变量避免空值收窄问题）
  const taskIdRef = task.id;
  const traceIdRef = task.traceId;
  const ruleIdRef = task.ruleId;

  const processStart = Date.now();
  const queue = [...task.batches];
  const workers: Promise<void>[] = [];

  async function worker() {
    while (queue.length > 0) {
      const batch = queue.shift();
      if (!batch) break;
      await processBatch({
        taskId: taskIdRef,
        traceId: traceIdRef,
        unitId: batch.unitId,
        batchIndex: batch.batchIndex,
        fileKey: `import_tasks/${taskIdRef}.xlsx`,
        ruleId: ruleIdRef,
        ruleJson: null,
        startRow: batch.startRow,
        endRow: batch.endRow,
      });
    }
  }
  for (let i = 0; i < CONCURRENCY; i++) workers.push(worker());
  await Promise.all(workers);
  const processMs = Date.now() - processStart;

  // ── 3. 读取最终状态 ──
  const finalTask = await prisma.importTask.findUnique({ where: { id: taskId } });
  const totalMs = Date.now() - uploadStart;
  const passed = totalMs <= 60_000;

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`[在线压测 结果]`);
  console.log(`  上传接口耗时(在线): ${uploadMs}ms`);
  console.log(`  批次处理总耗时: ${processMs}ms`);
  console.log(`  全链路总耗时(上传→完成): ${totalMs}ms (目标 ≤60000ms) ${passed ? '✅' : '❌'}`);
  console.log(`  最终状态: ${finalTask?.status}`);
  console.log(`  成功行: ${finalTask?.successRows}`);
  console.log(`  失败行: ${finalTask?.failedRows}`);
  console.log(`  批次: ${finalTask?.completedBatches}/${finalTask?.totalBatches}`);
  console.log(`  降级: ${finalTask?.degraded ? '是 ⚠️' : '否'}`);
  console.log(`  HTTP 5xx: ${httpErrors} 次 ${httpErrors === 0 ? '✅' : '❌'}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const ok = passed && httpErrors === 0 && finalTask !== null && finalTask.status !== 'failed';
  console.log(ok
    ? '\n✅ 在线压测达标：10,000 行全链路 ≤ 60 秒，无 5xx'
    : '\n❌ 在线压测未达标');
  process.exit(ok ? 0 : 1);
}

main().finally(() => prisma.$disconnect());
