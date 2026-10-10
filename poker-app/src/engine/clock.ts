/**
 * 一時停止できる「ゲーム時間」の時計。
 * レベル・持ち時間・演出の待ち時間はすべてゲーム時間で管理するので、
 * 一時停止すると全部まとめて止まる。
 */
export interface GameClock {
  /** 直近の停止までに経過したゲーム時間（ms）。 */
  accumulatedMs: number;
  /** 動いている場合、動き始めた実時刻（ms）。止まっていれば null。 */
  runningSince: number | null;
}

export function startedClock(wallNow: number): GameClock {
  return { accumulatedMs: 0, runningSince: wallNow };
}

export function clockNow(c: GameClock, wallNow: number): number {
  return c.accumulatedMs + (c.runningSince === null ? 0 : Math.max(0, wallNow - c.runningSince));
}

export function pauseClock(c: GameClock, wallNow: number): GameClock {
  if (c.runningSince === null) return c;
  return { accumulatedMs: clockNow(c, wallNow), runningSince: null };
}

export function resumeClock(c: GameClock, wallNow: number): GameClock {
  if (c.runningSince !== null) return c;
  return { accumulatedMs: c.accumulatedMs, runningSince: wallNow };
}

/** ゲーム時間を実時刻に変換する（止まっていれば null）。 */
export function gameToWall(c: GameClock, gameMs: number): number | null {
  if (c.runningSince === null) return null;
  return c.runningSince + (gameMs - c.accumulatedMs);
}
