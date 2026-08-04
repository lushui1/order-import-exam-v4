'use client';

import { useState, useEffect } from 'react';

export default function RulesPage() {
  const [rules, setRules] = useState<any[]>([]);
  const [editingRule, setEditingRule] = useState<any>(null);
  const [ruleJson, setRuleJson] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchRules();
  }, []);

  const fetchRules = async () => {
    const res = await fetch('/api/rules');
    setRules(await res.json());
  };

  const handleSave = async () => {
    try {
      const parsed = JSON.parse(ruleJson);
      setLoading(true);

      const res = await fetch('/api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingRule?.id,
          name: parsed.name || '未命名规则',
          description: parsed.description || '',
          fileType: parsed.fileType || 'excel',
          ruleJson: parsed,
        }),
      });

      if (res.ok) {
        setEditingRule(null);
        setRuleJson('');
        fetchRules();
      }
    } catch (err: any) {
      alert('JSON格式错误: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此规则？')) return;
    await fetch(`/api/rules?id=${id}`, { method: 'DELETE' });
    fetchRules();
  };

  const handleEdit = (rule: any) => {
    setEditingRule(rule);
    setRuleJson(JSON.stringify(JSON.parse(rule.ruleJson), null, 2));
  };

  return (
    <div style={{ minHeight: '100vh', padding: '40px 20px' }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--primary)' }}>⚙️ 解析规则管理</h1>
          <a href="/" style={{ color: 'var(--primary)' }}>← 返回首页</a>
        </div>

        {/* 规则列表 */}
        <div className="card" style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>已保存的规则</h2>

          {rules.length === 0 ? (
            <div className="empty-state">
              <p>暂无规则，上传文件时可让AI自动生成</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {rules.map(rule => (
                <div
                  key={rule.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '16px',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                  }}
                >
                  <div>
                    <p style={{ fontWeight: 500 }}>{rule.name}</p>
                    <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 2 }}>
                      {rule.fileType} · 更新于 {new Date(rule.updatedAt).toLocaleString()}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-outline" onClick={() => handleEdit(rule)}>编辑</button>
                    <button className="btn-danger" onClick={() => handleDelete(rule.id)}>删除</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 规则编辑器 */}
        {editingRule && (
          <div className="card">
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>
              编辑规则: {editingRule.name}
            </h2>

            <textarea
              value={ruleJson}
              onChange={(e) => setRuleJson(e.target.value)}
              style={{
                width: '100%',
                height: 400,
                fontFamily: 'monospace',
                fontSize: 13,
                padding: 16,
                border: '1px solid var(--border)',
                borderRadius: 8,
                resize: 'vertical',
              }}
            />

            <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
              <button className="btn-primary" onClick={handleSave} disabled={loading}>
                {loading ? '保存中...' : '保存'}
              </button>
              <button className="btn-outline" onClick={() => { setEditingRule(null); setRuleJson(''); }}>
                取消
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
