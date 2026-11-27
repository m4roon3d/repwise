import React, { useState } from 'react';

/**
 * A number box that lets you clear it and retype. A plain controlled input turns "" into 0 on every
 * keystroke, so a stray leading 0 sticks ("071"). Here the text you type is kept while you edit; only a
 * real number is passed on, and on leaving the box it shows the saved value again.
 */
export default function NumberInput({ value, onValue, onBlur, inputMode = 'decimal', ...rest }) {
  const [draft, setDraft] = useState(null);
  const shown = draft ?? (value ?? '');
  return (
    <input
      type="number"
      inputMode={inputMode}
      {...rest}
      value={shown}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        if (text.trim() !== '' && Number.isFinite(Number(text))) onValue(Number(text));
      }}
      onBlur={(e) => {
        setDraft(null);
        onBlur?.(e);
      }}
    />
  );
}
