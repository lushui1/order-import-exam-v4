'use client';

import { useEffect, useState, useCallback } from 'react';

interface Percentiles { p50: number; p95: number; p99: number; }
interface StageDuration {
  parse: Percentiles;
  rule: Percentiles;
  validate: Percentiles;
  insert: Percentiles;
  total: Percentiles;
}
interface ErrorDist { error_code: string; count: number; }
interface TaskDist { status: string; count: number; }
interface SlowBatch { task_id: string; unit_id: string; batch_index: number; total_duration_ms: number; }
interface ThroughputPoint { minute: string; rows: number; }
interface RecentErrorTask { task_id: string; file_name: string; failed_rows: number; }

interface MonitorData {
  throughput_per_minute: ThroughputPoint[];
  queue_backlog_rows: number;
  queue_backlog_warning: boolean;
  recent_error_tasks?: RecentErrorTask[];
  stage_duration_ms: StageDuration;
  error_distribution: ErrorDist[];
  task_distribution: TaskDist[];
  slow_batches_top10: SlowBatch[];
  degraded_tasks: number;
  failed_tasks_24h: number;
  failed_tasks_24h_warning: boolean;
}

const ERROR_LABEL: Record<string, string> = {
  E001: 'SKU不存在',
  E002: '必填缺失',
  E003: '电话格式',
  E004: '数量非正数',
  E005: '外部编码重复',
  E006: '规则映射失败',
  E007: '写入失败',
  E008: '格式不支持',
};

const STATUS_LABEL: Record<string, string> = {
  pending: '等待',
  processing: '处理中',
  completed: '完成',
  partial_success: '部分成功',
  failed: '失败',
};

