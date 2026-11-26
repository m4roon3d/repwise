/** InBody / body-composition scans, insights, strength trends and the Progress tab. */
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
import { sanitizeScans, normalizeExtracted, delta, judge, bodyInsights, nextScanDue, describeBodyCompForPrompt } from '../services/bodyComp';
import { strengthTrends, weeklySessions, sessionE1rm } from '../services/progress';
import { exportBackupJson, importBackupJson, loadBodyScans, loadProfile, saveBodyScans, DEFAULT_PROFILE } from '../services/storage';
import { generateAdaptivePlan } from '../services/geminiCoach';
import { filterSafeExercises } from '../services/catalogFilter';

beforeEach(() => mockGenerateContent.mockReset());
const ok = (obj) => ({ candidates: [{ finishReason: 'STOP' }], text: JSON.stringify(obj) });
const scan = (date, metrics, id = date) => ({ id, date, source: 'manual', metrics });
const two = [
  scan('2026-07-01', { weightKg: 80, smmKg: 33, bfmKg: 18, pbf: 22.5, visceralFat: 9 }),
  scan('2026-09-01', { weightKg: 79.2, smmKg: 33.6, bfmKg: 16.6, pbf: 21, visceralFat: 8 }),
];

describe('scan data', () => {
  it('keeps plausible values only, sorts by date, drops empties', () => {
    const s = sanitizeScans([two[1], { date: '2026-08-01', metrics: { weightKg: 5000 } }, two[0], { metrics: { pbf: 'abc' } }]);
    expect(s.map((x) => x.date)).toEqual(['2026-07-01', '2026-09-01']);
  });
  it('converts reports printed in pounds', () => {
    const s = normalizeExtracted({ mass_unit: 'lb', weightKg: 176.4, smmKg: 72.8, pbf: 21, test_date: '2026-10-10' });
    expect(s.metrics.weightKg).toBeCloseTo(80, 0);
    expect(s.metrics.smmKg).toBeCloseTo(33, 0);
    expect(s.metrics.pbf).toBe(21);
    expect(s.date).toBe('2026-10-10');
  });
  it('deltas, direction and due date', () => {
    const scans = sanitizeScans(two);
    expect(delta(scans, 'smmKg').change).toBeCloseTo(0.6);
    expect(judge('smmKg', 0.6)).toBe('good');
    expect(judge('pbf', 0.5)).toBe('bad');
    expect(judge('weightKg', -1)).toBeNull();
    expect(nextScanDue(scans, Date.parse('2026-11-26')).daysLeft).toBeLessThan(0);
    expect(describeBodyCompForPrompt(scans)).toMatch(/Muscle 33.6 kg \(\+0.6 in 62d\)/);
  });
  it('spots recomposition, muscle loss, high visceral fat and left/right imbalance', () => {
    const recomp = bodyInsights(sanitizeScans(two), { sex: 'male' }).map((i) => i.text).join(' ');
    expect(recomp).toMatch(/Recomposition/);
    const loss = bodyInsights(sanitizeScans([scan('2026-07-01', { weightKg: 82, smmKg: 34, bfmKg: 19 }), scan('2026-09-01', { weightKg: 78, smmKg: 33, bfmKg: 17, visceralFat: 12, leanLeftArm: 3.2, leanRightArm: 3.6 })]), {});
    const t = loss.map((i) => i.text).join(' ');
    expect(t).toMatch(/Some of the 4.0 kg you lost was muscle/);
    expect(t).toMatch(/Visceral fat level 12/);
    expect(t).toMatch(/left arm has 11% less lean mass/);
  });
  it('is stored per person and travels in backups', () => {
    saveBodyScans(two);
    const json = exportBackupJson();
    localStorage.clear();
    expect(importBackupJson(json).bodyScans).toHaveLength(2);
    expect(loadBodyScans()).toHaveLength(2);
  });
  it('a plan built with scans explains them in "Why this plan"', async () => {
    const p = DEFAULT_PROFILE;
    const plan = await generateAdaptivePlan(p, filterSafeExercises(p), '', 'm', [], '', describeBodyCompForPrompt(sanitizeScans(two)));
    expect(plan.rationale.find((r) => r.id === 'body').text).toMatch(/From your scan on 2026-09-01/);
  });
});

