/** Logging UI, Ask Your Coach, form help and photo checks. */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockGenerateContent } = vi.hoisted(() => ({ mockGenerateContent: vi.fn() }));
vi.mock('@google/genai', () => ({
  Type: { OBJECT: 'OBJECT', ARRAY: 'ARRAY', STRING: 'STRING', INTEGER: 'INTEGER', NUMBER: 'NUMBER', BOOLEAN: 'BOOLEAN' },
  GoogleGenAI: vi.fn().mockImplementation(() => ({ models: { generateContent: mockGenerateContent } })),
}));

import App from '../App';
import { DEFAULT_PROFILE, loadCoachChat, loadWorkoutLogs, saveProfile, savePlan } from '../services/storage';
import { filterSafeExercises } from '../services/catalogFilter';
import { askCoach, generateAdaptivePlan } from '../services/geminiCoach';

beforeEach(() => {
  mockGenerateContent.mockReset();
});

const ok = (text) => ({ candidates: [{ finishReason: 'STOP' }], text });
async function seedPlan(profile = DEFAULT_PROFILE) {
  saveProfile(profile);
  savePlan(await generateAdaptivePlan(profile, filterSafeExercises(profile), '', 'm'));
}
const withKey = () => localStorage.setItem('mf_byok_gemini_api_key', 'AIza-test');
const openAsk = (user) => user.click(screen.getByRole('button', { name: /^Ask$/ }));

describe('Workout logging UI', () => {
  it('logs a session, then shows last time + a next-load tip, and persists it', async () => {
    await seedPlan();
    const user = userEvent.setup();
    const { unmount } = render(<App />);

    await user.click(screen.getAllByRole('button', { name: /Log sets/i })[0]);
    const form = document.querySelector('.log-form');
    const w = within(form).getByLabelText(/Set 1 weight in kg/i);
    await user.type(w, '20');
    await user.type(within(form).getByLabelText(/Set 1 reps/i), '10');
    await user.click(within(form).getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/Logged\. Nice work/i)).toBeInTheDocument();
    expect(screen.getByText(/Last time \(today\): 10×20 kg/)).toBeInTheDocument();
    const logs = loadWorkoutLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].sets).toEqual([{ reps: 10, weightKg: 20 }]);

    unmount();
    render(<App />); // survives a reload
    expect(screen.getByText(/Last time \(today\): 10×20 kg/)).toBeInTheDocument();
  });

  it('refuses an empty log and offers Remove last log', async () => {
    await seedPlan();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getAllByRole('button', { name: /Log sets/i })[0]);
    await user.click(within(document.querySelector('.log-form')).getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/at least one set/i);
    expect(loadWorkoutLogs()).toHaveLength(0);

    await user.type(screen.getByLabelText(/Set 1 reps/i), '8');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(await screen.findByRole('button', { name: /Remove last log/i }));
    expect(loadWorkoutLogs()).toHaveLength(0);
  });

  it('works in pounds: typed lb is stored as kg and shown back in lb', async () => {
    await seedPlan({ ...DEFAULT_PROFILE, unitSystem: 'imperial' });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getAllByRole('button', { name: /Log sets/i })[0]);
    await user.type(screen.getByLabelText(/Set 1 weight in lb/i), '45');
    await user.type(screen.getByLabelText(/Set 1 reps/i), '10');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(loadWorkoutLogs()[0].sets[0].weightKg).toBeCloseTo(20.41, 1);
    expect(await screen.findByText(/10×45 lb/)).toBeInTheDocument();
  });

  it('after hitting the top of the range on every set it suggests a heavier weight, pre-filled in the next log', async () => {
    await seedPlan();
    const user = userEvent.setup();
    render(<App />);
    const top = Number(document.querySelector('.rx-grid .rx-pill:nth-child(2) strong').textContent.split('–')[1]);
    const sets = Number(document.querySelector('.rx-grid .rx-pill:nth-child(1) strong').textContent);
    await user.click(screen.getAllByRole('button', { name: /Log sets/i })[0]);
    for (let i = 1; i <= sets; i++) {
      await user.type(screen.getByLabelText(new RegExp(`Set ${i} weight`)), '20');
      await user.clear(screen.getByLabelText(new RegExp(`Set ${i} reps`)));
      await user.type(screen.getByLabelText(new RegExp(`Set ${i} reps`)), String(top));
    }
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const tip = await screen.findByTestId('progress-tip');
    expect(tip).toHaveTextContent(/Go up to 2[12](\.5)? kg/);
    await user.click(screen.getByRole('button', { name: /Log this session/i }));
    expect(Number(screen.getByLabelText(/Set 1 weight/i).value)).toBeGreaterThan(20);
  });
});

