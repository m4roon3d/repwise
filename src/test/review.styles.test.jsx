/** Training styles: weekly mix, yoga/cardio days, timed doses, logging and UI. */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@google/genai', () => ({ Type: {}, GoogleGenAI: vi.fn() }));

import App from '../App';
import exercises from '../data/exercises.json';
import { assignDayStyles, sanitizeStyles, buildYogaDay, buildCardioDay } from '../services/styles';
import { DEFAULT_PROFILE, loadPlan, loadProfile, loadWorkoutLogs, sanitizeProfile, saveProfile, savePlan } from '../services/storage';
import { filterSafeExercises, EXERCISE_MAP } from '../services/catalogFilter';
import { generateAdaptivePlan } from '../services/geminiCoach';
import { suggestNext } from '../services/progress';

const P = (over) => sanitizeProfile({ ...DEFAULT_PROFILE, ...over });
const plan = (p) => generateAdaptivePlan(p, filterSafeExercises(p), '', 'm');

describe('weekly mix', () => {
  it('defaults to gym and ignores unknown styles', () => {
    expect(sanitizeStyles(undefined)).toEqual(['gym']);
    expect(sanitizeStyles(['pilates', 'yoga'])).toEqual(['yoga']);
    expect(P({ styles: [] }).styles).toEqual(['gym']);
  });
  it('strength gets at least half the week, other styles sit between strength days', () => {
    expect(assignDayStyles(P({ daysPerWeek: 5, styles: ['gym', 'calisthenics', 'yoga', 'cardio'] }))).toEqual(['gym', 'yoga', 'calisthenics', 'cardio', 'gym']);
    expect(assignDayStyles(P({ daysPerWeek: 3, styles: ['gym', 'yoga', 'cardio'] }))).toEqual(['gym', 'yoga', 'gym']);
    expect(assignDayStyles(P({ daysPerWeek: 2, styles: ['yoga', 'cardio'] }))).toEqual(['yoga', 'cardio']);
    expect(assignDayStyles(P({ daysPerWeek: 4, styles: ['gym'] }))).toEqual(['gym', 'gym', 'gym', 'gym']);
  });
});

describe('plans with styles', () => {
  it('builds each day in its style, every week, with the right prescription', async () => {
    const pl = await plan(P({ daysPerWeek: 5, styles: ['gym', 'calisthenics', 'yoga', 'cardio'] }));
    expect(pl.day_styles).toEqual(['gym', 'yoga', 'calisthenics', 'cardio', 'gym']);
    for (const w of pl.weeks) {
      expect(w.days.map((d) => d.style)).toEqual(pl.day_styles);
      const [, yoga, cal, cardio] = w.days;
      expect(yoga.exercises.every((e) => (EXERCISE_MAP[e.exercise_id].modalities || []).includes('yoga') && e.time_sec_min > 0)).toBe(true);
      expect(cal.exercises.every((e) => EXERCISE_MAP[e.exercise_id].modalities.includes('calisthenics'))).toBe(true);
      expect(cardio.exercises[0]).toMatchObject({ dose: 'duration' });
      expect(cardio.exercises[0].minutes).toBeGreaterThan(14);
      expect(w.days.map((d) => d.day_label)).toEqual(w.days.map((d, i) => expect.stringMatching(new RegExp(`^Day ${i + 1} — `))));
    }
    // holds grow 5 s a week, week 3 cardio is intervals, labels name the style
    expect(pl.weeks[1].days[1].exercises[0].time_sec_min - pl.weeks[0].days[1].exercises[0].time_sec_min).toBe(5);
    expect(pl.weeks[2].days[3].exercises[0].intensity).toMatch(/Intervals/);
    expect(pl.weeks[0].days[1].day_label).toBe('Day 2 — Yoga Flow');
    expect(pl.weeks[0].days[2].day_label).toMatch(/^Day 3 — Calisthenics/);
    expect(pl.rationale.find((r) => r.id === 'schedule').text).toMatch(/Day 2 yoga/);
  });
  it('a yoga-and-cardio-only week works without any strength days', async () => {
    const pl = await plan(P({ daysPerWeek: 3, styles: ['yoga', 'cardio'] }));
    expect(pl.weeks[0].days.map((d) => d.style)).toEqual(['yoga', 'cardio', 'yoga']);
    expect(pl.weeks[0].days[0].exercises.length).toBeGreaterThanOrEqual(6);
  });
  it('a lab finisher only goes on strength days', async () => {
    const pl = await plan(P({ daysPerWeek: 3, styles: ['gym', 'yoga'], labs: { markers: [{ name: 'LDL', value: 170, unit: 'mg/dL' }] } }));
    const d = pl.weeks[0].days;
    expect(d[0].finisher).toBeTruthy();
    expect(d[1].finisher).toBeFalsy();
  });
  it('pregnancy removes lying-flat yoga poses and jumping cardio', () => {
    const safe = filterSafeExercises(P({ sex: 'female', health: { pregnancy: 'pregnant_t3' }, styles: ['yoga', 'cardio'] }));
    const yoga = buildYogaDay(safe, P({}), 0).exercises.map((e) => e.exercise_id);
    expect(yoga).not.toContain('bridge_pose');
    expect(safe.map((e) => e.id)).not.toContain('jump_rope');
    expect(buildCardioDay(safe, P({}), 0).exercises[0]).toBeTruthy();
  });
  it('home users get bodyweight calisthenics and outdoor cardio', () => {
    const safe = filterSafeExercises(P({ equipmentTier: 'home_setup' }));
    const cardio = safe.filter((e) => e.modalities.includes('cardio')).map((e) => e.id);
    expect(cardio).toEqual(expect.arrayContaining(['brisk_walk_outdoor', 'jump_rope']));
    expect(cardio).not.toContain('incline_treadmill_walk');
  });
});