describe('training trends', () => {
  const log = (daysAgo, ex, w, reps) => ({ id: `${ex}${daysAgo}`, ts: Date.now() - daysAgo * 86400000, exercise_id: ex, sets: [{ reps, weightKg: w }] });
  it('estimates 1RM, ranks exercises, counts training days per week', () => {
    expect(sessionE1rm({ sets: [{ reps: 10, weightKg: 30 }, { reps: 5, weightKg: 35 }] })).toBe(40.8);
    expect(sessionE1rm({ sets: [{ reps: 10, weightKg: 0 }] })).toBeNull();
    const logs = [log(1, 'goblet_squat', 24, 10), log(8, 'goblet_squat', 22, 10), log(15, 'goblet_squat', 20, 10), log(2, 'db_bench_press', 20, 8)];
    const t = strengthTrends(logs);
    expect(t[0]).toMatchObject({ id: 'goblet_squat' });
    expect(t[0].points.map((p) => p.value)).toEqual([26.7, 29.3, 32]);
    const w = weeklySessions(logs, 4);
    expect(w.at(-1).count).toBe(2);
    expect(w.reduce((n, x) => n + x.count, 0)).toBe(4);
  });
});

describe('Progress tab', () => {
  const open = async (user) => user.click(screen.getByRole('button', { name: /^Progress$/ }));

  it('typing a scan in shows tiles, updates profile weight, and a second scan shows changes, insights and charts', async () => {
    const user = userEvent.setup();
    render(<App />);
    await open(user);
    expect(screen.getByText(/Add your InBody/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Upload scan photo/)).not.toBeInTheDocument(); // no key

    await user.click(screen.getByRole('button', { name: /Type it in/i }));
    await user.clear(screen.getByLabelText(/Scan date/));
    await user.type(screen.getByLabelText(/Scan date/), '2026-07-01');
    await user.type(screen.getByLabelText(/^Weight \(kg\)/), '80');
    await user.type(screen.getByLabelText(/Skeletal muscle mass/), '33');
    await user.type(screen.getByLabelText(/^Body fat %/), '22.5');
    await user.type(screen.getByLabelText(/Body fat mass/), '18');
    await user.click(screen.getByRole('button', { name: /Save scan/i }));
    expect(loadProfile().weightKg).toBe(80);
    expect(screen.getByText('80.0 kg')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Type it in/i }));
    await user.clear(screen.getByLabelText(/Scan date/));
    await user.type(screen.getByLabelText(/Scan date/), '2026-09-01');
    await user.type(screen.getByLabelText(/^Weight \(kg\)/), '79.2');
    await user.type(screen.getByLabelText(/Skeletal muscle mass/), '33.6');
    await user.type(screen.getByLabelText(/^Body fat %/), '21');
    await user.type(screen.getByLabelText(/Body fat mass/), '16.6');
    await user.click(screen.getByRole('button', { name: /Save scan/i }));

    expect(screen.getByText(/Recomposition/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Skeletal muscle mass:/ })).toBeInTheDocument();
    expect(screen.getByText('▲ 0.6 kg')).toBeInTheDocument();
    expect(loadBodyScans()).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: /Scan history \(2\)/ }));
    await user.click(screen.getAllByRole('button', { name: /Delete scan from/ })[0]);
    expect(loadBodyScans()).toHaveLength(1);
  });

  it('out-of-range values are flagged before saving', async () => {
    const user = userEvent.setup();
    render(<App />);
    await open(user);
    await user.click(screen.getByRole('button', { name: /Type it in/i }));
    await user.type(screen.getByLabelText(/^Weight \(kg\)/), '80');
    await user.type(screen.getByLabelText(/^Body fat %/), '95');
    await user.click(screen.getByRole('button', { name: /Save scan/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Body fat %/);
    await user.click(screen.getByRole('button', { name: /Save anyway/i }));
    expect(loadBodyScans()[0].metrics).toEqual({ weightKg: 80 });
  });

  it('an uploaded InBody sheet is read by Gemini, reviewed, then saved', async () => {
    localStorage.setItem('mf_byok_gemini_api_key', 'k');
    mockGenerateContent.mockResolvedValueOnce(ok({ is_body_composition_report: true, device: 'InBody 570', test_date: '2026-11-20', mass_unit: 'kg', weightKg: 78.4, smmKg: 34.1, bfmKg: 15.2, pbf: 19.4, visceralFat: 7, bmr: 1720, leanLeftArm: 3.4, leanRightArm: 3.5 }));
    const user = userEvent.setup({ applyAccept: false });
    render(<App />);
    await open(user);
    await user.upload(screen.getByLabelText(/Upload scan PDF/i), new File(['%PDF-1.4'], 'inbody.pdf', { type: 'application/pdf' }));
    expect(await screen.findByText(/Check these against your report/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Skeletal muscle mass/)).toHaveValue(34.1);
    expect(screen.getByLabelText(/Basal metabolic rate/)).toHaveValue(1720); // more fields opened automatically
    await user.click(screen.getByRole('button', { name: /Save scan/i }));
    const saved = loadBodyScans()[0];
    expect(saved).toMatchObject({ date: '2026-11-20', source: 'upload', device: 'InBody 570' });
    expect(JSON.stringify(localStorage)).not.toContain('%PDF');
  });

  it('shows scans in pounds for imperial users', async () => {
    localStorage.setItem('mf_profile_v1', JSON.stringify({ ...DEFAULT_PROFILE, unitSystem: 'imperial' }));
    saveBodyScans([scan('2026-09-01', { weightKg: 80 })]);
    const user = userEvent.setup();
    render(<App />);
    await open(user);
    expect(within(document.querySelector('.stat-grid')).getByText('176.4 lb')).toBeInTheDocument();
  });
});

