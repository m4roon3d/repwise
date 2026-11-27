/** Number boxes: clearing and retyping must not leave a stuck leading 0 ("071"). */
import React, { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NumberInput from '../components/NumberInput';

function Harness({ start }) {
  const [age, setAge] = useState(start);
  return (
    <>
      <NumberInput aria-label="Age" value={age} onValue={setAge} />
      <output>{String(age)}</output>
    </>
  );
}

describe('NumberInput', () => {
  it('can be cleared and retyped without a leading 0', async () => {
    const user = userEvent.setup();
    render(<Harness start={48} />);
    const box = screen.getByLabelText('Age');
    await user.clear(box);
    expect(box).toHaveValue(null); // empty while editing, not 0
    expect(screen.getByRole('status')).toHaveTextContent('48'); // saved value untouched by an empty box
    await user.type(box, '71');
    expect(box).toHaveValue(71);
    expect(screen.getByRole('status')).toHaveTextContent('71');
  });

  it('shows the saved value again if left empty', async () => {
    const user = userEvent.setup();
    render(<Harness start={90.3} />);
    const box = screen.getByLabelText('Age');
    await user.clear(box);
    await user.tab();
    expect(box).toHaveValue(90.3);
  });
});
