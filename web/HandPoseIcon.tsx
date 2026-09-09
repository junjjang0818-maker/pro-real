import React from 'react';

/**
 * Schematic hand diagram so the user can SEE which shape to make.
 * `fingers` = [thumb, index, middle, ring, pinky] — true = extended.
 */
export function HandPoseIcon({
  fingers,
  size = 120,
}: {
  fingers: [boolean, boolean, boolean, boolean, boolean];
  size?: number;
}) {
  const [thumb, index, middle, ring, pinky] = fingers;
  const up = 'var(--accent)';
  const down = 'var(--panel-2)';
  const line = 'var(--line)';

  // 4 straight fingers above the palm
  const cols = [
    { x: 30, tall: 6, ext: index }, // index
    { x: 43.5, tall: 2, ext: middle }, // middle (tallest)
    { x: 57, tall: 6, ext: ring }, // ring
    { x: 69.5, tall: 12, ext: pinky }, // pinky (shortest)
  ];

  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label="hand pose">
      {/* palm */}
      <rect x="24" y="54" width="52" height="38" rx="14" fill={down} stroke={line} strokeWidth="2" />

      {/* thumb */}
      <g transform="rotate(-38 24 74)">
        <rect
          x={thumb ? 2 : 12}
          y="66"
          width={thumb ? 22 : 13}
          height="15"
          rx="7.5"
          fill={thumb ? up : down}
          stroke={line}
          strokeWidth="2"
        />
      </g>

      {/* fingers */}
      {cols.map((c, i) => {
        const top = c.ext ? 10 + c.tall : 44;
        const h = 58 - top;
        return (
          <rect
            key={i}
            x={c.x}
            y={top}
            width="10.5"
            height={h}
            rx="5.25"
            fill={c.ext ? up : down}
            stroke={line}
            strokeWidth="2"
          />
        );
      })}
    </svg>
  );
}
