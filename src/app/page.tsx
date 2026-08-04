'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const [file, setFile] = useState<File | null>(null);
  const [rules, setRules] = useState<any[]>([]);
  const [selectedRule, setSelectedRule] = useState<any>(null);
  const [aiRule, setAiRule] = useState<any>(null);
  const [loading, setLoading] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // 加载规则列表
  useEffect(() => {
    fetch('/api/rules').then(r => r.json()).then(setRules).catch(() => {});
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file || loading) return;
    setLoading('上传中...');

    try {
      const fd = new FormData();
      fd.append('file', file);
      if (selectedRule) fd.append('ruleId', selectedRule.id);

      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();

      if (data.error) throw new Error(data.error);

      // 如果有选中的规则，直接解析
      if (selectedRule) {
        await parseWithRule(data.importId, JSON.parse(selectedRule.ruleJson));
      } else {
        // 跳转到规则配置页
        sessionStorage.setItem('uploadData', JSON.stringify(data));
        router.push('/rules');
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading('');
    }
  };

  const parseWithRule = async (importId: string, rule: any) => {
    setLoading('解析中...');

    const res = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ importId, rule }),
    });
    const data = await res.json();

    if (data.error) throw new Error(data.error);

    sessionStorage.setItem('parseResult', JSON.stringify(data));
    sessionStorage.setItem('importId', importId);
    router.push('/preview');
  };

  const handleAIGenerate = async () => {
    if (!file) return;
    setLoading('AI分析中...');

    try {
      const fd = new FormData();
      fd.append('file', file);

      const res = await fetch('/api/ai-generate', { method: 'POST', body: fd });
      const data = await res.json();

      if (data.error) throw new Error(data.error);

      setAiRule(data.rule);
      alert('AI已生成规则，请在下方查看并确认');
    } catch (err: any) {
      alert('AI分析失败: ' + err.message);
    } finally {
      setLoading('');
    }
  };

  return (
    <div style={{ minHeight: '100vh', padding: '40px 20px' }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        {/* 标题 */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--primary)', marginBottom: 8 }}>
            万能导入 V2
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 15 }}>
            智能多格式批量下单系统 — AI规则引擎
          </p>
        </div>

        {/* 上传区 */}
        <div className="card" style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>📁 上传文件</h2>

          <div
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            style={{
              border: `2px dashed ${dragActive ? 'var(--primary)' : 'var(--border)'}`,
              borderRadius: 12,
              padding: '48px 24px',
              textAlign: 'center',
              cursor: 'pointer',
              background: dragActive ? 'var(--primary-light)' : 'transparent',
              transition: 'all .2s',
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.docx,.pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              style={{ display: 'none' }}
            />
            {file ? (
              <div>
                <p style={{ fontSize: 16, fontWeight: 500 }}>{file.name}</p>
                <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
                  {(file.size / 1024).toFixed(1)} KB
                </p>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: 48, marginBottom: 8 }}>📄</p>
                <p style={{ fontSize: 15 }}>拖拽文件到此处，或点击选择</p>
                <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
                  支持 Excel (.xlsx/.xls)、Word (.docx)、PDF
                </p>
              </div>
            )}
          </div>
        </div>

        {/* 规则选择 */}
        <div className="card" style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>⚙️ 解析规则</h2>

          {rules.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
              {rules.map(rule => (
                <div
                  key={rule.id}
                  onClick={() => setSelectedRule(rule)}
                  style={{
                    padding: '12px 16px',
                    border: `2px solid ${selectedRule?.id === rule.id ? 'var(--primary)' : 'var(--border)'}`,
                    borderRadius: 8,
                    cursor: 'pointer',
                    background: selectedRule?.id === rule.id ? 'var(--primary-light)' : '#fff',
                    minWidth: 200,
                  }}
                >
                  <p style={{ fontWeight: 500, fontSize: 14 }}>{rule.name}</p>
                  <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>
                    {rule.fileType} · {new Date(rule.updatedAt).toLocaleDateString()}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>暂无已保存的规则</p>
          )}

          <div style={{ display: 'flex', gap: 12 }}>
            <button
              className="btn-outline"
              onClick={handleAIGenerate}
              disabled={!file || !!loading}
            >
              🤖 AI自动分析生成规则
            </button>
          </div>

          {/* AI生成的规则预览 */}
          {aiRule && (
            <div style={{
              marginTop: 16,
              padding: 16,
              background: 'var(--primary-light)',
              borderRadius: 8,
              border: '1px solid #b5e8e8',
            }}>
              <p style={{ fontWeight: 500, marginBottom: 8 }}>🤖 AI生成的规则：</p>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                名称: {aiRule.name}
              </p>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                映射字段: {aiRule.mappings?.length || 0} 个
              </p>
              <div style={{ marginTop: 8 }}>
                <button
                  className="btn-primary"
                  onClick={() => {
                    setSelectedRule({ ruleJson: JSON.stringify(aiRule), name: aiRule.name });
                    alert('已选择AI规则，点击"开始导入"执行');
                  }}
                >
                  使用此规则
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        <div style={{ textAlign: 'center' }}>
          <button
            className="btn-primary"
            onClick={handleUpload}
            disabled={!file || !!loading}
            style={{ padding: '12px 40px', fontSize: 16 }}
          >
            {loading ? (
              <span><span className="spinner" style={{ marginRight: 8 }} />{loading}</span>
            ) : '开始导入'}
          </button>
        </div>

        {/* 导航 */}
        <div style={{ textAlign: 'center', marginTop: 32 }}>
          <a href="/imports" style={{ color: 'var(--primary)', marginRight: 24 }}>📋 已导入运单</a>
          <a href="/rules" style={{ color: 'var(--primary)' }}>⚙️ 规则管理</a>
        </div>
      </div>
    </div>
  );
}
