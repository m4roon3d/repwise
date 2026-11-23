import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';

describe('Repwise End-to-End UI Flow', () => {
  it('renders clean vector bottom tabs (Coach, Workout, Ask, Exercises) without raw emojis', () => {
    render(<App />);
    const nav = screen.getByRole('navigation', { name: /Primary navigation/i });
    expect(nav).toHaveTextContent('Coach');
    expect(nav).toHaveTextContent('Workout');
    expect(nav).toHaveTextContent('Ask');
    expect(nav).toHaveTextContent('Exercises');
    expect(nav.textContent).not.toMatch(/[🎯⚡📚]/);
    expect(nav.querySelectorAll('svg').length).toBe(4);
  });

  it('generates a 4-week training block with unique SVG IDs and working multi-angle camera controls', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    const generateBtn = screen.getByRole('button', { name: /Generate 4-Week Block/i });
    await user.click(generateBtn);

    expect(await screen.findByText('Week 1')).toBeInTheDocument();
    expect(screen.getByText('Week 4')).toBeInTheDocument();

    // Every rendered SVG radialGradient must have a unique ID
    const gradIds = Array.from(container.querySelectorAll('radialGradient')).map((el) =>
      el.getAttribute('id')
    );
    expect(gradIds.length).toBeGreaterThan(1);
    expect(new Set(gradIds).size).toBe(gradIds.length);

    // Switch first exercise animation to Front (0°) and Side (90°) angles
    const frontButtons = screen.getAllByRole('button', { name: /^Front$/i });
    await user.click(frontButtons[0]);
    expect(screen.getAllByText('0°').length).toBeGreaterThan(0);

    const sideButtons = screen.getAllByRole('button', { name: /^Side$/i });
    await user.click(sideButtons[0]);
    expect(screen.getAllByText('90°').length).toBeGreaterThan(0);
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
