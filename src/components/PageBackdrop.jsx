import React from 'react';

const SCENES = new Set(['assess', 'routine', 'ask', 'library', 'progress', 'health']);
const base = (import.meta.env?.BASE_URL || './').replace(/\/?$/, '/');

/** A soft gym photo across the top of each page, fading into the surface. Decorative only; it scrolls away. */
export default function PageBackdrop({ tab }) {
  const scene = SCENES.has(tab) ? tab : 'assess';
  return <div className="page-backdrop" aria-hidden="true" style={{ backgroundImage: `url(${base}bg/${scene}.jpg)` }} />;
}
