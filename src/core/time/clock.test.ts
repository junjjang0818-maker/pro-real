import { describe, it, expect } from 'vitest';
import { FakeClock, SystemClock } from './clock';

describe('FakeClock', () => {
  it('advance() moves wall and monotonic together', () => {
    const c = new FakeClock({ wall: 1_000, monotonic: 0 });
    c.advance(5_000);
    const s = c.now();
    expect(s.wall).toBe(6_000);
    expect(s.monotonic).toBe(5_000);
  });

  it('advanceWallOnly() simulates an NTP jump — wall moves, monotonic does not', () => {
    const c = new FakeClock({ wall: 1_000, monotonic: 0 });
    c.advanceWallOnly(3_600_000);
    const s = c.now();
    expect(s.wall).toBe(3_601_000);
    expect(s.monotonic).toBe(0);
  });

  it('setWall() can move the clock backwards', () => {
    const c = new FakeClock({ wall: 10_000, monotonic: 0 });
    c.setWall(2_000);
    expect(c.now().wall).toBe(2_000);
  });

  it('reboot() resets monotonic and changes bootId', () => {
    const c = new FakeClock({ wall: 10_000, monotonic: 999_000, bootId: 'boot-1' });
    c.reboot('boot-2');
    const s = c.now();
    expect(s.monotonic).toBe(0);
    expect(s.bootId).toBe('boot-2');
    expect(s.wall).toBe(10_000); // wall survives a reboot
  });

  it('setTimezone() changes offset for subsequent reads only', () => {
    const c = new FakeClock({ wall: 0, tzId: 'Asia/Seoul', tzOffsetMin: 540 });
    expect(c.now().tzOffsetMin).toBe(540);
    c.setTimezone('America/Los_Angeles', -420);
    expect(c.now().tzOffsetMin).toBe(-420);
    expect(c.now().tzId).toBe('America/Los_Angeles');
  });
});

describe('SystemClock (bridge-less fallback)', () => {
  it('produces a plausible stamp without a native bridge', () => {
    const s = new SystemClock().now();
    expect(typeof s.wall).toBe('number');
    expect(s.wall).toBeGreaterThan(1_600_000_000_000);
    expect(typeof s.monotonic).toBe('number');
    expect(s.bootId).toBe('no-native-bridge');
    expect(typeof s.tzId).toBe('string');
    expect(typeof s.tzOffsetMin).toBe('number');
  });

  it('uses the native bridge when provided', () => {
    const s = new SystemClock({
      wallMs: () => 123,
      monotonicMs: () => 456,
      bootId: () => 'device-boot-xyz',
      tzId: () => 'Europe/Paris',
      tzOffsetMin: () => 120,
    }).now();
    expect(s).toEqual({
      wall: 123,
      monotonic: 456,
      bootId: 'device-boot-xyz',
      tzId: 'Europe/Paris',
      tzOffsetMin: 120,
    });
  });
});
