// 引擎设置对话框（首启配置模型/端点/密钥）
import React, { useEffect, useState } from 'react';

const modalStyle = {
  position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,.45)',
  display: 'grid', placeItems: 'center',
};

export default function SettingsModal({ onClose }) {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { window.amc.config.get().then(setCfg); }, []);
  if (!cfg) return null;

  const set = (k, v) => setCfg({ ...cfg, engine: { ...cfg.engine, [k]: v } });
  const field = (label, k, ph, type = 'text') => (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, marginBottom: 6, color: 'var(--text-2)' }}>{label}</label>
      <input className="proj-name-input" type={type} placeholder={ph} value={cfg.engine[k] || ''}
        onChange={(e) => set(k, e.target.value)} />
    </div>
  );

  const save = async () => {
    setSaving(true);
    await window.amc.config.save(cfg);
    await window.amc.engine.restart();
    setSaving(false);
    onClose();
  };

  return (
    <div style={modalStyle} onClick={onClose}>
      <div className="welcome-card" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>引擎设置</div>
        {field('模型名称', 'model', 'DeepSeek-V4-Flash')}
        {field('API 地址（OpenAI 兼容）', 'baseUrl', 'https://…/v1')}
        {field('API Key', 'apiKey', 'sk-…', 'password')}
        {field('上下文窗口（token）', 'contextWindow', '1000000', 'number')}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" disabled={saving} onClick={save}>
            {saving ? '保存并重启引擎…' : '保存并重启引擎'}
          </button>
        </div>
      </div>
    </div>
  );
}