describe('Ask Your Coach', () => {
  it('without a key it explains and offers to add one (no chat box)', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openAsk(user);
    expect(screen.getByText(/need your API key/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Your question/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Add API key/i }));
    expect(screen.getByLabelText(/Gemini API Key/i)).toBeInTheDocument();
  });

  it('sends the question with profile/plan/log context and keeps the conversation', async () => {
    withKey();
    await seedPlan();
    mockGenerateContent.mockResolvedValueOnce(ok('Yes, train light.\n- **Warm up** well\n- Keep it easy'));
    const user = userEvent.setup();
    render(<App />);
    await openAsk(user);
    await user.type(screen.getByLabelText(/Your question/i), 'Should I train sore?');
    await user.click(screen.getByRole('button', { name: /^Send$/ }));

    expect(await screen.findByText(/Yes, train light/)).toBeInTheDocument();
    expect(screen.getByText('Warm up').tagName).toBe('STRONG'); // bold rendered, no raw asterisks
    const req = mockGenerateContent.mock.calls[0][0];
    expect(req.config.systemInstruction).toMatch(/CONTEXT:[\s\S]*PROFILE:[\s\S]*CURRENT PLAN/);
    expect(req.contents.at(-1)).toMatchObject({ role: 'user', parts: [{ text: 'Should I train sore?' }] });
    expect(loadCoachChat().map((m) => m.role)).toEqual(['user', 'coach']);

    mockGenerateContent.mockResolvedValueOnce(ok('Second answer'));
    await user.type(screen.getByLabelText(/Your question/i), 'And tomorrow?');
    await user.click(screen.getByRole('button', { name: /^Send$/ }));
    await screen.findByText('Second answer');
    const roles = mockGenerateContent.mock.calls[1][0].contents.map((c) => c.role);
    expect(roles).toEqual(['user', 'model', 'user']);
  });

  it('on failure the question is removed from the chat and the draft comes back', async () => {
    withKey();
    mockGenerateContent.mockImplementation(() => Promise.reject(new Error('503 overloaded')));
    const user = userEvent.setup();
    render(<App />);
    await openAsk(user);
    await user.type(screen.getByLabelText(/Your question/i), 'Hello coach');
    await user.click(screen.getByRole('button', { name: /^Send$/ }));
    expect(await screen.findByText(/503 overloaded/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Your question/i)).toHaveValue('Hello coach');
    expect(loadCoachChat()).toEqual([]);
  });

  it('a reply that arrives after you switch tabs is still saved', async () => {
    withKey();
    let release;
    mockGenerateContent.mockImplementation(() => new Promise((r) => (release = r)));
    const user = userEvent.setup();
    render(<App />);
    await openAsk(user);
    await user.type(screen.getByLabelText(/Your question/i), 'Slow one');
    await user.click(screen.getByRole('button', { name: /^Send$/ }));
    await user.click(screen.getByRole('button', { name: /Exercises/i }));
    await act(async () => release(ok('Late but here')));
    await waitFor(() => expect(loadCoachChat().map((m) => m.text)).toContain('Late but here'));
    await openAsk(user);
    expect(screen.getByText('Late but here')).toBeInTheDocument();
  });

  it('Clear chat wipes it', async () => {
    withKey();
    localStorage.setItem('mf_coach_chat_v1', JSON.stringify([{ role: 'user', text: 'hi' }, { role: 'coach', text: 'hello' }]));
    const user = userEvent.setup();
    render(<App />);
    await openAsk(user);
    await user.click(screen.getByRole('button', { name: /Clear chat/i }));
    expect(loadCoachChat()).toEqual([]);
  });
});

