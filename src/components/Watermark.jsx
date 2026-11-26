import React from 'react';

const SCENES = new Set(['assess', 'routine', 'ask', 'library', 'progress', 'health']);
const base = (import.meta.env?.BASE_URL || './').replace(/\/?$/, '/');

/** A washed-out real gym scene behind the app, different on each tab. Decorative only. */
export default function Watermark({ tab }) {
  const scene = SCENES.has(tab) ? tab : 'assess';
  return (
    <div className="bg-scene" aria-hidden="true">
      <div className="bg-scene-img" style={{ backgroundImage: `url(${base}bg/${scene}.jpg)` }} />
    </div>
  );
}
