import React, { useState } from 'react';
import { runCoachIntakeTurn } from '../services/geminiCoach';
import { ChatIcon } from './Icons';

const INITIAL_MESSAGES = [
  {
    role: 'assistant',
    text: 'Hey! Tell me about your goals, training experience, sleep, any tight joints, and schedule—and I’ll auto-tune your profile below.',
  },
];

export default function CoachIntakeChat({
  profile,
  onApplyPatch,
  onGenerateNow,
  apiKey,
  model,
  loadingPlan,
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [readyToGenerate, setReadyToGenerate] = useState(false);
  const [lastUpdatedFields, setLastUpdatedFields] = useState([]);
  const [chatError, setChatError] = useState('');

  const handleSend = async (e) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    const nextMessages = [...messages, { role: 'user', text: trimmed }];
    setMessages(nextMessages);
    setInput('');
    setSending(true);
    setChatError('');

    try {
      const result = await runCoachIntakeTurn(nextMessages, profile, apiKey, model);
      setMessages((prev) => [...prev, { role: 'assistant', text: result.coach_reply }]);
      setReadyToGenerate(Boolean(result.ready_to_generate));

      const patch = result.profile_patch || {};
      const updatedLabels = onApplyPatch(patch);
      if (updatedLabels.length > 0) {
        setLastUpdatedFields(updatedLabels);
      }
    } catch (err) {
      setChatError(err?.message || 'Coach chat failed. Check your Gemini key in Settings.');
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="card chat-card">
      <div className="card-head">
        <div>
          <h2 className="title-with-icon"><ChatIcon size={18} /><span>AI Coach Chat Intake</span></h2>
          <p className="muted">
            Prefer talking it out? Chat with your coach to auto-fill vitals, joint flags, and notes.
          </p>
        </div>
        <button
          type="button"
          className="secondary-btn"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Hide Chat' : 'Start Chat'}
        </button>
      </div>

      {open && (
        <div className="chat-body">
          <div className="chat-thread">
            {messages.map((m, idx) => (
              <div key={idx} className={`chat-bubble chat-${m.role}`}>
                <span className="chat-role">{m.role === 'user' ? 'You' : 'Coach'}</span>
                <p>{m.text}</p>
              </div>
            ))}
            {sending && (
              <div className="chat-bubble chat-assistant">
                <span className="chat-role">Coach</span>
                <p className="muted">Thinking & updating your profile...</p>
              </div>
            )}
          </div>

          {lastUpdatedFields.length > 0 && (
            <div className="status-banner status-success">
              <span>Auto-updated profile: {lastUpdatedFields.join(', ')}</span>
            </div>
          )}

          {chatError && <div className="status-banner status-error">{chatError}</div>}

          <form className="chat-form" onSubmit={handleSend}>
            <input
              type="text"
              placeholder='e.g., "Sleeping 6 hrs, right shoulder clicks overhead, 3x/wk for 40 min"'
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={sending}
            />
            <button type="submit" className="primary-btn" disabled={sending || !input.trim()}>
              Send
            </button>
          </form>

          {readyToGenerate && (
            <button
              type="button"
              className="primary-btn full-width"
              style={{ marginTop: '10px' }}
              onClick={onGenerateNow}
              disabled={loadingPlan}
            >
              {loadingPlan ? 'Building Your Block...' : '✨ Build My Tailored Block From Chat'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
