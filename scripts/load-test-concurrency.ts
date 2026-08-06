/**
 * 多用户并发访问压测（模拟外部用户同时访问/导入）
 * 用法：npx tsx scripts/_concurrency-check.ts [并发用户数]
 * 并行 N 个用户：上传 10,000 行文件 → 自动触发消费 → 查询最终状态，
 * 统计成功率/平均耗时/5xx，验证在线系统在并发下可用（PRD 大促多用户场景）。
 */
import { readFileSync } from 'fs';
import path from 'path';
import { ProxyAgent } from 'undici';

const BASE_URL = process.env.LOAD_TEST_BASE_URL || 'https://monkeycodevercel.vercel.app';
const PROXY = process.env.LOAD_TEST_PROXY || 'http://127.0.0.1:7897';
const FILE = path.join(process.cwd(), 'test-data', '10000-orders.xlsx');

// 与 load-test.ts 一致的 ProxyAgent（字符串形式，兼容性最好）；retryFetch 处理并发下偶发超时
const dispatcher = new ProxyAgent(PROXY);
// @ts-ignore - undici dispatcher 是全局 fetch 的扩展选项（Node 20+），TS 类型未包含
const apiFetch = (url: string, init?: RequestInit) => fetch(url, { ...init, dispatcher });

// 带重试的请求：并发下代理偶发超时/连接重置，重试最多 3 次
async function retryFetch(url: string, init?: RequestInit): Promise<Response> {
  let lastErr: any = null;
  for (let a = 1; a <= 3; a++) {
    try {
      const res = await apiFetch(url, init);
      return res;
    } catch (err: any) {
      lastErr = err;
      if (a < 3) await new Promise(r => setTimeout(r, 1500));
    }
  }
  throw lastErr;
}

async function oneUser(idx: number): Promise<{ ok: boolean; uploadMs: number; totalMs: number; status: string; success: number; failed: number; http5xx: number }> {
  const start = Date.now();
  let http5xx = 0;
  try {
    // 1. 查询规则（并发用户各自拿规则 ID）
    const rulesRes = await retryFetch(`${BASE_URL}/api/rules`);
    if (rulesRes.status >= 500) http5xx++;
    const rules = await rulesRes.json();
    const rule = (rules || []).find((r: any) => r.name === 'load-test-rule') || (rules || [])[0];

    // 2. 上传
    const buffer = readFileSync(FILE);
    const form = new FormData();
    form.append('file', new Blob([buffer]), '10000-orders.xlsx');
    if (rule?.id) form.append('ruleId', rule.id);
    const uploadStart = Date.now();
    const upRes = await retryFetch(`${BASE_URL}/api/import-tasks`, { method: 'POST', body: form });
    const uploadMs = Date.now() - uploadStart;
    if (upRes.status >= 500) http5xx++;
    const upBody = await upRes.json().catch(() => null);
    if (!upRes.ok || !upBody?.task_id) {
      return { ok: false, uploadMs, totalMs: 0, status: 'upload_failed', success: 0, failed: 0, http5xx };
    }
    const taskId = upBody.task_id;

    // 3. 自动触发消费（模拟前端行为，含重试）
    let procBody: any = null;
    for (let a = 1; a <= 3; a++) {
      try {
        const pRes = await retryFetch(`${BASE_URL}/api/import-tasks/${taskId}/process`, { method: 'POST' });
        if (pRes.status >= 500) http5xx++;
        procBody = await pRes.json().catch(() => null);
        if (pRes.ok) break;
      } catch {
        if (a < 3) await new Promise(r => setTimeout(r, 2000));
      }
    }

    // 4. 轮询最终状态（最多 60s）
    let final: any = null;
    const waitUntil = Date.now() + 60_000;
    while (Date.now() < waitUntil) {
      const stRes = await retryFetch(`${BASE_URL}/api/import-tasks/${taskId}`);
      if (stRes.status >= 500) http5xx++;
      final = await stRes.json().catch(() => null);
      if (final && ['COMPLETED', 'PARTIAL_SUCCESS', 'FAILED'].includes(final.status)) break;
      await new Promise(r => setTimeout(r, 1500));
    }
    const totalMs = Date.now() - start;
    const ok = !!final && ['COMPLETED', 'PARTIAL_SUCCESS'].includes(final.status) && final.success_rows > 0;
    return {
      ok, uploadMs, totalMs,
      status: final?.status || 'timeout',
      success: final?.success_rows || 0,
      failed: final?.failed_rows || 0,
      http5xx,
    };
  } catch (e: any) {
    return { ok: false, uploadMs: 0, totalMs: 0, status: 'error: ' + e?.message, success: 0, failed: 0, http5xx };
  }
}

async function main() {
  const users = Math.max(1, parseInt(process.argv[2] || '3', 10));
  console.log(`[并发压测] ${users} 个并发用户，目标 ${BASE_URL}`);
  console.log(`[并发压测] 文件: ${FILE} (10,000 行)\n`);

  const startedAt = Date.now();
  const results = await Promise.all(Array.from({ length: users }, (_, i) => oneUser(i)));
  const wallMs = Date.now() - startedAt;

  const okCount = results.filter(r => r.ok).length;
  const failCount = results.length - okCount;
  const total5xx = results.reduce((s, r) => s + r.http5xx, 0);
  const avgUpload = Math.round(results.reduce((s, r) => s + r.uploadMs, 0) / results.length);
  const avgTotal = Math.round(results.reduce((s, r) => s + r.totalMs, 0) / results.length);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`[并发压测结果]`);
  console.log(`  并发用户: ${users}`);
  console.log(`  成功: ${okCount}/${users} ${okCount === users ? '✅' : '❌'}`);
  console.log(`  失败: ${failCount}`);
  console.log(`  墙钟总耗时: ${wallMs}ms`);
  console.log(`  平均上传耗时: ${avgUpload}ms`);
  console.log(`  平均全链路耗时: ${avgTotal}ms`);
  console.log(`  HTTP 5xx 总数: ${total5xx} ${total5xx === 0 ? '✅' : '❌'}`);
  console.log(`  各用户明细:`);
  results.forEach((r, i) => {
    console.log(`   用户${i + 1}: ${r.ok ? '✅' : '❌'} 状态=${r.status} 成功=${r.success} 失败=${r.failed} 上传=${r.uploadMs}ms 全链路=${r.totalMs}ms 5xx=${r.http5xx}`);
  });
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const pass = okCount === users && total5xx === 0;
  console.log(pass
    ? `\n✅ 并发压测通过：${users} 个用户全部成功，无 5xx`
    : `\n❌ 并发压测未全部通过`);
  process.exit(pass ? 0 : 1);
}

main();
