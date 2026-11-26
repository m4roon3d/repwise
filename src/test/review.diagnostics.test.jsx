/** Gemini usage tracking, the Diagnostics screen and housekeeping actions. */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockGenerateContent } = vi.hoisted(() => ({ mockGenerateContent: vi.fn() }));
vi.mock('@google/genai', () => ({
  Type: { OBJECT: 'OBJECT', ARRAY: 'ARRAY', STRING: 'STRING', INTEGER: 'INTEGER', NUMBER: 'NUMBER', BOOLEAN: 'BOOLEAN' },
  GoogleGenAI: vi.fn().mockImplementation(() => ({ models: { generateContent: mockGenerateContent } })),
}));

import App from '../App';
import { loadUsage, summarizeUsage, estimateCost, describeCall, recordCall, clearUsage } from '../services/usage';
import { askCoach, testGeminiConnection } from '../services/geminiCoach';
import { DEFAULT_PROFILE, loadWorkoutLogs, saveWorkoutLogs, storageReport, loadOnboarded } from '../services/storage';

beforeEach(() => {
  mockGenerateContent.mockReset();
  vi.stubGlobal('confirm', () => true);
});
const ok = (text, usage = { promptTokenCount: 1200, candidatesTokenCount: 300, thoughtsTokenCount: 100, totalTokenCount: 1600 }) => ({
  candidates: [{ finishReason: 'STOP' }],
  text,
  usageMetadata: usage,
});

describe('usage tracking', () => {
  it('logs each Gemini call with feature, model, tokens and time, including failures', async () => {
    mockGenerateContent.mockResolvedValueOnce(ok('Hi')).mockRejectedValueOnce(new Error('429 quota for key AIzaSyAAAAAAAAAAAAAAAAAAAA'));
    await askCoach({ messages: [{ role: 'user', text: 'q' }], profile: DEFAULT_PROFILE, apiKey: 'k', model: 'gemini-x' });
    await expect(testGeminiConnection('k', 'gemini-x')).rejects.toThrow();
    const [a, b] = loadUsage();
    expect(a).toMatchObject({ feature: 'ask', model: 'gemini-x', ok: true, inTok: 1200, outTok: 300, thinkTok: 100, totalTok: 1600 });
    expect(b).toMatchObject({ feature: 'test_connection', ok: false });
    expect(b.error).toMatch(/429/);
    expect(b.error).not.toMatch(/AIza/); // keys are scrubbed from error text
    expect(JSON.stringify(loadUsage())).not.toMatch(/"q"|Hi/); // no prompts or replies stored
  });

  it('summarises by window and feature, and estimates cost from entered prices', () => {
    const now = Date.parse('2026-11-26T12:00:00');
    const day = 86400000;
    const mk = (ts, feature, inTok, outTok, ok = true) => ({ ts, feature, ok, inTok, outTok, thinkTok: 0, totalTok: inTok + outTok, ms: 1000 });
    const list = [mk(now - 40 * day, 'plan', 9e6, 9e6), mk(now - 2 * day, 'plan', 10000, 2000), mk(now - 1000, 'ask', 1000, 500), mk(now - 500, 'ask', 0, 0, false)];
    const s = summarizeUsage(list, { days: 30, now });
    expect(s).toMatchObject({ calls: 3, errors: 1, inTok: 11000, outTok: 2500, todayCalls: 2 });
    expect(s.byFeature[0]).toMatchObject({ feature: 'plan', calls: 1, totalTok: 12000 });
    expect(estimateCost(s, { input: 0.3, output: 2.5 })).toBeCloseTo((11000 * 0.3 + 2500 * 2.5) / 1e6);
    expect(estimateCost(s, {})).toBeNull();
  });

  it('caps the log', () => {
    for (let i = 0; i < 510; i++) recordCall(describeCall({ feature: 'ask', model: 'm', started: Date.now(), response: {} }));
    expect(loadUsage()).toHaveLength(500);
    clearUsage();
    expect(loadUsage()).toEqual([]);
  });
});

describe('Diagnostics screen', () => {
  const open = async (user) => {
    await user.click(screen.getByRole('button', { name: /API Key|Gemini Connected/ }));
    await user.click(screen.getByRole('button', { name: /Open diagnostics/i }));
  };

  it('opens from Settings and shows usage by feature, recent calls and storage', async () => {
    localStorage.setItem('mf_byok_gemini_api_key', 'AIza-test-1234');
    recordCall({ ts: Date.now(), feature: 'plan', model: 'gemini-x', ms: 4200, ok: true, inTok: 20000, outTok: 6000, thinkTok: 0, totalTok: 26000, finish: 'STOP', error: '' });
    recordCall({ ts: Date.now(), feature: 'ask', model: 'gemini-x', ms: 900, ok: false, inTok: 0, outTok: 0, thinkTok: 0, totalTok: 0, finish: 'ERROR', error: '503 overloaded' });
    const user = userEvent.setup();
    render(<App />);
    await open(user);
    expect(screen.getByRole('heading', { name: /Usage & diagnostics/ })).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Plan generation')).toBeInTheDocument();
    expect(within(table).getByText('26.0k')).toBeInTheDocument();
    expect(screen.getByText('503 overloaded')).toBeInTheDocument();
    expect(screen.getByText(/ends in 1234/)).toBeInTheDocument();
    expect(screen.queryByText(/AIza-test-1234/)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/Input, \$ per 1M/), '0.3');
    await user.type(screen.getByLabelText(/Output, \$ per 1M/), '2.5');
    expect(screen.getByText('$0.02')).toBeInTheDocument();
  });

  it('housekeeping: clear one data area, clear the usage log, re-run setup', async () => {
    localStorage.setItem('mf_profile_v1', JSON.stringify({ ...DEFAULT_PROFILE, name: 'Ramanaa' }));
    saveWorkoutLogs([{ id: 'a', ts: Date.now(), exercise_id: 'goblet_squat', sets: [{ reps: 8, weightKg: 20 }] }]);
    recordCall({ ts: Date.now(), feature: 'ask', model: 'm', ms: 1, ok: true, inTok: 1, outTok: 1, thinkTok: 0, totalTok: 2 });
    const user = userEvent.setup();
    render(<App />);
    await open(user);
    expect(storageReport().areas.find((a) => a.key === 'WORKOUT_LOGS').bytes).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /Clear Workout logs/ }));
    expect(loadWorkoutLogs()).toEqual([]);
    expect(screen.getByRole('status')).toHaveTextContent(/Workout logs cleared/);
    await user.click(screen.getByRole('button', { name: /Clear usage log/ }));
    expect(loadUsage()).toEqual([]);
    expect(screen.queryByRole('button', { name: /Clear Profile/ })).not.toBeInTheDocument(); // profile can't be wiped here
    await user.click(screen.getByRole('button', { name: /Re-run guided setup/ }));
    expect(loadOnboarded()).toBe(false); // even though a profile is saved
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('region', { name: /Guided setup/ })).toBeInTheDocument();
  });
});
