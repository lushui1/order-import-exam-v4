'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';

interface BatchInfo {
  unit_id: string;
  batch_index: number;
  status: string;
  retry_count: number;
  start_row: number;
  end_row: number;
  completed_at: string | null;
}

interface TaskDetail {
  task_id: string;
  trace_id: string;
  file_name: string;
  status: string;
  total_rows: number;
  processed_rows: number;
  success_rows: number;
  failed_rows: number;
  total_batches: number;
  completed_batches: number;
  throughput: number;
  estimated_remaining_seconds: number;
  degraded: boolean;
  degraded_reason: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  batches: BatchInfo[];
  recent_errors: { row: number; code: string; reason: string }[];
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: '等待处理',
  PROCESSING: '处理中',
  COMPLETED: '已完成',
  PARTIAL_SUCCESS: '部分成功',
  FAILED: '失败',
};

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = String(params.id);
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [processing, setProcessing] = useState(false);
  const [processMsg, setProcessMsg] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoTriggeredRef = useRef(false);

  // 立即处理：无 Redis/Worker 环境下手动触发消费（调用 /process 端点）
  const handleProcess = async () => {
    if (processing) return;
    setProcessing(true);
    setProcessMsg('正在处理...');
    try {
      const res = await fetch(`/api/import-tasks/${taskId}/process`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '处理失败');
      setProcessMsg(`已处理 ${data.processed} 个批次（剩余 ${data.failed_batches} 个失败），请观察进度刷新`);
      load();
    } catch (err: any) {
      setProcessMsg('处理失败: ' + (err.message || '未知错误'));
    } finally {
      setProcessing(false);
    }
  };

  // 自动触发一次消费：进入任务页即开始处理（PRD 模块四 Worker 异步消费；
  // 生产环境部署常驻 Worker 后由 Worker 消费，本自动触发作为无 Worker 环境兜底，幂等安全）
  useEffect(() => {
    if (!task || autoTriggeredRef.current) return;
    if (['COMPLETED', 'PARTIAL_SUCCESS', 'FAILED'].includes(task.status)) return;
    if (task.processed_rows > 0) return; // 已在处理中，无需再触发
    autoTriggeredRef.current = true;
    handleProcess();
  }, [task]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/import-tasks/${taskId}`);
      if (res.status === 404) {
        setError('任务不存在');
        return;
      }
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setTask(data);
      // 任务进入终态后停止轮询与计时，避免无谓请求和"已用时间"持续增长
      if (['COMPLETED', 'PARTIAL_SUCCESS', 'FAILED'].includes(data.status)) {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        if (clockRef.current) { clearInterval(clockRef.current); clockRef.current = null; }
      }
    } catch (err: any) {
      setError(err.message || '加载失败');
    }
  }, [taskId]);

  useEffect(() => {
    load();
    // 轮询 1.5 秒刷新（PRD 模块七：建议 1~2 秒）
    timerRef.current = setInterval(load, 1500);
    clockRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (clockRef.current) clearInterval(clockRef.current);
    };
  }, [load]);

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <h1 style={{ fontSize: 20, marginBottom: 12 }}>任务查询失败</h1>
        <p style={{ color: 'var(--error)' }}>{error}</p>
        <button className="btn-outline" style={{ marginTop: 16 }} onClick={() => router.push('/')}>返回首页</button>
      </div>
    );
  }

  if (!task) {
    return <div style={{ padding: 40, textAlign: 'center' }}>加载中...</div>;
  }

  const progressPct = task.total_rows > 0
    ? Math.min(100, Math.round((task.processed_rows / task.total_rows) * 100))
    : 0;

  return (
    <div style={{ minHeight: '100vh', padding: '24px 20px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--primary)' }}>📦 导入任务进度</h1>
          <a href="/" style={{ color: 'var(--primary)' }}>← 返回首页</a>
        </div>

        {/* 任务概览 */}
        <div className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <p style={{ fontSize: 18, fontWeight: 600 }}>{task.file_name}</p>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
                task_id: <code>{task.task_id}</code> · trace_id: <code>{task.trace_id}</code>
              </p>
            </div>
            <span className="tag tag-primary" style={{ fontSize: 14 }}>
              {STATUS_LABEL[task.status] || task.status}
            </span>
          </div>

          {/* 无 Worker 环境提示 + 立即处理按钮 */}
          {!['COMPLETED', 'PARTIAL_SUCCESS', 'FAILED'].includes(task.status) && (
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 8, padding: '10px 14px', marginBottom: 12,
            }}>
              <p style={{ color: '#ad4e00', fontSize: 13 }}>
                ℹ️ 任务在后台等待处理。若未部署常驻 Worker，可点击右侧按钮手动触发消费。
              </p>
              <button
                className="btn-primary"
                onClick={handleProcess}
                disabled={processing}
                style={{ padding: '6px 16px', fontSize: 13, whiteSpace: 'nowrap' }}
              >
                {processing ? '处理中...' : '⚡ 立即处理'}
              </button>
            </div>
          )}
          {processMsg && (
            <p style={{ fontSize: 13, marginBottom: 8, color: processMsg.startsWith('处理失败') ? 'var(--error)' : 'var(--success)' }}>
              {processMsg}
            </p>
          )}

          {/* 进度条 */}
          <div style={{ background: 'var(--border)', borderRadius: 8, height: 12, overflow: 'hidden', marginBottom: 8 }}>
            <div
              style={{
                width: `${progressPct}%`,
                height: '100%',
                background: task.degraded ? '#faad14' : 'var(--primary)',
                transition: 'width .5s',
              }}
            />
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            {task.processed_rows} / {task.total_rows} 行 ({progressPct}%)
          </p>

          {/* 降级提示（PRD 模块十：必须明确标注） */}
          {task.degraded && (
            <div style={{
              background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 8, padding: '10px 14px', marginTop: 12,
            }}>
              <p style={{ color: '#ad6800', fontSize: 13 }}>
                ⚠️ SKU 校验已降级：本次导入未经过商品主数据完整校验，数据可能需要后续复核。
                {task.degraded_reason ? `（原因：${task.degraded_reason}）` : ''}
              </p>
            </div>
          )}
          {task.error_message && (
            <div style={{ background: 'var(--error-bg)', borderRadius: 8, padding: '10px 14px', marginTop: 12 }}>
              <p style={{ color: 'var(--error)', fontSize: 13 }}>❌ {task.error_message}</p>
            </div>
          )}
        </div>

        {/* 统计指标 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
          {[
            { label: '成功行', value: task.success_rows, color: 'var(--success)' },
            { label: '失败行', value: task.failed_rows, color: task.failed_rows > 0 ? 'var(--error)' : 'var(--text-muted)' },
            { label: '批次完成', value: `${task.completed_batches}/${task.total_batches}`, color: 'var(--text-secondary)' },
            { label: '吞吐(行/分)', value: task.throughput, color: 'var(--text-secondary)' },
            { label: '预计剩余', value: task.estimated_remaining_seconds > 0 ? `${task.estimated_remaining_seconds}s` : '-', color: 'var(--text-secondary)' },
            // 已用时间：以 started_at（真实开始处理时间）为基准 ——
            // 终态 = completed_at - started_at；非终态 = now - started_at（实时计时）；
            // 尚未开始处理（无 started_at）显示 '-'，避免把排队等待时间算进处理耗时
            { label: '已用时间', value: task.started_at
              ? `${Math.max(0, Math.round(((
                task.completed_at
                  ? new Date(task.completed_at).getTime()
                  : now
              ) - new Date(task.started_at).getTime()) / 1000))}s`
              : '-', color: 'var(--text-secondary)' },
          ].map(s => (
            <div key={s.label} className="card" style={{ padding: '14px 16px' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 4 }}>{s.label}</p>
              <p style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* 最近错误摘要 + 查看明细 */}
        <div className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600 }}>最近错误</h2>
            {task.failed_rows > 0 && (
              <a href={`/tasks/${taskId}/errors`} style={{ color: 'var(--primary)', fontSize: 14 }}>
                查看全部错误明细（{task.failed_rows}）→
              </a>
            )}
          </div>
          {task.recent_errors.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>暂无错误</p>
          ) : (
            <table style={{ width: '100%', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '6px 8px' }}>行号</th>
                  <th style={{ padding: '6px 8px' }}>错误码</th>
                  <th style={{ padding: '6px 8px' }}>原因</th>
                </tr>
              </thead>
              <tbody>
                {task.recent_errors.map((e, i) => (
                  <tr key={i}>
                    <td style={{ padding: '6px 8px' }}>{e.row}</td>
                    <td style={{ padding: '6px 8px' }}><span className="tag tag-error">{e.code}</span></td>
                    <td style={{ padding: '6px 8px' }}>{e.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 批次明细 */}
        <div className="card" style={{ padding: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>处理单元（批次）明细</h2>
          <table style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                <th style={{ padding: '6px 8px' }}>批次</th>
                <th style={{ padding: '6px 8px' }}>处理单元</th>
                <th style={{ padding: '6px 8px' }}>行范围</th>
                <th style={{ padding: '6px 8px' }}>状态</th>
                <th style={{ padding: '6px 8px' }}>重试</th>
                <th style={{ padding: '6px 8px' }}>完成时间</th>
              </tr>
            </thead>
            <tbody>
              {task.batches.map(b => (
                <tr key={b.unit_id}>
                  <td style={{ padding: '6px 8px' }}>#{b.batch_index}</td>
                  <td style={{ padding: '6px 8px' }}><code>{b.unit_id}</code></td>
                  <td style={{ padding: '6px 8px' }}>{b.start_row} ~ {b.end_row}</td>
                  <td style={{ padding: '6px 8px' }}>
                    <span className={`tag ${b.status === 'COMPLETED' ? 'tag-success' : b.status === 'PROCESSING' ? '' : 'tag-error'}`}>
                      {STATUS_LABEL[b.status] || b.status}
                    </span>
                  </td>
                  <td style={{ padding: '6px 8px' }}>{b.retry_count}</td>
                  <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>
                    {b.completed_at ? new Date(b.completed_at).toLocaleTimeString() : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
