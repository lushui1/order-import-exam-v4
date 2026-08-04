'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface RowData {
  rowIndex: number;
  data: Record<string, string>;
  errors: string[];
}

const FIELDS = [
  { key: 'externalCode', label: '外部编码' },
  { key: 'receiverStore', label: '收货门店' },
  { key: 'receiverName', label: '收件人姓名' },
  { key: 'receiverPhone', label: '收件人电话' },
  { key: 'receiverAddress', label: '收件人地址' },
  { key: 'skuCode', label: 'SKU编码' },
  { key: 'skuName', label: 'SKU名称' },
  { key: 'skuQuantity', label: '发货数量' },
  { key: 'skuSpec', label: '规格型号' },
  { key: 'remark', label: '备注' },
];

export default function PreviewPage() {
  const [rows, setRows] = useState<RowData[]>([]);
  const [importId, setImportId] = useState('');
  const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null);
  const [loading, setLoading] = useState('');
  const [errorRows, setErrorRows] = useState(0);
  const [totalRows, setTotalRows] = useState(0);
  const router = useRouter();

  useEffect(() => {
    const data = sessionStorage.getItem('parseResult');
    const id = sessionStorage.getItem('importId');
    if (data) {
      const parsed = JSON.parse(data);
      setRows(parsed.rows || []);
      setTotalRows(parsed.totalRows || 0);
      setErrorRows(parsed.errorRows || 0);
    }
    if (id) setImportId(id);
  }, []);

  const handleEdit = (rowIdx: number, field: string, value: string) => {
    setRows(prev => prev.map((r, i) => {
      if (i !== rowIdx) return r;
      const newData = { ...r.data, [field]: value };
      // 重新校验
      const errors = validateRow(newData);
      return { ...r, data: newData, errors };
    }));
  };

  const handleDeleteRow = (rowIdx: number) => {
    setRows(prev => prev.filter((_, i) => i !== rowIdx));
  };

  const handleAddRow = () => {
    setRows(prev => [...prev, {
      rowIndex: prev.length + 1,
      data: Object.fromEntries(FIELDS.map(f => [f.key, ''])),
      errors: [],
    }]);
  };

  const handleSubmit = async () => {
    const errors = rows.filter(r => r.errors.length > 0);
    if (errors.length > 0) {
      alert(`还有 ${errors.length} 条错误数据，请先修正`);
      return;
    }

    setLoading('提交中...');
    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importId }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      alert(data.message);
      router.push('/imports');
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading('');
    }
  };

  const handleExport = () => {
    // 导出为Excel
    const XLSX = require('xlsx');
    const ws = XLSX.utils.json_to_sheet(rows.map(r => r.data));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '运单数据');
    XLSX.writeFile(wb, `运单导出_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const errCount = rows.filter(r => r.errors.length > 0).length;

  return (
    <div style={{ minHeight: '100vh', padding: '24px 20px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        {/* 头部 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--primary)' }}>数据预览</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 4 }}>
              共 {totalRows} 条 · 错误 {errCount} 条
            </p>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button className="btn-outline" onClick={handleAddRow}>+ 新增行</button>
            <button className="btn-outline" onClick={handleExport}>📥 导出Excel</button>
            <button
              className="btn-primary"
              onClick={handleSubmit}
              disabled={!!loading || errCount > 0}
            >
              {loading || '✅ 提交下单'}
            </button>
          </div>
        </div>

        {/* 错误汇总 */}
        {errCount > 0 && (
          <div style={{
            background: 'var(--error-bg)',
            border: '1px solid #ffccc7',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 16,
          }}>
            <p style={{ color: 'var(--error)', fontWeight: 500, marginBottom: 8 }}>
              ⚠️ {errCount} 条数据有错误，请修正后再提交：
            </p>
            {rows.filter(r => r.errors.length > 0).slice(0, 5).map((r, i) => (
              <p key={i} style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                行 {r.rowIndex}: {r.errors.join('；')}
              </p>
            ))}
            {errCount > 5 && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>...还有 {errCount - 5} 条</p>}
          </div>
        )}

        {/* 数据表格 */}
        <div className="table-container" style={{ maxHeight: '70vh', overflow: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 50 }}>#</th>
                {FIELDS.map(f => (
                  <th key={f.key}>{f.label}</th>
                ))}
                <th style={{ width: 80 }}>状态</th>
                <th style={{ width: 60 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIdx) => (
                <tr key={rowIdx}>
                  <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{row.rowIndex}</td>
                  {FIELDS.map(f => {
                    const isErr = row.errors.some(e => e.includes(f.label));
                    const isEditing = editingCell?.row === rowIdx && editingCell?.col === f.key;
                    return (
                      <td
                        key={f.key}
                        className={`${isErr ? 'cell-error' : ''} cell-editable`}
                        onClick={() => setEditingCell({ row: rowIdx, col: f.key })}
                      >
                        {isEditing ? (
                          <input
                            autoFocus
                            className="input"
                            value={row.data[f.key] || ''}
                            onChange={(e) => handleEdit(rowIdx, f.key, e.target.value)}
                            onBlur={() => setEditingCell(null)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Tab') setEditingCell(null); }}
                            style={{ padding: '4px 8px', fontSize: 13 }}
                          />
                        ) : (
                          <span>{row.data[f.key] || <span style={{ color: 'var(--text-muted)' }}>-</span>}</span>
                        )}
                      </td>
                    );
                  })}
                  <td style={{ textAlign: 'center' }}>
                    {row.errors.length > 0 ? (
                      <span className="tag tag-error" title={row.errors.join('\n')}>错误</span>
                    ) : (
                      <span style={{ color: 'var(--success)' }}>✓</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      onClick={() => handleDeleteRow(rowIdx)}
                      style={{ color: 'var(--error)', background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {rows.length === 0 && (
          <div className="empty-state">
            <p style={{ fontSize: 48, marginBottom: 12 }}>📭</p>
            <p>暂无数据，请先上传文件并解析</p>
          </div>
        )}
      </div>
    </div>
  );
}

function validateRow(data: Record<string, string>): string[] {
  const errors: string[] = [];
  const hasA = !!(data.receiverStore);
  const hasB = !!(data.receiverName && data.receiverPhone && data.receiverAddress);
  if (!hasA && !hasB) errors.push('收货信息缺失：需填写收货门店或收件人姓名+电话+地址');
  if (!data.skuCode) errors.push('SKU编码不能为空');
  if (!data.skuName) errors.push('SKU名称不能为空');
  if (!data.skuQuantity) errors.push('发货数量不能为空');
  if (data.skuQuantity && (isNaN(Number(data.skuQuantity)) || Number(data.skuQuantity) <= 0)) {
    errors.push('发货数量必须为正数');
  }
  if (data.receiverPhone && !/^1[3-9]\d{9}$/.test(data.receiverPhone.replace(/\s/g, ''))) {
    errors.push('收件人电话格式不正确');
  }
  return errors;
}
