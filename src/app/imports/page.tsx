'use client';

import { useState, useEffect } from 'react';

export default function ImportsPage() {
  const [imports, setImports] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ externalCode: '', receiverName: '' });
  const [selectedImport, setSelectedImport] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/imports?type=history').then(r => r.json()).then(setImports);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (selectedImport) params.set('importId', selectedImport);
    if (filters.externalCode) params.set('externalCode', filters.externalCode);
    if (filters.receiverName) params.set('receiverName', filters.receiverName);

    fetch(`/api/imports?${params}`).then(r => r.json()).then(data => {
      setOrders(data.orders || []);
      setTotal(data.total || 0);
    });
  }, [page, selectedImport, filters]);

  return (
    <div style={{ minHeight: '100vh', padding: '40px 20px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--primary)' }}>📋 已导入运单</h1>
          <a href="/" style={{ color: 'var(--primary)' }}>← 返回首页</a>
        </div>

        {/* 导入历史 */}
        <div className="card" style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>导入历史</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {imports.map(imp => (
              <div
                key={imp.id}
                onClick={() => setSelectedImport(imp.id === selectedImport ? null : imp.id)}
                style={{
                  padding: '12px 16px',
                  border: `2px solid ${selectedImport === imp.id ? 'var(--primary)' : 'var(--border)'}`,
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: selectedImport === imp.id ? 'var(--primary-light)' : '#fff',
                }}
              >
                <p style={{ fontWeight: 500, fontSize: 14 }}>{imp.fileName}</p>
                <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                  {imp._count?.orders || 0} 条 · {new Date(imp.createdAt).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* 筛选 */}
        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', gap: 16 }}>
            <input
              className="input"
              placeholder="搜索外部编码"
              value={filters.externalCode}
              onChange={(e) => setFilters(prev => ({ ...prev, externalCode: e.target.value }))}
              style={{ maxWidth: 250 }}
            />
            <input
              className="input"
              placeholder="搜索收件人姓名"
              value={filters.receiverName}
              onChange={(e) => setFilters(prev => ({ ...prev, receiverName: e.target.value }))}
              style={{ maxWidth: 250 }}
            />
          </div>
        </div>

        {/* 运单列表 */}
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>外部编码</th>
                <th>收货门店</th>
                <th>收件人</th>
                <th>电话</th>
                <th>地址</th>
                <th>SKU编码</th>
                <th>SKU名称</th>
                <th>数量</th>
                <th>规格</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order: any) => (
                <tr key={order.id}>
                  <td>{order.externalCode || '-'}</td>
                  <td>{order.receiverStore || '-'}</td>
                  <td>{order.receiverName || '-'}</td>
                  <td>{order.receiverPhone || '-'}</td>
                  <td>{order.receiverAddress || '-'}</td>
                  <td>{order.skuCode}</td>
                  <td>{order.skuName}</td>
                  <td>{order.skuQuantity}</td>
                  <td>{order.skuSpec || '-'}</td>
                  <td>
                    {order.hasError ? (
                      <span className="tag tag-error" title={order.errorMsg}>错误</span>
                    ) : (
                      <span style={{ color: 'var(--success)' }}>✓</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 分页 */}
        {total > 20 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 24 }}>
            <button
              className="btn-outline"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              上一页
            </button>
            <span style={{ lineHeight: '36px', color: 'var(--text-muted)' }}>
              第 {page} 页 / 共 {Math.ceil(total / 20)} 页
            </span>
            <button
              className="btn-outline"
              onClick={() => setPage(p => p + 1)}
              disabled={page >= Math.ceil(total / 20)}
            >
              下一页
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
