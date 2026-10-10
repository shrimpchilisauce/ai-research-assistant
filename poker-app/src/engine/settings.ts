export interface BlindLevel {
  sb: number;
  bb: number;
  ante: number;
}

export type AnteType = 'none' | 'bb' | 'each';
export type PresetId = 'turbo' | 'normal' | 'deep';

export interface Settings {
  preset: PresetId | 'custom';
  startingStack: number;
  levels: BlindLevel[];
  anteType: AnteType;
  levelMinutes: number;
  actionSeconds: number;
  timebankSeconds: number;
}

export const LIMITS = {
  startingStack: { min: 100, max: 10_000_000 },
  levels: { min: 1, max: 40 },
  chip: { max: 100_000_000 },
  levelMinutes: { min: 1, max: 60 },
  actionSeconds: { min: 10, max: 120, step: 5 },
  timebankSeconds: { min: 0, max: 300, step: 10 },
} as const;

export const ANTE_TYPE_LABELS: Record<AnteType, string> = {
  none: 'なし',
  bb: 'BBアンテ',
  each: '各自アンテ',
};

const BASE_BLINDS: [number, number][] = [
  [50, 100],
  [75, 150],
  [100, 200],
  [150, 300],
  [200, 400],
  [300, 600],
  [400, 800],
  [500, 1_000],
  [600, 1_200],
  [800, 1_600],
  [1_000, 2_000],
  [1_500, 3_000],
  [2_000, 4_000],
  [3_000, 6_000],
  [4_000, 8_000],
  [5_000, 10_000],
  [6_000, 12_000],
  [8_000, 16_000],
  [10_000, 20_000],
  [15_000, 30_000],
];

export const PRESETS: Record<PresetId, { label: string; startingStack: number; levelMinutes: number }> = {
  turbo: { label: 'ターボ', startingStack: 10_000, levelMinutes: 5 },
  normal: { label: '通常', startingStack: 10_000, levelMinutes: 10 },
  deep: { label: 'ディープ', startingStack: 20_000, levelMinutes: 15 },
};

export function defaultAnte(bb: number, anteType: AnteType): number {
  if (anteType === 'bb') return bb;
  if (anteType === 'each') return Math.max(1, Math.round(bb / 10));
  return 0;
}

export function presetSettings(id: PresetId, anteType: AnteType = 'none'): Settings {
  const p = PRESETS[id];
  return {
    preset: id,
    startingStack: p.startingStack,
    levels: BASE_BLINDS.map(([sb, bb]) => ({ sb, bb, ante: defaultAnte(bb, anteType) })),
    anteType,
    levelMinutes: p.levelMinutes,
    actionSeconds: 30,
    timebankSeconds: 60,
  };
}

export function defaultSettings(): Settings {
  return presetSettings('normal');
}

/** アンテ方式を切り替え、アンテ列を標準値で埋め直す。 */
export function withAnteType(s: Settings, anteType: AnteType): Settings {
  return {
    ...s,
    anteType,
    levels: s.levels.map((l) => ({ ...l, ante: defaultAnte(l.bb, anteType) })),
  };
}

/** アンテ方式が「なし」なら 0 として扱う。 */
export function effectiveAnte(level: BlindLevel, anteType: AnteType): number {
  return anteType === 'none' ? 0 : level.ante;
}