export default function MonitorPage() {
  const [data, setData] = useState<MonitorData | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/import-monitor/summary');
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      setData(d);
    } catch (err: any) {
      setError(err.message || '加载失败');
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  if (error) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--error)' }}>监控加载失败：{error}</div>;
  if (!data) return <div style={{ padding: 40, textAlign: 'center' }}>加载中...</div>;

  const maxRows = Math.max(...data.throughput_per_minute.map(p => p.rows), 1);
  const errorTotal = data.error_distribution.reduce((s, e) => s + e.count, 0);

  const durationRows = [
    { label: '解析', key: 'parse' as const },
    { label: '规则', key: 'rule' as const },
    { label: '校验', key: 'validate' as const },
    { label: '写入', key: 'insert' as const },
    { label: '总耗时', key: 'total' as const },
  ];

  return (
    <div style={{ minHeight: '100vh', padding: '24px 20px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--primary)' }}>📊 导入监控看板</h1>
          <a href="/" style={{ color: 'var(--primary)' }}>← 返回首页</a>
        </div>

        {/* 告警条 */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <div className={`card ${data.queue_backlog_warning ? 'tag-error' : ''}`} style={{
            padding: '14px 16px', flex: 1,
            border: data.queue_backlog_warning ? '1px solid var(--error)' : undefined,
            background: data.queue_backlog_warning ? 'var(--error-bg)' : undefined,
          }}>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>队列积压</p>
            <p style={{ fontSize: 20, fontWeight: 700, color: data.queue_backlog_warning ? 'var(--error)' : 'var(--text-secondary)' }}>
              {data.queue_backlog_rows} 批
              {data.queue_backlog_warning && ' ⚠️ 超过阈值'}
            </p>
          </div>
          <div className="card" style={{ padding: '14px 16px', flex: 1 }}>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>降级任务</p>
            <p style={{ fontSize: 20, fontWeight: 700, color: data.degraded_tasks > 0 ? '#ad6800' : 'var(--text-secondary)' }}>
              {data.degraded_tasks} 个
            </p>
          </div>
          <div className={`card ${data.failed_tasks_24h_warning ? 'tag-error' : ''}`} style={{
            padding: '14px 16px', flex: 1,
            border: data.failed_tasks_24h_warning ? '1px solid var(--error)' : undefined,
            background: data.failed_tasks_24h_warning ? 'var(--error-bg)' : undefined,
          }}>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>近 24h 失败任务</p>
            <p style={{ fontSize: 20, fontWeight: 700, color: data.failed_tasks_24h_warning ? 'var(--error)' : 'var(--text-secondary)' }}>
              {data.failed_tasks_24h} 个
              {data.failed_tasks_24h_warning && ' ⚠️ 需处理'}
            </p>
          </div>
        </div>

        {/* 1. 实时吞吐量（近5分钟，柱状图） */}
        <div className="card" style={{ padding: 20, marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>实时吞吐量（近 5 分钟，行/分钟）</h2>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, height: 140, padding: '0 8px' }}>
            {data.throughput_per_minute.map((p, i) => (
              <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ height: 110, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                  <div style={{
                    width: '70%',
                    height: `${Math.max((p.rows / maxRows) * 100, 3)}%`,
                    background: 'var(--primary)',
                    borderRadius: '6px 6px 0 0',
                    transition: 'height .5s',
                  }} />
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>{p.minute}</p>
                <p style={{ fontSize: 12, fontWeight: 600 }}>{p.rows}</p>
              </div>
            ))}
          </div>
        </div>

        {/* 2. 阶段耗时分布 */}
        <div className="card" style={{ padding: 20, marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>阶段耗时分布（ms）</h2>
          <table style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                <th style={{ padding: '6px 8px' }}>阶段</th>
                <th style={{ padding: '6px 8px' }}>P50</th>
                <th style={{ padding: '6px 8px' }}>P95</th>
                <th style={{ padding: '6px 8px' }}>P99</th>
              </tr>
            </thead>
            <tbody>
              {durationRows.map(r => (
                <tr key={r.key}>
                  <td style={{ padding: '6px 8px' }}>{r.label}</td>
                  <td style={{ padding: '6px 8px' }}>{data.stage_duration_ms[r.key].p50}</td>
                  <td style={{ padding: '6px 8px' }}>{data.stage_duration_ms[r.key].p95}</td>
                  <td style={{ padding: '6px 8px' }}>{data.stage_duration_ms[r.key].p99}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          {/* 3. 错误类型分布 */}
          <div className="card" style={{ padding: 20 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>错误类型分布（共 {errorTotal} 条）</h2>
            {data.error_distribution.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>暂无错误</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {data.error_distribution.map(e => {
                  const pct = errorTotal > 0 ? Math.round((e.count / errorTotal) * 100) : 0;
                  // PRD 模块八：错误类型分布可点击跳转到错误明细（最近有该错误的任务）
                  const targetTask = (data.recent_error_tasks || [])[0];
                  const detailHref = targetTask
                    ? `/tasks/${targetTask.task_id}/errors?error_code=${encodeURIComponent(e.error_code)}`
                    : '/monitor';
                  return (
                    <div key={e.error_code}>
                      <a href={detailHref} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                          <span><code>{e.error_code}</code> {ERROR_LABEL[e.error_code] || ''} {targetTask && '→'}</span>
                          <span style={{ color: 'var(--text-muted)' }}>{e.count} ({pct}%)</span>
                        </div>
                        <div style={{ background: 'var(--border)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--primary)' }} />
                        </div>
                      </a>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 4. 任务状态分布 + 慢批次 */}
          <div className="card" style={{ padding: 20 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>任务状态分布</h2>
            {data.task_distribution.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>暂无任务</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.task_distribution.map(t => (
                  <div key={t.status} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span>{STATUS_LABEL[t.status] || t.status}</span>
                    <span style={{ color: 'var(--text-secondary)' }}>{t.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 加分：慢批次 TOP10 */}
        <div className="card" style={{ padding: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>慢批次 TOP 10</h2>
          {data.slow_batches_top10.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>暂无性能日志</p>
          ) : (
            <table style={{ width: '100%', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '6px 8px' }}>批次</th>
                  <th style={{ padding: '6px 8px' }}>任务</th>
                  <th style={{ padding: '6px 8px' }}>耗时(ms)</th>
                </tr>
              </thead>
              <tbody>
                {data.slow_batches_top10.map((b, i) => (
                  <tr key={i}>
                    <td style={{ padding: '6px 8px' }}>#{b.batch_index}</td>
                    <td style={{ padding: '6px 8px' }}><code>{b.task_id}</code></td>
                    <td style={{ padding: '6px 8px' }}>{b.total_duration_ms}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
