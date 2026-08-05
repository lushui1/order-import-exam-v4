'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';

interface ErrorItem {
  id: string;
  unit_id: string | null;
  batch_index: number;
  row_number: number;
  field_name: string;
  raw_value: string | null;
  error_code: string;
  error_reason: string;
  trace_id: string | null;
  created_at: string;
}

export default function TaskErrorsPage() {
  const params = useParams();
  const taskId = String(params.id);
  const [errors, setErrors] = useState<ErrorItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [batch, setBatch] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [loading, setLoading] = useState(false);
  const pageSize = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (batch) qs.set('batch', batch);
      if (errorCode) qs.set('error_code', errorCode);
      const res = await fetch(`/api/import-tasks/${taskId}/errors?${qs}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setErrors(data.errors || []);
      setTotal(data.total || 0);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  }, [taskId, page, batch, errorCode]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div style={{ minHeight: '100vh', padding: '24px 20px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--primary)' }}>❌ 错误明细</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
              task_id: <code>{taskId}</code> · 共 {total} 条错误 · 敏感字段已脱敏
            </p>
          </div>
          <a href={`/tasks/${taskId}`} style={{ color: 'var(--primary)' }}>← 返回任务</a>
        </div>

        {/* 筛选（PRD 模块六：按批次/错误类型筛选） */}
        <div className="card" style={{ padding: 16, marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
          <input
            className="input"
            placeholder="批次号（如 3）"
            value={batch}
            onChange={(e) => { setBatch(e.target.value); setPage(1); }}
            style={{ width: 140, padding: '8px 12px' }}
          />
          <select
            className="input"
            value={errorCode}
            onChange={(e) => { setErrorCode(e.target.value); setPage(1); }}
            style={{ width: 160, padding: '8px 12px' }}
          >
            <option value="">全部错误码</option>
            <option value="E001">E001 SKU不存在</option>
            <option value="E002">E002 必填缺失</option>
            <option value="E003">E003 电话格式错误</option>
            <option value="E004">E004 数量非正数</option>
            <option value="E005">E005 外部编码重复</option>
            <option value="E006">E006 规则映射失败</option>
            <option value="E007">E007 写入失败</option>
            <option value="E008">E008 文件格式不支持</option>
          </select>
          <button className="btn-outline" onClick={() => { setPage(1); load(); }} disabled={loading}>
            {loading ? '查询中...' : '查询'}
          </button>
        </div>

        {/* 错误表 */}
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-muted)', background: '#fafafa' }}>
                <th style={{ padding: '10px 12px' }}>行号</th>
                <th style={{ padding: '10px 12px' }}>批次</th>
                <th style={{ padding: '10px 12px' }}>字段</th>
                <th style={{ padding: '10px 12px' }}>原始值(脱敏)</th>
                <th style={{ padding: '10px 12px' }}>错误码</th>
                <th style={{ padding: '10px 12px' }}>错误原因</th>
              </tr>
            </thead>
            <tbody>
              {errors.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>暂无错误记录</td></tr>
              ) : errors.map(e => (
                <tr key={e.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 12px' }}>{e.row_number}</td>
                  <td style={{ padding: '10px 12px' }}>{e.batch_index}</td>
                  <td style={{ padding: '10px 12px' }}><code>{e.field_name}</code></td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>{e.raw_value || '-'}</td>
                  <td style={{ padding: '10px 12px' }}><span className="tag tag-error">{e.error_code}</span></td>
                  <td style={{ padding: '10px 12px' }}>{e.error_reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 分页（PRD 模块六：支持分页加载） */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 16, alignItems: 'center' }}>
          <button className="btn-outline" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>
            ← 上一页
          </button>
          <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>{page} / {totalPages}</span>
          <button className="btn-outline" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
            下一页 →
          </button>
        </div>
      </div>
    </div>
  );
}
