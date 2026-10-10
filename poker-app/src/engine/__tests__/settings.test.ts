import { describe, expect, it } from 'vitest';
import { cryptoRandomInt, fullDeck, shuffle } from '../cards';
import { clockNow, gameToWall, pauseClock, resumeClock, startedClock } from '../clock';
import {
  defaultSettings,
  levelIndexAt,
  msUntilNextLevel,
  parseSettings,
  presetSettings,
  validateSettings,
  withAnteType,
} from '../settings';

describe('presets', () => {
  it('differ only by starting stack and level time', () => {
    const t = presetSettings('turbo');
    const d = presetSettings('deep');
    expect([t.startingStack, t.levelMinutes]).toEqual([10_000, 5]);
    expect([d.startingStack, d.levelMinutes]).toEqual([20_000, 15]);
    expect(t.levels).toEqual(d.levels);
    expect(t.levels).toHaveLength(20);
    expect(validateSettings(t)).toEqual({ errors: [], warnings: [] });
  });

  it('fills antes when switching the ante type', () => {
    const s = defaultSettings();
    expect(withAnteType(s, 'bb').levels[0].ante).toBe(100);
    expect(withAnteType(s, 'each').levels[0].ante).toBe(10);
    expect(withAnteType(withAnteType(s, 'bb'), 'none').levels[0].ante).toBe(0);
  });
});

describe('validateSettings', () => {
  it('reports errors that block the start', () => {
    const s = defaultSettings();
    s.levels[2] = { sb: 300, bb: 200, ante: 0 };
    s.startingStack = 50;
    s.actionSeconds = 5;
    const { errors } = validateSettings(s);
    expect(errors).toContain('Lv.3: BB は SB 以上にしてください');
    expect(errors.some((e) => e.startsWith('初期スタック'))).toBe(true);
    expect(errors.some((e) => e.startsWith('持ち時間'))).toBe(true);
  });

  it('reports warnings that still allow the start', () => {
    const s = defaultSettings();
    s.levels[3] = { sb: 50, bb: 100, ante: 0 };
    s.startingStack = 500;
    const { errors, warnings } = validateSettings(s);
    expect(errors).toEqual([]);
    expect(warnings).toContain('Lv.4: BB が前のレベルより小さくなっています');
    expect(warnings).toContain('初期スタックが Lv.1 の BB の 10 倍未満です');
  });

  it('rejects non-integers and empty tables', () => {
    const s = defaultSettings();
    s.levels[0].sb = 1.5;
    expect(validateSettings(s).errors).toHaveLength(1);
    expect(validateSettings({ ...defaultSettings(), levels: [] }).errors).toHaveLength(1);
  });
});

describe('parseSettings', () => {
  it('accepts well-formed input and rejects malformed input', () => {
    expect(parseSettings(JSON.parse(JSON.stringify(defaultSettings())))).toEqual(defaultSettings());
    expect(parseSettings(null)).toBeNull();
    expect(parseSettings({ ...defaultSettings(), anteType: 'x' })).toBeNull();
    expect(parseSettings({ ...defaultSettings(), levels: [{ sb: '1', bb: 2, ante: 0 }] })).toBeNull();
    expect(parseSettings({ ...defaultSettings(), levels: Array(41).fill({ sb: 1, bb: 2, ante: 0 }) })).toBeNull();
  });
});

describe('levels over time', () => {
  const s = { ...defaultSettings(), levelMinutes: 10 };
  const min = 60_000;

  it('advances one level per level duration and stops at the last level', () => {
    expect(levelIndexAt(0, s)).toBe(0);
    expect(levelIndexAt(10 * min - 1, s)).toBe(0);
    expect(levelIndexAt(10 * min, s)).toBe(1);
    expect(levelIndexAt(10_000 * min, s)).toBe(19);
  });

  it('reports time until the next level', () => {
    expect(msUntilNextLevel(3 * min, s)).toBe(7 * min);
    expect(msUntilNextLevel(19 * 10 * min, s)).toBeNull();
  });
});

describe('game clock', () => {
  it('stops while paused', () => {
    let c = startedClock(1_000);
    expect(clockNow(c, 4_000)).toBe(3_000);
    c = pauseClock(c, 4_000);
    expect(clockNow(c, 60_000)).toBe(3_000);
    expect(gameToWall(c, 5_000)).toBeNull();
    c = resumeClock(c, 60_000);
    expect(clockNow(c, 61_000)).toBe(4_000);
    expect(gameToWall(c, 5_000)).toBe(62_000);
  });
});

describe('shuffle', () => {
  it('permutes the full deck', () => {
    const d = shuffle(fullDeck(), cryptoRandomInt);
    expect(d).toHaveLength(52);
    expect(new Set(d).size).toBe(52);
    expect([...d].sort()).toEqual([...fullDeck()].sort());
  });

  it('draws within range', () => {
    for (let i = 0; i < 1_000; i++) {
      const v = cryptoRandomInt(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
  });
});
