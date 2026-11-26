import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';

describe('Repwise End-to-End UI Flow', () => {
  it('renders clean vector bottom tabs (Coach, Workout, Ask, Progress, Exercises) without raw emojis', () => {
    render(<App />);
    const nav = screen.getByRole('navigation', { name: /Primary navigation/i });
    expect(nav).toHaveTextContent('Coach');
    expect(nav).toHaveTextContent('Workout');
    expect(nav).toHaveTextContent('Ask');
    expect(nav).toHaveTextContent('Progress');
    expect(nav).toHaveTextContent('Exercises');
    expect(nav.textContent).not.toMatch(/[🎯⚡📚]/);
    expect(nav.querySelectorAll('svg').length).toBe(5);
  });

  it('generates a 4-week training block and shows real start/finish photos for each exercise', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /Generate 4-Week Block/i }));
    expect(await screen.findByText('Week 1')).toBeInTheDocument();
    expect(screen.getByText('Week 4')).toBeInTheDocument();

    const starts = screen.getAllByRole('img', { name: /start position$/ });
    const finishes = screen.getAllByRole('img', { name: /finish position$/ });
    expect(starts.length).toBeGreaterThan(1);
    expect(finishes.length).toBe(starts.length);
    expect(starts[0].getAttribute('src')).toMatch(/photos\/[^/]+\/0\.jpg$/);
    expect(finishes[0].getAttribute('src')).toMatch(/photos\/[^/]+\/1\.jpg$/);

    // Holding the finish position stops the loop on that frame
    expect(starts[0].parentElement).toHaveClass('is-looping'); // CSS-driven loop, no JS timer
    await user.click(screen.getAllByRole('button', { name: 'Finish' })[0]);
    expect(finishes[0].parentElement).toHaveClass('is-finish');
    expect(finishes[0].parentElement).not.toHaveClass('is-looping');
    expect(screen.getAllByRole('button', { name: 'Play' }).length).toBeGreaterThan(0);
  });

  it('swaps an exercise on Day 1 without duplicating another exercise on that day', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /Generate 4-Week Block/i }));
    await screen.findByText('Week 1');

    const getDayExerciseTitles = () =>
      screen
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent)
        .filter((t) => /^\d+\.\s/.test(t))
        .map((t) => t.replace(/^\d+\.\s/, ''));

    const beforeTitles = getDayExerciseTitles();
    expect(new Set(beforeTitles).size).toBe(beforeTitles.length);

    const swapButtons = screen.getAllByRole('button', { name: /Swap/i });
    await user.click(swapButtons[0]);
    await user.click(screen.getByRole('button', { name: /Equipment is busy/i }));

    await waitFor(() => {
      const afterTitles = getDayExerciseTitles();
      expect(afterTitles[0]).not.toBe(beforeTitles[0]);
      expect(new Set(afterTitles).size).toBe(afterTitles.length);
    });
  });

  it('opens BYOK Settings modal and lets user switch to imperial units', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /ft \/ lbs/i }));
    expect(screen.getByText(/Weight \(lbs\)/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /API Key/i }));
    expect(screen.getByText(/BYOK AI Settings & Backup/i)).toBeInTheDocument();
  });
});
