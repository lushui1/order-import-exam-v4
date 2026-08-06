/**
 * PRD 10.2 压测脚本
 * 用法：npm run load-test [文件路径] [规则ID]
 * 默认使用 test-data/10000-orders.xlsx 与 load-test-rule
 *
 * 流程：
 * 1. 上传 10,000 行 Excel，记录上传接口响应时间（验证 P95 ≤ 1s）
 * 2. 轮询任务状态直到完成
 * 3. 统计总耗时（验证 ≤ 60s）
 * 4. 校验最终成功行数/失败行数
 * 5. 输出是否达标 + 是否出现 500/504
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { ProxyAgent } from 'undici';

const BASE_URL = process.env.LOAD_TEST_BASE_URL || 'http://localhost:3000';
// 在线压测经代理访问（本机对 vercel.app 直连 DNS 污染，PRD 验收为公网可访问）
const PROXY = process.env.LOAD_TEST_PROXY || 'http://127.0.0.1:7897';
const DEFAULT_FILE = path.join(process.cwd(), 'test-data', '10000-orders.xlsx');
const POLL_INTERVAL_MS = 1000;
const MAX_WAIT_MS = 90_000;

interface TaskResult {
  task_id: string;
  status: string;
  total_rows: number;
  processed_rows: number;
  success_rows: number;
  failed_rows: number;
  total_batches: number;
  completed_batches: number;
  throughput: number;
  degraded: boolean;
}

// 在线压测走代理（模拟公网外部用户访问）
const dispatcher = new ProxyAgent(PROXY);
// @ts-ignore - undici dispatcher 是全局 fetch 的扩展选项（Node 20+），TS 类型未包含
const apiFetch = (url: string, init?: RequestInit) => fetch(url, { ...init, dispatcher });

async function main() {
  const filePath = process.argv[2] || DEFAULT_FILE;
  if (!existsSync(filePath)) {
    console.error(`压测文件不存在: ${filePath}\n请先运行 npm run seed:sku 生成压测数据`);
    process.exit(1);
  }

  console.log(`[压测] 目标: ${BASE_URL}`);
  console.log(`[压测] 文件: ${filePath} (${(readFileSync(filePath).length / 1024).toFixed(1)} KB)`);

  // ── 1. 上传并计时 ──
  const buffer = readFileSync(filePath);
  const form = new FormData();
  form.append('file', new Blob([buffer]), path.basename(filePath));
  // 未显式传入规则ID时，自动查询 load-test-rule（否则任务无规则，process 会全部失败）
  let ruleId = process.argv[3];
  if (!ruleId) {
    try {
      const rulesRes = await apiFetch(`${BASE_URL}/api/rules`);
      const rules = await rulesRes.json();
      const rule = (rules || []).find((r: any) => r.name === 'load-test-rule') || (rules || [])[0];
      ruleId = rule?.id || '';
    } catch {
      ruleId = '';
    }
  }
  if (ruleId) form.append('ruleId', ruleId);
  console.log(`[压测] 规则ID: ${ruleId || '(未指定)'}`);

  // 注意：不手动设置 Content-Type，由 undici 自动生成 multipart boundary（与 load-test-online 一致）
  const uploadStart = Date.now();
  const uploadRes = await apiFetch(`${BASE_URL}/api/import-tasks`, { method: 'POST', body: form });
  const uploadMs = Date.now() - uploadStart;
  const uploadBody = await uploadRes.json().catch(() => null);

  console.log(`\n[压测] 上传接口: HTTP ${uploadRes.status}, 耗时 ${uploadMs}ms`);

  let httpErrors = 0;
  if (uploadRes.status >= 500) httpErrors++;

  if (!uploadRes.ok || !uploadBody?.task_id) {
    console.error(`[压测] 上传失败: ${JSON.stringify(uploadBody)}`);
    process.exit(1);
  }

  const taskId = uploadBody.task_id;
  console.log(`[压测] task_id: ${taskId}`);
  console.log(`[压测] 预估行数: ${uploadBody.total_rows}, 批次数: ${uploadBody.total_batches}`);

  // ── 1.5 模拟外部用户访问任务页：前端自动触发一次消费（POST /process，无 Redis 兜底消费）
  console.log(`[压测] 模拟前端自动触发消费...`);
  let processRes: Response | null = null;
  let processBody: any = null;
  // undici 代理复用连接可能被服务端重置（ECONNRESET），重试最多 3 次
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      processRes = await apiFetch(`${BASE_URL}/api/import-tasks/${taskId}/process`, { method: 'POST' });
      processBody = await processRes.json().catch(() => null);
      if (processRes.ok) break;
    } catch (err: any) {
      if (attempt < 3) {
        console.log(`[压测] 消费触发重试 ${attempt}/3 (${err?.cause?.code || err?.message})`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      console.error(`[压测] 消费触发失败: ${err?.cause?.code || err?.message}`);
    }
  }
  if (processRes && processRes.status >= 500) httpErrors++;
  console.log(`[压测] 消费触发: HTTP ${processRes?.status ?? '失败'}, 已处理批次 ${processBody?.processed ?? '?'}/${processBody?.total_batches ?? '?'}`);

  // ── 2. 轮询任务状态直到完成 ──
  const startedAt = Date.now();
  let task: TaskResult | null = null;
  let lastPoll = 0;

  while (Date.now() - startedAt < MAX_WAIT_MS) {
    const pollStart = Date.now();
    const res = await apiFetch(`${BASE_URL}/api/import-tasks/${taskId}`);
    if (res.status >= 500) httpErrors++;
    if (res.ok) {
      const data = await res.json();
      lastPoll = Date.now() - pollStart;
      task = data;

      // 每 5 秒打印一次进度
      if (data.processed_rows % 2000 === 0 || data.status !== 'PROCESSING') {
        console.log(`[压测] 进度: ${data.processed_rows}/${data.total_rows} 行, 批次 ${data.completed_batches}/${data.total_batches}, 状态 ${data.status}`);
      }
      if (['COMPLETED', 'PARTIAL_SUCCESS', 'FAILED'].includes(data.status)) break;
    } else {
      httpErrors++;
      console.error(`[压测] 状态查询异常 HTTP ${res.status}`);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  const totalMs = Date.now() - startedAt;
  const passed = totalMs <= 60_000;

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`[压测结果]`);
  console.log(`  上传接口耗时: ${uploadMs}ms (目标 P95 ≤ 1000ms)`);
  console.log(`  全链路总耗时: ${totalMs}ms (目标 ≤ 60000ms) ${passed ? '✅' : '❌'}`);
  console.log(`  最终状态: ${task?.status ?? '未知'}`);
  console.log(`  成功行: ${task?.success_rows ?? 0}`);
  console.log(`  失败行: ${task?.failed_rows ?? 0}`);
  console.log(`  批次: ${task?.completed_batches ?? 0}/${task?.total_batches ?? 0}`);
  console.log(`  吞吐: ${task?.throughput ?? 0} 行/分钟`);
  console.log(`  降级: ${task?.degraded ? '是 ⚠️' : '否'}`);
  console.log(`  轮询平均耗时: ${lastPoll}ms`);
  console.log(`  HTTP 5xx 错误: ${httpErrors} 次 ${httpErrors === 0 ? '✅' : '❌'}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const ok = passed && httpErrors === 0 && task !== null;
  console.log(ok
    ? '\n✅ 压测达标：10,000 行全链路 ≤ 60 秒，无 500/504'
    : '\n❌ 压测未达标，请检查 Worker 并发、批量大小与数据库连接池后重试');
  process.exit(ok ? 0 : 1);
}

main();
