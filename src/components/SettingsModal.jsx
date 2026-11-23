import React, { useEffect, useRef, useState } from 'react';
import { testGeminiConnection } from '../services/geminiCoach';
import { exportBackupJson, importBackupJson } from '../services/storage';

const MODEL_PRESETS = [
  { id: 'gemini-3.8-flash', label: 'gemini-3.8-flash (Fast Default)' },
  { id: 'gemini-3.5-flash-lite', label: 'gemini-3.5-flash-lite (Ultra-Light)' },
  { id: 'gemini-3.1-pro-preview', label: 'gemini-3.1-pro-preview (Deep Reasoning)' },
  { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash (Legacy Flash)' },
];

export default function SettingsModal({
  open,
  onClose,
  apiKey,
  model,
  onSaveSettings,
  onDataImported,
}) {
  const [draftKey, setDraftKey] = useState(apiKey);
  const [draftModel, setDraftModel] = useState(model);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [statusType, setStatusType] = useState('neutral');
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setDraftKey(apiKey);
      setDraftModel(model);
      setStatusMsg('');
    }
  }, [open, apiKey, model]);

  if (!open) return null;

  const isCustomModel = !MODEL_PRESETS.some((m) => m.id === draftModel);

  const handleSave = () => {
    onSaveSettings(draftKey.trim(), draftModel.trim() || 'gemini-3.8-flash');
    setStatusType('success');
    setStatusMsg('Saved locally on this device.');
  };

  const handleTest = async () => {
    setTesting(true);
    setStatusMsg('');
    try {
      const reply = await testGeminiConnection(draftKey.trim(), draftModel.trim());
      setStatusType('success');
      setStatusMsg(`Connected to ${draftModel}: "${reply}"`);
      onSaveSettings(draftKey.trim(), draftModel.trim());
    } catch (err) {
      setStatusType('error');
      setStatusMsg(err?.message || 'Connection failed. Check your API key or model ID.');
    } finally {
      setTesting(false);
    }
  };

  const handleExport = () => {
    const json = exportBackupJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `repwise-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusType('success');
    setStatusMsg('Exported profile & routine JSON (API key excluded).');
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const restored = importBackupJson(text);
      onDataImported(restored);
      setStatusType(restored.skipped?.length ? 'error' : 'success');
      setStatusMsg(
        restored.skipped?.length
          ? `Backup restored, but skipped unusable data: ${restored.skipped.join(', ')}. Your existing ${restored.skipped.join(' / ')} was kept.`
          : 'Backup restored successfully.'
      );
    } catch {
      setStatusType('error');
      setStatusMsg('Invalid backup JSON file.');
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>BYOK AI Settings & Backup</h2>
            <p className="muted">Stored strictly in your browser&apos;s localStorage. Zero servers.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="form-group">
          <label htmlFor="gemini-key">Google AI Studio — Gemini API Key</label>
          <div className="input-row">
            <input
              id="gemini-key"
              type={showKey ? 'text' : 'password'}
              placeholder="AIzaSy..."
              value={draftKey}
              onChange={(e) => setDraftKey(e.target.value)}
              autoComplete="off"
            />
            <button
              type="button"
              className="secondary-btn"
              onClick={() => setShowKey((s) => !s)}
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <small className="muted">
            Leave empty to use the built-in Local Fallback Engine. Tip: restrict your key to your deployed URL in Google Cloud Console.
          </small>
        </div>

        <div className="form-group">
          <label htmlFor="gemini-model">Gemini Model</label>
          <select
            id="gemini-model"
            value={isCustomModel ? '__custom__' : draftModel}
            onChange={(e) => {
              if (e.target.value !== '__custom__') {
                setDraftModel(e.target.value);
              } else {
                setDraftModel('');
              }
            }}
          >
            {MODEL_PRESETS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            <option value="__custom__">Custom Model ID...</option>
          </select>

          {isCustomModel && (
            <input
              type="text"
              placeholder="Enter exact Gemini model ID (e.g. gemini-3.8-flash)"
              value={draftModel}
              onChange={(e) => setDraftModel(e.target.value)}
              style={{ marginTop: '8px' }}
            />
          )}
        </div>

        <div className="button-row">
          <button type="button" className="primary-btn" onClick={handleSave}>
            Save Settings
          </button>
          <button
            type="button"
            className="secondary-btn"
            onClick={handleTest}
            disabled={testing || !draftKey.trim()}
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
        </div>

        {statusMsg && (
          <div className={`status-banner status-${statusType}`}>{statusMsg}</div>
        )}

        <hr className="divider" />

        <div className="backup-section">
          <h3>Data Backup (Log-Ready Schema)</h3>
          <p className="muted">
            Export your profile, routine, and feedback as JSON. Your API key is never included in exports.
          </p>
          <div className="button-row">
            <button type="button" className="secondary-btn" onClick={handleExport}>
              Export JSON Backup
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              Restore JSON
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              style={{ display: 'none' }}
              onChange={handleImportFile}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
