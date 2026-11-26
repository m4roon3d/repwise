/** Health tab: blood report history, AI analysis, tips, and how results shape the plan. */
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
import { DEFAULT_PROFILE, loadLabReports, loadPlan, loadProfile, saveLabReports, exportBackupJson, importBackupJson } from '../services/storage';
import { sanitizeAnalysis, sanitizeReports, latestLabsForProfile, markerSeries, describeLabsForPrompt, tipsFor } from '../services/labs';
import { labFinisher } from '../services/health';
import { generateAdaptivePlan } from '../services/geminiCoach';
import { filterSafeExercises } from '../services/catalogFilter';

beforeEach(() => mockGenerateContent.mockReset());
const ok = (obj) => ({ candidates: [{ finishReason: 'STOP' }], text: JSON.stringify(obj) });
const report = (id, date, markers, extra = {}) => ({ id, date, source: 'manual', markers, ...extra });
const tab = (user) => user.click(screen.getByRole('button', { name: /^Health$/ }));

describe('lab report service', () => {
  it('sanitizes AI output: strings only, capped, unknown keys dropped', () => {
    const a = sanitizeAnalysis({ summary: 'x'.repeat(2000), overall: 'nope', markers: [{ name: 'LDL', meaning: 'm', tips: ['a', 5, 'b'] }, null], lifestyle_tips: [{ area: 'hack', tip: 't' }], doctor_questions: ['q1'], extra: '<script>' });
    expect(a.summary).toHaveLength(900);
    expect(a.overall).toBe('mixed');
    expect(a.markers[0].tips).toEqual(['a', 'b']);
    expect(a.lifestyleTips[0].area).toBe('lifestyle');
    expect(JSON.stringify(a)).not.toContain('script');
    expect(sanitizeAnalysis({})).toBeNull();
    // stored analyses survive being sanitized again on load
    expect(sanitizeAnalysis(a)).toEqual(a);
  });
  it('keeps history sorted, builds per-marker series, and feeds AI advice into the plan prompt', () => {
    const r = sanitizeReports([
      report('b', '2026-09-01', [{ name: 'HbA1c', value: 6.0, unit: '%' }], { analysis: { summary: 's', overall: 'mixed', training_adjustments: ['Walk 15 min after lifting'] } }),
      report('a', '2026-03-01', [{ name: 'HbA1c', value: 6.4, unit: '%' }]),
    ]);
    expect(r.map((x) => x.id)).toEqual(['a', 'b']);
    expect(markerSeries(r, 'hba1c').map((p) => p.value)).toEqual([6.4, 6]);
    const labs = latestLabsForProfile(r);
    expect(describeLabsForPrompt(labs)).toMatch(/analysis suggests: Walk 15 min after lifting/);
  });
  it('has offline tips for every marker direction it flags', () => {
    expect(tipsFor('hemoglobin', 'low').length).toBeGreaterThan(1);
    expect(tipsFor('ldl', 'high')[0]).toMatch(/cardio/i);
  });
});

describe('results shape the routine', () => {
  it('high sugar or lipids add a cardio finisher to every day, explained in Why this plan', async () => {
    const p = { ...DEFAULT_PROFILE, labs: { markers: [{ name: 'LDL', value: 170, unit: 'mg/dL' }] } };
    expect(labFinisher(p).title).toBe('Cardio finisher');
    const plan = await generateAdaptivePlan(p, filterSafeExercises(p), '', 'm');
    expect(plan.weeks.every((w) => w.days.every((d) => d.finisher?.title === 'Cardio finisher'))).toBe(true);
    expect(plan.rationale.find((r) => r.id === 'labs').text).toMatch(/Added for your cholesterol/);
  });
  it('low haemoglobin turns it into an easy walk; normal results add nothing', () => {
    const both = { ...DEFAULT_PROFILE, sex: 'male', labs: { markers: [{ name: 'HbA1c', value: 6.2, unit: '%' }, { name: 'Hemoglobin', value: 11, unit: 'g/dL' }] } };
    expect(labFinisher(both).title).toBe('Easy walk to finish');
    expect(labFinisher({ ...DEFAULT_PROFILE, labs: { markers: [{ name: 'LDL', value: 90, unit: 'mg/dL' }] } })).toBeNull();
  });
});

