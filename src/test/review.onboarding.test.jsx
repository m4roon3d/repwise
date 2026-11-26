/** The guided first-run journey, the profile extras, "Why this plan", blood report upload and person switching. */
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
import { loadPlan, loadProfile } from '../services/storage';
import { PARQ_QUESTIONS } from '../services/health';

beforeEach(() => mockGenerateContent.mockReset());
const fresh = () => localStorage.removeItem('mf_onboarded_v1');
const ok = (obj) => ({ candidates: [{ finishReason: 'STOP' }], text: JSON.stringify(obj) });
const next = (user) => user.click(screen.getByRole('button', { name: /^Next$/ }));

async function answerParq(user, yesFor = []) {
  for (const q of PARQ_QUESTIONS) {
    const group = screen.getByRole('group', { name: q.text });
    await user.click(within(group).getByRole('button', { name: yesFor.includes(q.id) ? 'Yes' : 'No' }));
  }
}

describe('guided setup', () => {
  it('walks a new person from name to a plan with its reasons', async () => {
    fresh();
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole('region', { name: /Guided setup/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Next$/ })).toBeDisabled(); // name required
    await user.type(screen.getByLabelText(/What should we call you/i), 'Asha');
    await user.selectOptions(screen.getByLabelText(/Sex/i), 'female');
    await next(user);

    await user.click(screen.getByRole('button', { name: '4' }));
    await next(user);

    // Health: must answer all seven
    expect(screen.getByRole('button', { name: /^Next$/ })).toBeDisabled();
    await answerParq(user, ['boneJoint']);
    await user.click(screen.getByRole('button', { name: /High blood pressure/i }));
    expect(screen.getByText(/quick check with your doctor/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Pregnancy or recent birth/i)).toBeInTheDocument(); // shown for female
    await next(user);

    await user.click(screen.getByRole('button', { name: 'Wrist: Sore now' }));
    await next(user);

    // Extras: fitness test, then about you
    await user.type(screen.getByLabelText(/Push-ups \(reps\)/i), '6');
    await user.type(screen.getByLabelText(/chair stand/i), '13');
    await user.click(screen.getByRole('button', { name: /Save test results/i }));
    await user.click(screen.getByRole('tab', { name: /About you/i }));
    await user.type(screen.getByLabelText(/success look like/i), 'carry groceries up the stairs easily');
    await user.click(screen.getByRole('button', { name: /Continue/ }));

    expect(screen.getByText(/You're all set, Asha/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Build my plan/i }));

    expect(await screen.findByText('Week 1')).toBeInTheDocument();
    const plan = loadPlan();
    expect(plan.weeks[0].days).toHaveLength(4);
    const all = plan.weeks.flatMap((w) => w.days.flatMap((d) => d.exercises));
    expect(Math.max(...all.map((e) => e.target_rpe))).toBeLessThanOrEqual(7); // PAR-Q yes caps effort
    expect(all.some((e) => e.exercise_id === 'pushup')).toBe(false); // sore wrist

    const profile = loadProfile();
    expect(profile).toMatchObject({ name: 'Asha', sex: 'female', daysPerWeek: 4 });
    expect(profile.health.conditions).toEqual(['hypertension']);
    expect(profile.baselines[0]).toMatchObject({ pushups: 6, sitToStand: 13 });

    // Why this plan
    await user.click(screen.getByRole('button', { name: /Why this plan/i }));
    const why = screen.getByRole('region', { name: /Why this plan/i });
    expect(within(why).getByText(/carry groceries up the stairs easily/)).toBeInTheDocument();
    expect(within(why).getByText(/wrist/i)).toBeInTheDocument();
    expect(within(why).getByText(/breathe out/i)).toBeInTheDocument();
  });

  it('"Why this plan" questions open Ask Your Coach with the question ready', async () => {
    const { generateAdaptivePlan } = await import('../services/geminiCoach');
    const { filterSafeExercises } = await import('../services/catalogFilter');
    const { DEFAULT_PROFILE, savePlan } = await import('../services/storage');
    savePlan(await generateAdaptivePlan(DEFAULT_PROFILE, filterSafeExercises(DEFAULT_PROFILE), '', 'm'));
    localStorage.setItem('mf_byok_gemini_api_key', 'k');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Week 1');
    await user.click(screen.getByRole('button', { name: /Why this plan/i }));
    await user.click(screen.getAllByRole('button', { name: /Ask the coach about this/i })[0]);
    expect(screen.getByLabelText(/Your question/i).value).toMatch(/days/);
  });

  it('skipping goes straight to the full form and is remembered', async () => {
    fresh();
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await user.click(screen.getByRole('button', { name: /Skip setup/i }));
    expect(screen.getByRole('button', { name: /Generate 4-Week Block/i })).toBeInTheDocument();
    unmount();
    render(<App />);
    expect(screen.queryByRole('region', { name: /Guided setup/i })).not.toBeInTheDocument();
  });
});

describe('profile extras on the Coach tab', () => {
  it('shows completeness and lets you fill a section later', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByLabelText(/Profile \d+% complete/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Health check/i }));
    await answerParq(user);
    expect(loadProfile().health.parq.heart).toBe(false);
    expect(screen.getByLabelText(/Profile 33% complete/)).toBeInTheDocument();
  });

  it('typed blood values are analysed and saved without a key', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Blood report/i }));
    expect(screen.queryByLabelText(/Upload report photo/i)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/type a value in/i), 'vitamin_d');
    await user.type(screen.getByLabelText('Value'), '14');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText(/Low vitamin D is very common/)).toBeInTheDocument();
    expect(loadProfile().labs.markers[0]).toMatchObject({ id: 'vitamin_d', value: 14 });
    await user.click(screen.getByRole('button', { name: /Delete blood report data/i }));
    expect(loadProfile().labs).toBeNull();
  });

  it('an uploaded report is read by Gemini, reviewed, then only the numbers are stored', async () => {
    localStorage.setItem('mf_byok_gemini_api_key', 'k');
    mockGenerateContent.mockResolvedValueOnce(
      ok({ is_lab_report: true, report_date: '2026-11-01', markers: [{ name: 'Haemoglobin', value: 10.9, unit: 'g/dL' }, { name: 'Platelet count', value: 240, unit: '10^3/uL' }] })
    );
    const user = userEvent.setup({ applyAccept: false });
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Blood report/i }));
    await user.upload(screen.getByLabelText(/Upload report PDF/i), new File(['%PDF-1.4 fake'], 'report.pdf', { type: 'application/pdf' }));

    expect(await screen.findByText(/Check these against your report/)).toBeInTheDocument();
    const req = mockGenerateContent.mock.calls[0][0];
    expect(req.contents[0].parts[1].inlineData.mimeType).toBe('application/pdf');
    await user.click(screen.getByRole('button', { name: /Remove Platelet count/i }));
    await user.click(screen.getByRole('button', { name: /Save these results/i }));

    const labs = loadProfile().labs;
    expect(labs).toMatchObject({ date: '2026-11-01', source: 'upload' });
    expect(labs.markers).toHaveLength(1);
    expect(JSON.stringify(localStorage)).not.toContain(req.contents[0].parts[1].inlineData.data);
  });

  it('a non-report upload gets a clear message', async () => {
    localStorage.setItem('mf_byok_gemini_api_key', 'k');
    mockGenerateContent.mockResolvedValueOnce(ok({ is_lab_report: false, markers: [] }));
    const user = userEvent.setup({ applyAccept: false });
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Blood report/i }));
    await user.upload(screen.getByLabelText(/Upload report photo/i), new File([new Uint8Array(100)], 'cat.png', { type: 'image/png' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/doesn't look like a blood test/);
  });
});

describe('two people, one phone', () => {
  it('adds a person, runs their own setup, and switches back with data intact', async () => {
    localStorage.setItem('mf_profile_v1', JSON.stringify({ name: 'Ramanaa', daysPerWeek: 3 }));
    const user = userEvent.setup();
    render(<App />);
    const select = screen.getByLabelText(/Switch person/i);
    expect(within(select).getByRole('option', { name: 'Ramanaa' })).toBeInTheDocument();

    await user.selectOptions(select, '__add');
    expect(await screen.findByRole('region', { name: /Guided setup/i })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/What should we call you/i), 'Asha');
    expect(within(screen.getByLabelText(/Switch person/i)).getByRole('option', { name: 'Asha' })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/Switch person/i), 'default');
    expect(screen.queryByRole('region', { name: /Guided setup/i })).not.toBeInTheDocument();
    expect(loadProfile().name).toBe('Ramanaa');
    expect(within(screen.getByLabelText(/Switch person/i)).getByRole('option', { name: 'Asha' })).toBeInTheDocument();
  });
});