describe('phone photo pickers', () => {
  it('photo buttons open the gallery (image/*), PDFs have their own button', async () => {
    localStorage.setItem('mf_byok_gemini_api_key', 'k');
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /^Progress$/ }));
    expect(screen.getByLabelText(/Upload scan photo/)).toHaveAttribute('accept', 'image/*');
    expect(screen.getByLabelText(/Upload scan PDF/)).toHaveAttribute('accept', 'application/pdf,.pdf');
  });

  it('accepts an iPhone HEIC photo and a gallery file with no type', async () => {
    const { prepareReportFile, imageType } = await import('../services/images');
    const heic = await prepareReportFile(new File([new Uint8Array(500)], 'IMG_1234.HEIC', { type: 'image/heic' }));
    expect(['image/heic', 'image/jpeg']).toContain(heic.mimeType);
    expect(imageType(new File(['x'], 'scan.jpg', { type: '' }))).toBe('image/jpeg');
    const pdf = await prepareReportFile(new File(['%PDF'], 'report.pdf', { type: '' }));
    expect(pdf.mimeType).toBe('application/pdf');
  });

  it('a HEIC photo goes through to Gemini for a scan', async () => {
    localStorage.setItem('mf_byok_gemini_api_key', 'k');
    mockGenerateContent.mockResolvedValueOnce(ok({ is_body_composition_report: true, test_date: '2026-11-25', weightKg: 78 }));
    const user = userEvent.setup({ applyAccept: true });
    render(<App />);
    await user.click(screen.getByRole('button', { name: /^Progress$/ }));
    await user.upload(screen.getByLabelText(/Upload scan photo/), new File([new Uint8Array(300)], 'IMG_9.HEIC', { type: 'image/heic' }));
    expect(await screen.findByText(/Check these against your report/)).toBeInTheDocument();
  });
});