describe('timed and duration logging', () => {
  it('suggests longer holds or more minutes once the target is met', () => {
    expect(suggestNext({ unit: 's', sets: [{ reps: 45, weightKg: 0 }, { reps: 45, weightKg: 0 }] }, { time_sec_max: 45 }).message).toMatch(/Add 5 to 10 seconds/);
    expect(suggestNext({ unit: 'min', sets: [{ reps: 30, weightKg: 0 }] }, { minutes: 30 }).message).toMatch(/add 2 to 3 minutes/);
  });

  it('style picker updates the week preview; cardio cards show minutes and log in minutes', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Cardio Heart and lungs/i }));
    expect(loadProfile().styles).toEqual(['gym', 'cardio']);
    expect(within(screen.getByLabelText('Your week')).getByText(/Cardio/)).toBeInTheDocument();
    // can't deselect the last style
    await user.click(screen.getByRole('button', { name: /Gym Weights and machines/i }));
    await user.click(screen.getByRole('button', { name: /Cardio Heart and lungs/i }));
    expect(loadProfile().styles).toEqual(['cardio']);

    await user.click(screen.getByRole('button', { name: /Generate 4-Week Block/i }));
    await screen.findByText('Week 1');
    expect(screen.getAllByText('Time')[0]).toBeInTheDocument();
    expect(screen.getByText(/Steady, Zone 2/)).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: /Log session/i })[0]);
    await user.clear(screen.getByLabelText('Minutes'));
    await user.type(screen.getByLabelText('Minutes'), '28');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(loadWorkoutLogs()[0]).toMatchObject({ unit: 'min', sets: [{ reps: 28, weightKg: 0 }] });
    expect(screen.getByText(/Last time \(today\): 28 min/)).toBeInTheDocument();
  });

  it('library filters by style', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /^Exercises$/ }));
    await user.click(within(screen.getByRole('group', { name: /Filter by style/ })).getByRole('button', { name: /Yoga/ }));
    expect(screen.getByText(/Child’s Pose/)).toBeInTheDocument();
    expect(screen.queryByText('Barbell Back Squat')).not.toBeInTheDocument();
  });
});

describe('catalogue', () => {
  it('every exercise has modalities and a valid dose; yoga poses have a flow order', () => {
    for (const e of exercises) {
      expect(e.modalities.length).toBeGreaterThan(0);
      expect(['reps', 'time', 'duration']).toContain(e.dose);
      if (e.modalities.includes('yoga')) expect(typeof e.flow_order).toBe('number');
      if (e.modalities.includes('cardio')) expect(e.dose).toBe('duration');
    }
  });
});
