/** Blood report summary: derived ratios aren't mistaken for real markers, duplicates count once, grouped glance view. */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HealthView from '../components/HealthView';
import { analyzeLabs, matchMarker, sanitizeLabs, flaggedHeadline, groupResults } from '../services/labs';
import { DEFAULT_PROFILE } from '../services/storage';

const markers = [
  { name: 'Total Cholesterol', value: 228, unit: 'mg/dL' },
  { name: 'HDL Cholesterol', value: 35, unit: 'mg/dL' },
  { name: 'HDL', value: 35, unit: 'mg/dL' }, // printed again on a summary page
  { name: 'Total Cholesterol/HDL Ratio', value: 6.5, unit: '' },
  { name: 'LDL/HDL Ratio', value: 4.6, unit: '' },
  { name: 'Non-HDL Cholesterol', value: 193, unit: 'mg/dL' },
  { name: 'LDL Cholesterol', value: 160, unit: 'mg/dL' },
  { name: 'Triglycerides', value: 210, unit: 'mg/dL' },
  { name: 'Vitamin D Total', value: 18, unit: 'ng/mL' },
  { name: 'hs-CRP', value: 6, unit: 'mg/L' },
];

describe('lab parsing', () => {
  it('does not read ratios or derived lipids as the marker they mention', () => {
    for (const n of ['Total Cholesterol/HDL Ratio', 'LDL/HDL ratio', 'Chol/HDL', 'Non-HDL Cholesterol', 'VLDL']) expect(matchMarker(n)).toBeNull();
    expect(matchMarker('HDL Cholesterol')).toBe('hdl');
    expect(matchMarker('HbA1c / Glycated haemoglobin')).toBe('hba1c');
    // A report saved before the fix, with a wrong id stored, is corrected when read.
    const stored = sanitizeLabs({ markers: [{ id: 'hdl', name: 'TC/HDL ratio', value: 6.5 }, { name: 'HDL', value: 35 }] });
    expect(stored.markers[0].id).toBeNull();
  });

  it('counts a repeated test once and groups results by body system', () => {
    const { flagged } = analyzeLabs({ markers }, 'male');
    expect(flagged.map((r) => r.id)).toEqual(['total_cholesterol', 'hdl', 'ldl', 'triglycerides', 'vitamin_d', 'crp']);
    expect(groupResults(flagged).map((g) => [g.id, g.items.length])).toEqual([['lipids', 4], ['vitamins', 1], ['inflammation', 1]]);
    expect(flaggedHeadline(flagged)).toBe('Mostly cholesterol & blood fats, plus low vitamin D and raised inflammation.');
  });
});

describe('summary card', () => {
  it('shows a one-line headline and grouped results instead of a run-on sentence', async () => {
    const report = { id: 'r1', date: '2026-08-11', source: 'upload', markers };
    render(<HealthView reports={[report]} profile={{ ...DEFAULT_PROFILE, sex: 'male' }} apiKey="" onSave={vi.fn()} onDelete={vi.fn()} onExtract={vi.fn()} onAnalyze={vi.fn()} />);
    expect(screen.getByRole('heading', { name: '6 results to work on' })).toBeInTheDocument();
    expect(screen.getByText(/Mostly cholesterol & blood fats/)).toBeInTheDocument();
    expect(screen.queryByText(/HDL cholesterol is low, HDL cholesterol is low/)).not.toBeInTheDocument();
    const row = screen.getByRole('button', { name: /^Vitamin D \(25-OH\): 18 ng\/mL, Low/ });
    expect(within(row).getByText('Vitamin D')).toBeInTheDocument();
    const target = document.getElementById('lab-card-vitamin_d');
    target.scrollIntoView = vi.fn();
    await userEvent.setup().click(row);
    expect(target.scrollIntoView).toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Cholesterol & blood fats' })).toBeInTheDocument(); // card group heading
  });
});