describe('Form coaching', () => {
  it('Form help opens Ask focused on that exercise with a ready question and catalogue cues in context', async () => {
    withKey();
    await seedPlan();
    mockGenerateContent.mockResolvedValueOnce(ok('Brace and sit back.'));
    const user = userEvent.setup();
    render(<App />);
    const firstName = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent).find((t) => /^\d+\.\s/.test(t)).replace(/^\d+\.\s/, '');
    await user.click(screen.getAllByRole('button', { name: /Form help/i })[0]);
    expect(screen.getByText(`Focus: ${firstName}`)).toBeInTheDocument();
    expect(screen.getByLabelText(/Your question/i).value).toMatch(new RegExp(firstName));
    await user.click(screen.getByRole('button', { name: /^Send$/ }));
    await screen.findByText('Brace and sit back.');
    expect(mockGenerateContent.mock.calls[0][0].config.systemInstruction).toMatch(/FOCUS EXERCISE: .*Standard cues:/);
  });

  it('attaches a photo to the question (and only that one), shows it was sent, rejects non-images', async () => {
    withKey();
    mockGenerateContent.mockResolvedValue(ok('Looks solid, keep your chest up.'));
    const user = userEvent.setup({ applyAccept: false });
    render(<App />);
    await openAsk(user);
    const input = screen.getByLabelText('Attach photos');
    await user.upload(input, new File(['x'], 'doc.pdf', { type: 'application/pdf' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/JPEG, PNG, WebP or HEIC/);

    await user.upload(input, new File([new Uint8Array(200)], 'squat.png', { type: 'image/png' }));
    await user.click(await screen.findByRole('button', { name: /Remove photo 1/i }));
    await user.upload(input, new File([new Uint8Array(200)], 'squat.png', { type: 'image/png' }));
    await screen.findByRole('button', { name: /Remove photo 1/i });
    await user.type(screen.getByLabelText(/Your question/i), 'Check my squat');
    await user.click(screen.getByRole('button', { name: /^Send$/ }));
    await screen.findByText(/chest up/);

    const parts = mockGenerateContent.mock.calls[0][0].contents.at(-1).parts;
    expect(parts[1].inlineData).toMatchObject({ mimeType: 'image/png' });
    expect(parts[1].inlineData.data.length).toBeGreaterThan(10);
    expect(screen.getByText(/1 photo attached/)).toBeInTheDocument();
    expect(JSON.stringify(loadCoachChat())).not.toContain(parts[1].inlineData.data); // pixels never stored
    expect(screen.queryByRole('button', { name: /Remove photo/ })).not.toBeInTheDocument();
  });
});

describe('askCoach service', () => {
  const base = { profile: DEFAULT_PROFILE, plan: null, logs: [], apiKey: 'k', model: 'm' };
  it('needs a key and a trailing user question', async () => {
    await expect(askCoach({ ...base, apiKey: '', messages: [{ role: 'user', text: 'hi' }] })).rejects.toThrow(/API key/);
    await expect(askCoach({ ...base, messages: [{ role: 'user', text: 'hi' }, { role: 'coach', text: 'yo' }] })).rejects.toThrow(/question/);
  });
  it('drops a leading coach turn, caps history, puts photos only on the last turn', async () => {
    mockGenerateContent.mockResolvedValue(ok('fine'));
    const messages = [{ role: 'coach', text: 'welcome' }, ...Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'coach' : 'user', text: `m${i}`, photos: 1 }))].slice(0, 20);
    messages.push({ role: 'user', text: 'last' });
    await askCoach({ ...base, messages, photos: [{ mimeType: 'image/jpeg', data: 'AAAA' }] });
    const { contents } = mockGenerateContent.mock.calls[0][0];
    expect(contents[0].role).toBe('user');
    expect(contents.length).toBeLessThanOrEqual(12);
    expect(contents.slice(0, -1).every((c) => c.parts.length === 1)).toBe(true);
    expect(contents.at(-1).parts).toHaveLength(2);
  });
  it('retries one empty reply, then reports it', async () => {
    mockGenerateContent.mockResolvedValueOnce(ok('')).mockResolvedValueOnce(ok('second time lucky'));
    expect(await askCoach({ ...base, messages: [{ role: 'user', text: 'q' }] })).toBe('second time lucky');
    mockGenerateContent.mockReset();
    mockGenerateContent.mockResolvedValue(ok(''));
    await expect(askCoach({ ...base, messages: [{ role: 'user', text: 'q' }] })).rejects.toThrow(/empty reply/);
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });
  it('plan generation receives the training-log summary', async () => {
    const p = { ...DEFAULT_PROFILE, daysPerWeek: 3 };
    const safe = filterSafeExercises(p);
    mockGenerateContent.mockResolvedValue(ok('not json'));
    await generateAdaptivePlan(p, safe, 'k', 'm', [], '- Goblet Squat: 10x20 kg (2d ago)').catch(() => {});
    expect(mockGenerateContent.mock.calls[0][0].contents).toMatch(/Goblet Squat: 10x20 kg/);
  });
});