describe('Health tab', () => {
  it('type a report in: flagged markers show tips and a range bar; profile labs follow the latest report', async () => {
    const user = userEvent.setup();
    render(<App />);
    await tab(user);
    expect(screen.getByText(/Add a blood test/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Type it in/i }));
    await user.selectOptions(screen.getByLabelText('Test 1'), 'vitamin_d');
    await user.type(screen.getByLabelText(/Vitamin D .* value/), '14');
    await user.click(screen.getByRole('button', { name: /Add another test/i }));
    await user.selectOptions(screen.getByLabelText('Test 2'), 'ldl');
    await user.type(screen.getByLabelText(/LDL cholesterol value/), '165');
    await user.click(screen.getByRole('button', { name: /Save report/i }));

    expect(screen.getByRole('heading', { name: /2 results to work on/ })).toBeInTheDocument();
    expect(screen.getByText(/midday sun/)).toBeInTheDocument();
    expect(screen.getByText(/How this shapes your training/)).toBeInTheDocument();
    expect(screen.getByText(/Cardio finisher|cardio finisher/)).toBeInTheDocument();
    expect(loadLabReports()).toHaveLength(1);
    expect(loadProfile().labs.markers.map((m) => m.id).sort()).toEqual(['ldl', 'vitamin_d']);
  });

  it('upload a PDF, review it, then run the AI analysis; results and doctor questions are saved with the report', async () => {
    localStorage.setItem('mf_byok_gemini_api_key', 'k');
    mockGenerateContent
      .mockResolvedValueOnce(ok({ is_lab_report: true, report_date: '2026-11-10', markers: [{ name: 'HbA1c', value: 6.1, unit: '%' }, { name: 'Haemoglobin', value: 14.2, unit: 'g/dL' }] }))
      .mockResolvedValueOnce(
        ok({
          summary: 'Your blood sugar is in the prediabetes range; everything else looks healthy.',
          overall: 'mixed',
          markers: [{ name: 'HbA1c', meaning: 'Average sugar over 3 months.', training: 'Lift 3x a week and walk after meals.', tips: ['Walk 10 minutes after dinner.'] }],
          lifestyle_tips: [{ area: 'nutrition', tip: 'Swap white rice for millets a few times a week.' }],
          training_adjustments: ['Add a 15-minute brisk walk after each session.'],
          doctor_questions: ['Should I repeat HbA1c in 3 months?'],
        })
      );
    const user = userEvent.setup({ applyAccept: false });
    render(<App />);
    await tab(user);
    await user.upload(screen.getByLabelText(/Upload blood report PDF/), new File(['%PDF-1.4'], 'r.pdf', { type: 'application/pdf' }));
    expect(await screen.findByText(/Check these against your report/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Save report/i }));

    await user.click(screen.getByRole('button', { name: /Analyse with AI/i }));
    expect(await screen.findByText(/prediabetes range; everything else/)).toBeInTheDocument();
    expect(screen.getByText('Walk 10 minutes after dinner.')).toBeInTheDocument();
    expect(screen.getByText(/Swap white rice for millets/)).toBeInTheDocument();
    expect(screen.getByText(/Should I repeat HbA1c/)).toBeInTheDocument();
    expect(screen.getByText(/Add a 15-minute brisk walk/)).toBeInTheDocument();

    const prompt = mockGenerateContent.mock.calls[1][0].contents;
    expect(prompt).toMatch(/HbA1c: 6.1 % → high \(prediabetes range\)/);
    expect(prompt).toMatch(/never give medication or supplement doses/);
    expect(loadLabReports()[0].analysis.doctorQuestions).toEqual(['Should I repeat HbA1c in 3 months?']);
    expect(loadProfile().labs.aiAdjustments).toEqual(['Add a 15-minute brisk walk after each session.']);
    expect(JSON.stringify(localStorage)).not.toContain('%PDF');
  });

  it('compares with the previous report, switches between reports, shows trends, and deletes', async () => {
    saveLabReports([report('a', '2026-03-01', [{ name: 'Vitamin D', value: 12, unit: 'ng/mL' }]), report('b', '2026-09-01', [{ name: 'Vitamin D', value: 22, unit: 'ng/mL' }])]);
    vi.stubGlobal('confirm', () => true);
    const user = userEvent.setup();
    render(<App />);
    await tab(user);
    expect(screen.getByText(/Previously 12 ng\/mL/)).toBeInTheDocument();
    expect(screen.getByText(/improving ✓/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Vitamin D \(25-OH\) \(ng\/mL\):/ })).toBeInTheDocument();
    const picker = screen.getByRole('group', { name: /Choose report/ });
    await user.click(within(picker).getAllByRole('button')[1]); // older report
    expect(screen.queryByText(/Previously/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Delete report/ }));
    expect(loadLabReports().map((r) => r.id)).toEqual(['b']);
  });

  it('a report saved before history existed becomes the first entry; reports travel in backups', () => {
    localStorage.setItem('mf_profile_v1', JSON.stringify({ ...DEFAULT_PROFILE, labs: { date: '2026-01-05', markers: [{ name: 'LDL', value: 150, unit: 'mg/dL' }] } }));
    expect(loadLabReports()[0]).toMatchObject({ id: 'lab_initial', date: '2026-01-05' });
    saveLabReports(loadLabReports());
    const json = exportBackupJson();
    localStorage.clear();
    expect(importBackupJson(json).labReports).toHaveLength(1);
  });

  it('a plan generated after adding a sugar result includes the finisher on the Workout tab', async () => {
    saveLabReports([report('a', '2026-09-01', [{ name: 'Fasting glucose', value: 115, unit: 'mg/dL' }])]);
    localStorage.setItem('mf_profile_v1', JSON.stringify({ ...DEFAULT_PROFILE, labs: { markers: [{ name: 'Fasting glucose', value: 115, unit: 'mg/dL' }] } }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /^Coach$/ }));
    await user.click(screen.getByRole('button', { name: /Generate 4-Week Block/i }));
    expect(await screen.findByRole('heading', { name: /Cardio finisher/ })).toBeInTheDocument();
    expect(loadPlan().weeks[0].days[0].finisher).toBeTruthy();
  });
});
