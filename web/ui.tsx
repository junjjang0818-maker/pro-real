import React from 'react';

export function Card({ title, children, right }: { title?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="card">
      {(title || right) && (
        <div className="row spread" style={{ marginBottom: 10 }}>
          {title ? <h2 style={{ margin: 0 }}>{title}</h2> : <span />}
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

export function Bar({ value, tone = 'accent' }: { value: number; tone?: 'accent' | 'good' | 'warn' | 'bad' }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={`bar ${tone === 'accent' ? '' : tone}`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Tag({ children, tone }: { children: React.ReactNode; tone?: 'on' | 'err' }) {
  return <span className={`tag ${tone ?? ''}`}>{children}</span>;
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function NumberRow({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="row spread small muted">
        <span>{label}</span>
        <span>
          {value}
          {suffix ? ` ${suffix}` : ''}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (b: boolean) => void; label: string }) {
  return (
    <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
