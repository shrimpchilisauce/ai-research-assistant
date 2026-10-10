import type { Card } from '../engine/cards';
import type { GameClock } from '../engine/clock';
import type { HandResult, HandState, LogEntry, Seat } from '../engine/hand';
import type { AnteType, Settings } from '../engine/settings';
import type { MatchSummary, Phase } from '../shared/protocol';

/** 部屋の永続化される状態（Durable Object のストレージに丸ごと保存する）。 */

export interface PlayerSlot {
  name: string;
  token: string;
  ready: boolean;
  rematch: boolean;
}

export interface Turn {
  seat: Seat;
  /** 持ち時間の締め切り（ゲーム時間）。これを過ぎるとタイムバンクを消費する。 */
  baseDeadline: number;
}

export interface PendingStep {
  kind: 'runout' | 'nextHand';
  /** 実行するゲーム時間。 */
  at: number;
}

export interface Pause {
  by: Seat | null;
  /** 再開カウントダウンの終了時刻（実時間）。 */
  resumeAt: number | null;
}

export interface MatchState {
  stacks: [number, number];
  nextButton: Seat;
  handNumber: number;
  hand: HandState | null;
  clock: GameClock;
  timebankMs: [number, number];
  turn: Turn | null;
  pending: PendingStep | null;
  pause: Pause | null;
  maxLevelIndex: number;
  finished: MatchSummary | null;
}

export interface RoomState {
  id: string;
  createdAt: number;
  phase: Phase;
  settings: Settings;
  players: [PlayerSlot | null, PlayerSlot | null];
  /** 開始カウントダウンの終了時刻（実時間）。 */
  startAt: number | null;
  matchNumber: number;
  match: MatchState | null;
  /** 最後に誰かが接続していた時刻（実時間）。 */
  lastActiveAt: number;
}

/** ハンド履歴として保存する1ハンド分の記録（デッキは含めない）。 */
export interface HandRecord {
  handNumber: number;
  levelIndex: number;
  sb: number;
  bb: number;
  ante: number;
  anteType: AnteType;
  button: Seat;
  startStacks: [number, number];
  endStacks: [number, number];
  hole: [Card[], Card[]];
  board: Card[];
  log: LogEntry[];
  allInShowdown: boolean;
  result: HandResult;
}
