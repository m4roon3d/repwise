/** Material 3 shell: page titles, a single Exercises entry, the Start workout button, and result targets. */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import HealthView from '../components/HealthView';
import { DEFAULT_PROFILE, saveProfile, savePlan } from '../services/storage';
import { filterSafeExercises } from '../services/catalogFilter';
import { generateAdaptivePlan } from '../services/geminiCoach';

vi.mock('@google/genai', () => ({ Type: {}, GoogleGenAI: vi.fn() }));

async function seedPlan() {
  saveProfile(DEFAULT_PROFILE);
  savePlan(await generateAdaptivePlan(DEFAULT_PROFILE, filterSafeExercises(DEFAULT_PROFILE), '', 'm'));
}

describe('top app bar and navigation', () => {
  it('names the page and keeps one Exercises entry', async () => {
    await seedPlan();
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Repwise' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Health' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Health' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Exercises' })).toHaveLength(1);
    expect(screen.getByLabelText(/Switch person/i)).toBeInTheDocument();
  });
});

describe('Start workout button', () => {
  it('opens the first exercise to log, then moves on to the next one', async () => {
    await seedPlan();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Workout' }));
    await user.click(screen.getByRole('button', { name: 'Start workout' }));
    const first = document.getElementById('ex-card-0');
    const form = first.querySelector('.log-form');
    expect(form).not.toBeNull();
    const reps = within(form).getAllByLabelText(/reps|seconds|minutes/i)[0];
    await user.clear(reps);
    await user.type(reps, '8');
    await user.click(within(form).getByRole('button', { name: 'Save' }));

    await user.click(screen.getByRole('button', { name: 'Next exercise' }));
    expect(document.getElementById('ex-card-1').querySelector('.log-form')).not.toBeNull();
  });
});

describe('health result rows', () => {
  it('show what to aim for, in the standard unit when the report used another', () => {
    const report = { id: 'r', date: '2026-08-11', source: 'manual', markers: [{ name: 'Total cholesterol', value: 6.2, unit: 'mmol/L' }, { name: 'Vitamin D', value: 18, unit: 'ng/mL' }] };
    render(<HealthView reports={[report]} profile={{ ...DEFAULT_PROFILE, sex: 'male' }} apiKey="" onSave={vi.fn()} onDelete={vi.fn()} onExtract={vi.fn()} onAnalyze={vi.fn()} />);
    expect(screen.getByText('High · target 199 mg/dL or less')).toBeInTheDocument();
    expect(screen.getByText('Low · target 30 or more')).toBeInTheDocument();
  });
});
