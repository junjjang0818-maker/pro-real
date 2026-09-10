import React from 'react';

export type Bool5 = [boolean, boolean, boolean, boolean, boolean]; // thumb, index, middle, ring, pinky

/**
 * Large schematic hand so the user can clearly SEE the shape to make.
 * Extended fingers are drawn tall + accent-coloured; curled ones are short stubs.
 */
export function HandPoseIcon({ fingers, size = 168 }: { fingers: Bool5; size?: number }) {
  const [thumb, index, middle, ring, pinky] = fingers;
  const UP = 'var(--accent)';
  const DOWN = 'var(--panel-2)';
  const LINE = 'var(--line)';

  // 4 straight fingers: x-centre, extended-top-y (smaller = taller), width
  const F = [
    { x: 34, top: index ? 18 : 46, ext: index },
    { x: 47, top: middle ? 10 : 46, ext: middle }, // middle tallest
    { x: 60, top: ring ? 18 : 46, ext: ring },
    { x: 72, top: pinky ? 26 : 46, ext: pinky }, // pinky shortest
  ];
  const FW = 10;

  return (
    <svg viewBox="0 0 100 108" width={size} height={size * 1.08} role="img" aria-label="손 모양">
      {/* wrist */}
      <rect x="40" y="94" width="24" height="14" rx="6" fill={DOWN} stroke={LINE} strokeWidth="2" />
      {/* palm */}
      <rect x="26" y="52" width="52" height="44" rx="16" fill={DOWN} stroke={LINE} strokeWidth="2" />

      {/* thumb (off lower-left, rotated) */}
      <g transform="rotate(-42 26 72)">
        <rect
          x={thumb ? 0 : 12}
          y="64"
          width={thumb ? 24 : 13}
          height="16"
          rx="8"
          fill={thumb ? UP : DOWN}
          stroke={LINE}
          strokeWidth="2"
        />
      </g>

      {/* 4 fingers */}
      {F.map((f, i) => (
        <rect
          key={i}
          x={f.x - FW / 2}
          y={f.top}
          width={FW}
          height={56 - f.top}
          rx={FW / 2}
          fill={f.ext ? UP : DOWN}
          stroke={LINE}
          strokeWidth="2"
        />
      ))}
    </svg>
  );
}