export interface SettingsCheck {
  errors: string[];
  warnings: string[];
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const fmt = (n: number) => n.toLocaleString('ja-JP');

export function validateSettings(s: Settings): SettingsCheck {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isInt(s.startingStack) || s.startingStack < LIMITS.startingStack.min || s.startingStack > LIMITS.startingStack.max) {
    errors.push(`初期スタックは ${fmt(LIMITS.startingStack.min)}〜${fmt(LIMITS.startingStack.max)} の整数にしてください`);
  }
  if (s.levels.length < LIMITS.levels.min || s.levels.length > LIMITS.levels.max) {
    errors.push(`レベル数は ${LIMITS.levels.min}〜${LIMITS.levels.max} にしてください`);
  }
  s.levels.forEach((l, i) => {
    const lv = `Lv.${i + 1}`;
    if (!isInt(l.sb) || l.sb < 1 || l.sb > LIMITS.chip.max) errors.push(`${lv}: SB は 1 以上の整数にしてください`);
    if (!isInt(l.bb) || l.bb > LIMITS.chip.max) errors.push(`${lv}: BB は整数にしてください`);
    else if (isInt(l.sb) && l.bb < l.sb) errors.push(`${lv}: BB は SB 以上にしてください`);
    if (s.anteType !== 'none' && (!isInt(l.ante) || l.ante < 0 || l.ante > LIMITS.chip.max)) {
      errors.push(`${lv}: アンテは 0 以上の整数にしてください`);
    }
    const prev = s.levels[i - 1];
    if (prev && isInt(l.bb) && isInt(prev.bb) && l.bb < prev.bb) {
      warnings.push(`${lv}: BB が前のレベルより小さくなっています`);
    }
  });
  if (!isInt(s.levelMinutes) || s.levelMinutes < LIMITS.levelMinutes.min || s.levelMinutes > LIMITS.levelMinutes.max) {
    errors.push(`レベル時間は ${LIMITS.levelMinutes.min}〜${LIMITS.levelMinutes.max} 分にしてください`);
  }
  if (!isInt(s.actionSeconds) || s.actionSeconds < LIMITS.actionSeconds.min || s.actionSeconds > LIMITS.actionSeconds.max) {
    errors.push(`持ち時間は ${LIMITS.actionSeconds.min}〜${LIMITS.actionSeconds.max} 秒にしてください`);
  }
  if (!isInt(s.timebankSeconds) || s.timebankSeconds < LIMITS.timebankSeconds.min || s.timebankSeconds > LIMITS.timebankSeconds.max) {
    errors.push(`タイムバンクは ${LIMITS.timebankSeconds.min}〜${LIMITS.timebankSeconds.max} 秒にしてください`);
  }
  if (errors.length === 0 && s.startingStack < s.levels[0].bb * 10) {
    warnings.push('初期スタックが Lv.1 の BB の 10 倍未満です');
  }
  return { errors, warnings };
}

/** クライアントから届いた未検証の値を Settings の形に整える（形が違えば null）。 */
export function parseSettings(input: unknown): Settings | null {
  if (typeof input !== 'object' || input === null) return null;
  const o = input as Record<string, unknown>;
  const presets = ['turbo', 'normal', 'deep', 'custom'];
  const anteTypes = ['none', 'bb', 'each'];
  if (typeof o.preset !== 'string' || !presets.includes(o.preset)) return null;
  if (typeof o.anteType !== 'string' || !anteTypes.includes(o.anteType)) return null;
  if (!Array.isArray(o.levels) || o.levels.length > LIMITS.levels.max) return null;
  const levels: BlindLevel[] = [];
  for (const l of o.levels) {
    if (typeof l !== 'object' || l === null) return null;
    const { sb, bb, ante } = l as Record<string, unknown>;
    if (typeof sb !== 'number' || typeof bb !== 'number' || typeof ante !== 'number') return null;
    levels.push({ sb, bb, ante });
  }
  const nums = ['startingStack', 'levelMinutes', 'actionSeconds', 'timebankSeconds'] as const;
  for (const k of nums) if (typeof o[k] !== 'number') return null;
  return {
    preset: o.preset as Settings['preset'],
    startingStack: o.startingStack as number,
    levels,
    anteType: o.anteType as AnteType,
    levelMinutes: o.levelMinutes as number,
    actionSeconds: o.actionSeconds as number,
    timebankSeconds: o.timebankSeconds as number,
  };
}

/** トーナメントクロックの経過時間から現在のレベル（0始まり）を求める。 */
export function levelIndexAt(elapsedMs: number, s: Settings): number {
  const idx = Math.floor(Math.max(0, elapsedMs) / (s.levelMinutes * 60_000));
  return Math.min(idx, s.levels.length - 1);
}

/** 次のレベルに上がるまでの残り時間（最終レベルなら null）。 */
export function msUntilNextLevel(elapsedMs: number, s: Settings): number | null {
  const idx = levelIndexAt(elapsedMs, s);
  if (idx >= s.levels.length - 1) return null;
  return (idx + 1) * s.levelMinutes * 60_000 - elapsedMs;
}
