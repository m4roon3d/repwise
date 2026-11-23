/**
 * UI-level review tests. `it.fails` = confirmed bug (see header of review.services.test.js).
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockGenerateContent } = vi.hoisted(() => ({ mockGenerateContent: vi.fn() }));
vi.mock('@google/genai', () => ({
  Type: { OBJECT: 'OBJECT', ARRAY: 'ARRAY', STRING: 'STRING', INTEGER: 'INTEGER', NUMBER: 'NUMBER', BOOLEAN: 'BOOLEAN' },
  GoogleGenAI: vi.fn().mockImplementation(() => ({ models: { generateContent: mockGenerateContent } })),
}));

import App from '../App';

beforeEach(() => mockGenerateContent.mockReset());

const exerciseTitles = () =>
  screen
    .getAllByRole('heading', { level: 3 })
    .map((h) => h.textContent)
    .filter((t) => /^\d+\.\s/.test(t))
    .map((t) => t.replace(/^\d+\.\s/, ''));

describe('Settings & key handling', () => {
  it('shows "API Key" until a key is saved, then "Gemini Connected"', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole('button', { name: /API Key/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /API Key/i }));
    await user.type(screen.getByLabelText(/Gemini API Key/i), 'AIza-test');
    await user.click(screen.getByRole('button', { name: /Save Settings/i }));
    await user.click(screen.getByRole('button', { name: /Close/i }));

    expect(screen.getByRole('button', { name: /Gemini Connected/i })).toBeInTheDocument();
    expect(localStorage.getItem('mf_byok_gemini_api_key')).toBe('AIza-test');
  });

  it('masks the key by default and Test Connection is disabled without one', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /API Key/i }));
    expect(screen.getByLabelText(/Gemini API Key/i)).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: /Test Connection/i })).toBeDisabled();
  });

  it('Test Connection reports API errors in the modal', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('API key not valid. Please pass a valid API key.'));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /API Key/i }));
    await user.type(screen.getByLabelText(/Gemini API Key/i), 'bad');
    await user.click(screen.getByRole('button', { name: /Test Connection/i }));
    expect(await screen.findByText(/API key not valid/i)).toBeInTheDocument();
  });

  it('restoring a corrupt backup file shows an error and keeps the app usable', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(screen.getByRole('button', { name: /API Key/i }));
    const input = container.querySelector('input[type="file"]');
    const file = new File(['{nope'], 'bad.json', { type: 'application/json' });
    // jsdom lacks File#text in some versions
    if (!file.text) file.text = () => Promise.resolve('{nope');
    await user.upload(input, file);
    expect(await screen.findByText(/Invalid backup JSON/i)).toBeInTheDocument();
  });
});

describe('AI chat intake — profile patch validation (model output is untrusted)', () => {
  it('applies valid fields but rejects out-of-range / wrongly-typed ones', async () => {
    localStorage.setItem('mf_byok_gemini_api_key', 'k');
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{ finishReason: 'STOP' }],
      text: JSON.stringify({
        coach_reply: 'Noted!',
        ready_to_generate: true,
        profile_patch: {
          age: 200,            // out of range -> reject
          heightCm: 12,        // out of range -> reject
          weightKg: -5,        // out of range -> reject
          sleepHours: 6.5,     // valid
          stressLevel: 'extreme', // invalid enum -> reject
          equipmentTier: 'home_setup', // valid
          daysPerWeek: 9,      // out of range -> reject
          protectKnee: true,   // valid
        },
      }),
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Start Chat/i }));
    await user.type(screen.getByPlaceholderText(/Sleeping 6 hrs/i), 'hi');
    await user.click(screen.getByRole('button', { name: /^Send$/i }));

    expect(await screen.findByText(/Auto-updated profile/i)).toBeInTheDocument();
    expect(screen.getAllByRole('spinbutton')[0]).toHaveValue(30); // Age (labels aren't associated — see a11y test)
    expect(screen.getByDisplayValue('175')).toBeInTheDocument(); // height unchanged
    expect(screen.getByDisplayValue('6.5')).toBeInTheDocument(); // sleep applied
    expect(screen.getByRole('button', { name: /Protect Knees/i })).toHaveClass('chip-active');
    expect(screen.getByDisplayValue(/Moderate — Normal work week/i)).toBeInTheDocument(); // stress unchanged
  });

  it('shows a chat error (not a crash) when Gemini fails', async () => {
    localStorage.setItem('mf_byok_gemini_api_key', 'k');
    mockGenerateContent.mockRejectedValueOnce(new Error('429 quota exceeded'));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Start Chat/i }));
    await user.type(screen.getByPlaceholderText(/Sleeping 6 hrs/i), 'hello');
    await user.click(screen.getByRole('button', { name: /^Send$/i }));
    expect(await screen.findByText(/429 quota exceeded/i)).toBeInTheDocument();
  });
});

describe('Plan generation error handling', () => {
  it('surfaces Gemini failures in a dismissible banner and stays on the Coach tab', async () => {
    localStorage.setItem('mf_byok_gemini_api_key', 'k');
    mockGenerateContent.mockRejectedValueOnce(new Error('model overloaded'));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Generate 4-Week Block with Gemini/i }));
    expect(await screen.findByText(/model overloaded/i)).toBeInTheDocument();
    expect(screen.queryByText('Week 1')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '✕' }));
    expect(screen.queryByText(/model overloaded/i)).not.toBeInTheDocument();
  });

  it('persists the generated plan and restores it (on the Workout tab) after a reload', async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    await user.click(screen.getByRole('button', { name: /Generate 4-Week Block/i }));
    await screen.findByText('Week 1');
    const before = exerciseTitles();
    first.unmount();

    render(<App />);
    expect(await screen.findByText('Week 1')).toBeInTheDocument();
    expect(exerciseTitles()).toEqual(before);
  });

  it('a joint-flagged profile never shows a contraindicated exercise in the generated plan', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Protect Knees/i }));
    await user.click(screen.getByRole('button', { name: /Generate 4-Week Block/i }));
    await screen.findByText('Week 1');
    const { default: exercises } = await import('../data/exercises.json');
    const kneeNames = new Set(exercises.filter((e) => e.joint_stress_flags.includes('knee')).map((e) => e.name));
    for (const t of exerciseTitles()) expect(kneeNames.has(t), t).toBe(false);
  });
});

describe('Routine interactions', () => {
  async function planOnScreen() {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Generate 4-Week Block/i }));
    await screen.findByText('Week 1');
    return user;
  }

  it('switching weeks and days shows different content and keeps Day-tab count = daysPerWeek', async () => {
    const user = await planOnScreen();
    expect(document.querySelectorAll('.day-tab')).toHaveLength(3);
    const w1 = exerciseTitles();
    await user.click(document.querySelectorAll('.day-tab')[1]);
    expect(exerciseTitles()).not.toEqual(w1);
    await user.click(screen.getByRole('button', { name: 'Week 3' }));
    expect(screen.getByText(/Week 3 —/)).toBeInTheDocument();
  });

  it('warm-up checkboxes toggle', async () => {
    const user = await planOnScreen();
    const [first] = screen.getAllByRole('checkbox');
    expect(first).not.toBeChecked();
    await user.click(first);
    expect(first).toBeChecked();
  });

  it('quick "short on time" adapt trims the day', async () => {
    const user = await planOnScreen();
    const before = exerciseTitles().length;
    await user.click(screen.getByRole('button', { name: /Only have 25 minutes today/i }));
    await waitFor(() => expect(exerciseTitles().length).toBeLessThan(before));
    expect(screen.getByText(/Adapted locally for/i)).toBeInTheDocument();
  });

  it('week check-in logs feedback and confirms', async () => {
    const user = await planOnScreen();
    await user.click(screen.getByRole('button', { name: /Just Right/i }));
    expect(await screen.findByText(/Logged "Just Right/i)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('mf_weekly_feedback_v1'))[0].rating).toMatch(/Week 1: Just Right/);
  });

  it('an in-flight swap disables only that card’s Swap button', async () => {
    const user = await planOnScreen();
    const swapButtons = screen.getAllByRole('button', { name: /Swap/i });
    await user.click(swapButtons[0]);
    expect(within(document.querySelector('.swap-drawer')).getAllByRole('button').length).toBeGreaterThan(2);
  });

  // FIXED (was a race): handleSwapExercise / handleAdaptDay build `updated` from the `plan` captured when the
  // click happened and `await` an AI call (seconds with Gemini). Two swaps started before the first
  // returns both start from the SAME old plan, so the second setPlan/savePlan overwrites the first
  // swap. busyKey only guards the *same* card. Fix: use functional setPlan(prev => …).
  it('two swaps started back-to-back on different cards both survive', async () => {
    await planOnScreen();
    const before = exerciseTitles();

    fireEvent.click(screen.getAllByRole('button', { name: /Swap/i })[0]);
    fireEvent.click(screen.getByRole('button', { name: /Equipment is busy/i }));
    fireEvent.click(screen.getAllByRole('button', { name: /Swap/i })[1]);
    fireEvent.click(screen.getByRole('button', { name: /Want a fresh variation/i }));

    await waitFor(() => {
      const after = exerciseTitles();
      expect(after[0]).not.toBe(before[0]);
      expect(after[1]).not.toBe(before[1]);
    });
  });
});

describe('Accessibility', () => {
  // FIXED A11Y: in AssessmentForm every <label> is a sibling of its control with no htmlFor/id (or
  // nesting), so screen readers announce "edit text" with no name and tapping a label doesn't focus.
  it('every form control on the Coach tab has an accessible name', () => {
    const { container } = render(<App />);
    const controls = container.querySelectorAll('main input:not([type=hidden]), main select, main textarea');
    const unnamed = [...controls].filter((el) => {
      if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return false;
      if (el.id && container.querySelector(`label[for="${el.id}"]`)) return false;
      if (el.closest('label')) return false;
      return true;
    });
    expect(unnamed.length).toBe(0);
  });

  it('bottom nav marks the active tab with aria-current', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole('button', { name: /Coach/i })).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getByRole('button', { name: /Exercises/i }));
    expect(screen.getByRole('button', { name: /Exercises/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText(/Personal Exercise Library/i)).toBeInTheDocument();
  });
});

describe('Resilience', () => {
  // FIXED: App initialises state with loadApiKey()/loadModel() (unguarded getItem). If storage access is
  // denied the first render throws and the user gets a blank white page.
  it('renders (in local mode) even if localStorage access throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    try {
      expect(() => render(<App />)).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('Concurrent swaps on the same day', () => {
  it('never end up with the same exercise twice, and neither swap is lost', async () => {
    localStorage.setItem('mf_byok_gemini_api_key', 'k');
    localStorage.setItem('mf_profile_v1', JSON.stringify({ daysPerWeek: 2, programWeeks: 1 }));
    const exs = (ids) => ids.map((i) => ({ exercise_id: i, sets: 3, rep_min: 8, rep_max: 10, target_rpe: 7, rest_seconds: 75, coach_note: 'n' }));
    const day = (n, ids) => ({ day_id: `d${n}`, day_label: `Day ${n}`, focus: 'f', estimated_minutes: 40, warmup_checklist: ['a'], exercises: exs(ids) });
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{ finishReason: 'STOP' }],
      text: JSON.stringify({
        program_title: 'T', coach_summary: 's', program_strategy: 'p', weekly_progression_tip: 'w', week_progressions: [],
        base_days: [day(1, ['goblet_squat', 'machine_chest_press', 'dead_bug', 'worlds_greatest_stretch']), day(2, ['leg_press', 'db_floor_press', 'pallof_press', 'cat_cow_thoracic'])],
      }),
    });
    // Both in-flight swaps are told to use the same replacement.
    const swapReply = { candidates: [{ finishReason: 'STOP' }], text: JSON.stringify({ exercise_id: 'lat_pulldown_neutral', sets: 3, rep_min: 8, rep_max: 10, target_rpe: 7, rest_seconds: 75, coach_note: 'n', swap_rationale: 'r' }) };
    mockGenerateContent.mockResolvedValueOnce(swapReply).mockResolvedValueOnce(swapReply);

    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Generate 1-Week Block with Gemini/i }));
    await waitFor(() => expect(exerciseTitles()).toHaveLength(4));
    const before = exerciseTitles();

    fireEvent.click(screen.getAllByRole('button', { name: /Swap/i })[0]);
    fireEvent.click(screen.getByRole('button', { name: /Equipment is busy/i }));
    fireEvent.click(screen.getAllByRole('button', { name: /Swap/i })[1]);
    fireEvent.click(screen.getByRole('button', { name: /Want a fresh variation/i }));

    await waitFor(() => {
      const after = exerciseTitles();
      expect(after[0]).not.toBe(before[0]);
      expect(after[1]).not.toBe(before[1]);
    });
    const after = exerciseTitles();
    expect(new Set(after).size).toBe(after.length);
  });
});
