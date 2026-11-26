import React, { useEffect, useRef, useState } from 'react';
import { EXERCISE_MAP } from '../services/catalogFilter';
import { MAX_PHOTOS, prepareImage } from '../services/images';
import { SAFETY_SHORT } from './HealthNotice';

const STARTERS = [
  'Why is my plan set up this way?',
  "I'm sore today. Should I still train?",
  'How do I know when to add weight?',
];

// Minimal safe renderer: **bold** and "- " / "* " bullets, no HTML injection.
function Rich({ text }) {
  return text.split('\n').map((line, i) => {
    const bullet = /^\s*[-*•]\s+/.test(line);
    const body = line.replace(/^\s*[-*•]\s+/, '');
    const parts = body.split(/\*\*(.+?)\*\*/g).map((p, j) => (j % 2 ? <strong key={j}>{p}</strong> : p));
    return (
      <p key={i} className={bullet ? 'chat-bullet' : undefined} style={{ margin: '0 0 6px' }}>
        {bullet ? '• ' : ''}
        {parts}
      </p>
    );
  });
}

export default function AskCoach({ apiKey, chat, busy, error, focus, onClearFocus, onAsk, onClearChat, onOpenSettings }) {
  const [input, setInput] = useState('');
  const [photos, setPhotos] = useState([]);
  const [photoError, setPhotoError] = useState('');
  const fileRef = useRef(null);
  const endRef = useRef(null);
  const focusName = focus?.exerciseId ? EXERCISE_MAP[focus.exerciseId]?.name : '';

  useEffect(() => {
    if (focus?.draft) setInput(focus.draft);
  }, [focus?.nonce, focus?.draft]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [chat.length, busy]);

  const send = async (e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    const sentPhotos = photos;
    setInput('');
    setPhotos([]);
    setPhotoError('');
    const ok = await onAsk(text, sentPhotos, focus?.exerciseId);
    if (!ok) {
      setInput((prev) => prev || text);
      setPhotos((prev) => (prev.length ? prev : sentPhotos));
    }
  };

  const pickPhotos = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    setPhotoError('');
    const room = MAX_PHOTOS - photos.length;
    if (files.length > room) setPhotoError(`You can attach up to ${MAX_PHOTOS} photos.`);
    const next = [];
    for (const f of files.slice(0, Math.max(0, room))) {
      try {
        next.push(await prepareImage(f));
      } catch (err) {
        setPhotoError(err.message);
      }
    }
    if (next.length) setPhotos((prev) => [...prev, ...next].slice(0, MAX_PHOTOS));
  };

  if (!apiKey) {
    return (
      <section className="card">
        <h2>Ask Your Coach</h2>
        <p className="muted">
          Open questions and photo form checks use Gemini, so they need your API key. Your plan, logging and progress
          suggestions all work without one.
        </p>
        <button type="button" className="primary-btn" onClick={onOpenSettings}>Add API key</button>
      </section>
    );
  }

  return (
    <section className="card ask-card">
      <div className="card-head">
        <div>
          <h2>Ask Your Coach</h2>
          <p className="muted">Questions about your plan, form, soreness or progress. It sees your profile, plan and recent logs.</p>
        </div>
        {chat.length > 0 && (
          <button type="button" className="secondary-btn" onClick={onClearChat} disabled={busy}>Clear chat</button>
        )}
      </div>

      <div className="chat-log" role="log" aria-live="polite" aria-label="Conversation with your coach">
        {chat.length === 0 && (
          <div className="chip-row">
            {STARTERS.map((s) => (
              <button key={s} type="button" className="chip chip-active" onClick={() => setInput(s)}>{s}</button>
            ))}
          </div>
        )}
        {chat.map((m, i) => (
          <div key={i} className={`chat-bubble ${m.role === 'user' ? 'chat-user' : 'chat-coach'}`}>
            <Rich text={m.text} />
            {m.photos > 0 && <small className="muted">📷 {m.photos} photo{m.photos > 1 ? 's' : ''} attached</small>}
          </div>
        ))}
        {busy && <div className="chat-bubble chat-coach muted">Coach is thinking…</div>}
        <div ref={endRef} />
      </div>

      {error && <div className="status-banner status-error" role="alert">{error}</div>}

      {focusName && (
        <div className="chip-row" style={{ marginBottom: '8px' }}>
          <span className="chip">Focus: {focusName}</span>
          <button
            type="button"
            className="chip chip-active"
            onClick={() => {
              setInput(`Can you check my form on the ${focusName}? Photo attached.`);
              fileRef.current?.click();
            }}
          >
            Check my form (photo)
          </button>
          <button type="button" className="chip" onClick={onClearFocus} aria-label="Clear exercise focus">✕</button>
        </div>
      )}

      <form onSubmit={send} className="ask-form">
        <textarea
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything about your training…"
          aria-label="Your question"
          maxLength={1500}
        />
        {photos.length > 0 && (
          <div className="chip-row">
            {photos.map((p, i) => (
              <button
                key={i}
                type="button"
                className="chip chip-active"
                onClick={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                aria-label={`Remove photo ${i + 1}`}
              >
                📷 {i + 1} ✕
              </button>
            ))}
          </div>
        )}
        {photoError && <div className="status-banner status-error" role="alert">{photoError}</div>}
        <div className="button-row">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={pickPhotos}
            aria-label="Attach photos"
          />
          <button
            type="button"
            className="secondary-btn"
            onClick={() => fileRef.current?.click()}
            disabled={busy || photos.length >= MAX_PHOTOS}
          >
            📷 Attach photo
          </button>
          <button type="submit" className="primary-btn" disabled={busy || !input.trim()}>
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
        <p className="muted" style={{ fontSize: '0.78rem' }}>
          For a form check: shoot side-on, whole body in frame, at the hardest point of the lift. Photos go to Google
          Gemini with your question and are not stored in this app.
        </p>
      </form>
      <p className="muted" style={{ fontSize: '0.78rem' }}>{SAFETY_SHORT}</p>
    </section>
  );
}
