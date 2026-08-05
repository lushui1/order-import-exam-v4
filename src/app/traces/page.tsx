'use client';

import { useState, useCallback } from 'react';

interface TraceEvent {
  id: string;
  task_id: string | null;
  unit_id: string | null;
  event_name: string;
  event_status: string;
  message: string | null;
  occurred_at: string;
}

interface TraceResult {
  trace_id: string;
  task_id?: string;
  events: TraceEvent[];
}

export default function TracesPage() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<TraceResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // PRD 模块九：按 task_id 或 trace_id 检索，时间线展示
  const search = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/traces/${encodeURIComponent(q.trim())}`);
      if (res.status === 404) {
        setError('未找到该 Trace（支持输入 trace_id 或 task_id）');
        setResult(null);
        return;
      }
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult(data);
    } catch (err: any) {
      setError(err.message || '查询失败');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div style={{ minHeight: '100vh', padding: '24px 20px' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--primary)' }}>🔍 全链路 Trace 检索</h1>
          <a href="/" style={{ color: 'var(--primary)' }}>← 返回首页</a>
        </div>

        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
          按 <code>trace_id</code> 或 <code>task_id</code> 检索，查看任务从创建到完成的完整事件时间线。
          点击失败节点可定位批次、行号、字段和错误原因（详见任务详情页的错误明细）。
        </p>

        {/* 搜索框 */}
        <div className="card" style={{ padding: 16, marginBottom: 20, display: 'flex', gap: 12 }}>
          <input
            className="input"
            placeholder="输入 trace_id 或 task_id，如 trace_xxx / task_xxx"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') search(query); }}
            style={{ flex: 1, padding: '10px 14px' }}
          />
          <button className="btn-primary" onClick={() => search(query)} disabled={loading || !query.trim()}>
            {loading ? '查询中...' : '检索'}
          </button>
        </div>

        {error && <p style={{ color: 'var(--error)', marginBottom: 16 }}>⚠️ {error}</p>}

        {/* 时间线 */}
        {result && (
          <div className="card" style={{ padding: 20 }}>
            <p style={{ fontSize: 14, marginBottom: 16 }}>
              Trace: <code>{result.trace_id}</code>
              {result.task_id && <> · 任务: <code>{result.task_id}</code></>}
            </p>
            <div style={{ borderLeft: '3px solid var(--primary)', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {result.events.map((e, i) => (
                <div key={e.id || i} style={{ position: 'relative' }}>
                  {/* 时间线节点 */}
                  <div style={{
                    position: 'absolute', left: -27, top: 4,
                    width: 10, height: 10, borderRadius: '50%',
                    background: e.event_status === 'error' ? 'var(--error)'
                      : e.event_status === 'warn' ? '#faad14' : 'var(--primary)',
                  }} />
                  <div style={{
                    background: e.event_status === 'error' ? 'var(--error-bg)'
                      : e.event_status === 'warn' ? '#fffbe6' : 'transparent',
                    borderRadius: 8,
                    padding: e.event_status === 'error' || e.event_status === 'warn' ? '8px 12px' : '0',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>
                        {e.event_name}
                        {e.event_status === 'error' && ' ❌'}
                        {e.event_status === 'warn' && ' ⚠️'}
                      </span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                        {new Date(e.occurred_at).toLocaleTimeString('zh-CN', { hour12: false })}
                      </span>
                    </div>
                    {e.unit_id && (
                      <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>
                        处理单元: <code>{e.unit_id}</code>
                      </p>
                    )}
                    {e.message && <p style={{ fontSize: 13, marginTop: 4 }}>{e.message}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!result && !error && (
          <div className="card" style={{ padding: 40, textAlign: 'center' }}>
            <p style={{ fontSize: 40, marginBottom: 8 }}>🔍</p>
            <p style={{ color: 'var(--text-muted)' }}>输入 trace_id 或 task_id 查看全链路事件时间线</p>
          </div>
        )}
      </div>
    </div>
  );
}
