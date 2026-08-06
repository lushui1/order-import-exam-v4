'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const [file, setFile] = useState<File | null>(null);
  const [rules, setRules] = useState<any[]>([]);
  const [rulesError, setRulesError] = useState('');
  const [selectedRule, setSelectedRule] = useState<any>(null);
  const [aiRule, setAiRule] = useState<any>(null);
  const [loading, setLoading] = useState('');
  const [dragActive, setDragActive] = useState(false);
  // 内联提示（替代 alert 弹窗）
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // 加载规则列表
  useEffect(() => {
    fetch('/api/rules')
      .then(r => {
        if (!r.ok) throw new Error(`加载失败(${r.status})`);
        return r.json();
      })
      .then(setRules)
      .catch((err) => setRulesError(err.message || '规则加载失败'));
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  };

  // PRD 模块二：上传即返回 task_id，不同步等待解析完成
  const handleUpload = async () => {
    if (!file || loading) return;
    setLoading('创建任务中...');

    try {
      let ruleId: string | null = null;
      // AI 生成的规则（未保存）先保存，获得 ruleId
      if (aiRule && !selectedRule) {
        const saveRes = await fetch('/api/rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: aiRule.name || 'AI生成规则',
            fileType: aiRule.fileType || 'excel',
            ruleJson: JSON.stringify(aiRule),
          }),
        });
        const saved = await saveRes.json();
        if (!saveRes.ok) throw new Error(saved.error || '规则保存失败');
        ruleId = saved.id;
      } else if (selectedRule) {
        ruleId = selectedRule.id;
      }

      const fd = new FormData();
      fd.append('file', file);
      if (ruleId) fd.append('ruleId', ruleId);

      const res = await fetch('/api/import-tasks', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || '任务创建失败');

      // 进入任务进度页
      router.push(`/tasks/${data.task_id}`);
    } catch (err: any) {
      setNotice({ type: 'err', text: err.message || '上传失败' });
    } finally {
      setLoading('');
    }
  };

  const handleAIGenerate = async () => {
    if (!file) return;
    setLoading('AI分析中...');
    setNotice(null);

    try {
      const fd = new FormData();
      fd.append('file', file);

      const res = await fetch('/api/ai-generate', { method: 'POST', body: fd });
      const data = await res.json();

      if (data.error) throw new Error(data.error);

      setAiRule(data.rule);
      setNotice({ type: 'ok', text: 'AI 规则生成成功，请确认下方规则后点击"开始导入"' });
    } catch (err: any) {
      setNotice({ type: 'err', text: 'AI 分析失败: ' + (err.message || '未知错误') });
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
            万能导入 V4
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 15 }}>
            异步事件驱动批量导入系统 — 上传即返回，后台异步处理
          </p>
        </div>

        {/* 内联提示（替代 alert 弹窗） */}
        {notice && (
          <div style={{
            marginBottom: 20,
            padding: '12px 16px',
            borderRadius: 8,
            background: notice.type === 'ok' ? 'var(--success-bg, #f6ffed)' : 'var(--error-bg)',
            border: `1px solid ${notice.type === 'ok' ? '#b7eb8f' : '#ffccc7'}`,
            color: notice.type === 'ok' ? '#389e0d' : 'var(--error)',
            fontSize: 14,
          }}>
            {notice.type === 'ok' ? '✅ ' : '⚠️ '}{notice.text}
          </div>
        )}

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
                <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 2 }}>
                  {(file.size / 1024).toFixed(1)} KB
                </p>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: 48, marginBottom: 8 }}>📄</p>
                <p style={{ fontSize: 15 }}>拖拽文件到此处，或点击选择</p>
                <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
                  支持 Excel (.xlsx/.xls)、Word (.docx)、PDF · 最大 10MB
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
                  onClick={() => { setSelectedRule(rule); setAiRule(null); }}
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
          ) : rulesError ? (
            <p style={{ color: 'var(--error)', marginBottom: 16 }}>
              ⚠️ 规则加载失败：{rulesError}
            </p>
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
                名称: {aiRule.name} · 映射字段: {aiRule.mappings?.length || 0} 个
              </p>
              <div style={{ marginTop: 8 }}>
                <button
                  className="btn-primary"
                  onClick={() => {
                    setSelectedRule(null);
                    setNotice({ type: 'ok', text: '已选择AI规则，点击"开始导入"执行' });
                  }}
                >
                  使用此规则
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 操作按钮：防重复点击 */}
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
          <a href="/rules" style={{ color: 'var(--primary)', marginRight: 24 }}>⚙️ 规则管理</a>
          <a href="/monitor" style={{ color: 'var(--primary)', marginRight: 24 }}>📊 监控看板</a>
          <a href="/traces" style={{ color: 'var(--primary)' }}>🔍 Trace 检索</a>
        </div>
      </div>
    </div>
  );
}
