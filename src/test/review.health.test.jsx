import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';

/* -------------------------------------------------------- health notice */
describe('health & safety notice', () => {
  it('shows the full notice first, then a compact reminder once acknowledged (and remembers it)', async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    expect(screen.getByRole('heading', { name: /Before you start/i })).toBeInTheDocument();
    expect(screen.getByText(/chest pain or pressure/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /I understand/i }));
    expect(screen.queryByRole('heading', { name: /Before you start/i })).not.toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(/not medical advice/i);
    expect(localStorage.getItem('mf_health_notice_ack_v1')).toBe('1');
    first.unmount();

    render(<App />);
    expect(screen.queryByRole('heading', { name: /Before you start/i })).not.toBeInTheDocument();
  });

  it('does not block plan generation and the reminder follows the user into the Workout tab', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Generate 4-Week Block/i }));
    expect(await screen.findByText('Week 1')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(/not medical advice/i);
  });
});
