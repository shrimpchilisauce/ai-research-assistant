import type { Card } from '../engine/cards';
import type { GameClock } from '../engine/clock';
import type { HandStatus, LegalActions, LogEntry, PlayerAction, Seat, Street } from '../engine/hand';
import type { AnteType, Settings } from '../engine/settings';

/** クライアント → サーバー */
export type ClientMessage =
  | { t: 'hello'; token?: string }
  | { t: 'join'; name: string }
  | { t: 'settings'; settings: Settings }
  | { t: 'ready'; ready: boolean }
  | { t: 'act'; handNumber: number; action: PlayerAction }
  | { t: 'pause' }
  | { t: 'resume' }
  | { t: 'show'; handNumber: number }
  | { t: 'resign' }
  | { t: 'rematch' }
  | { t: 'history' }
  | { t: 'ping'; c: number };

/** サーバー → クライアント */
export type ServerMessage =
  /** token は参加したときだけ入る。canJoin は席が空いているか。 */
  | { t: 'welcome'; seat: Seat | null; token?: string; canJoin: boolean }
  | { t: 'state'; view: RoomView; events: GameEvent[] }
  | { t: 'history'; matchNumber: number; hands: HandRecordView[] }
  | { t: 'error'; code: string; message: string }
  | { t: 'pong'; c: number; s: number };

export type Phase = 'lobby' | 'starting' | 'playing' | 'finished';

export interface PlayerView {
  name: string;
  connected: boolean;
  ready: boolean;
  rematch: boolean;
}

export interface RoomView {
  roomId: string;
  /** このメッセージを作ったときのサーバー時刻（ms）。 */
  serverNow: number;
  phase: Phase;
  you: Seat | null;
  /** 0 がホスト。 */
  players: [PlayerView | null, PlayerView | null];
  settings: Settings;
  /** 開始カウントダウンの終了時刻（サーバー時刻）。 */
  startAt: number | null;
  match: MatchView | null;
}

export interface TurnView {
  seat: Seat;
  /** 持ち時間の締め切り（ゲーム時間）。 */
  baseDeadline: number;
  /** タイムバンク込みの締め切り（ゲーム時間）。 */
  deadline: number;
}

export interface PauseView {
  /** null は両者切断による自動停止。 */
  by: Seat | null;
  /** 再開カウントダウンの終了時刻（サーバー時刻）。 */
  resumeAt: number | null;
}

export interface MatchSummary {
  winner: Seat;
  reason: 'bust' | 'resign';
  durationMs: number;
  hands: number;
  maxLevelIndex: number;
}

export interface MatchView {
  matchNumber: number;
  stacks: [number, number];
  handNumber: number;
  clock: GameClock;
  timebankMs: [number, number];
  turn: TurnView | null;
  pause: PauseView | null;
  hand: HandView | null;
  finished: MatchSummary | null;
}

export interface EvalView {
  name: string;
  cards: Card[];
}

export interface ResultView {
  winners: Seat[];
  payouts: [number, number];
  returned: [number, number];
  pot: number;
  showdown: boolean;
  foldedSeat: Seat | null;
  shown: [boolean, boolean];
  evals: [EvalView | null, EvalView | null];
}

export interface HandView {
  handNumber: number;
  levelIndex: number;
  sb: number;
  bb: number;
  ante: number;
  anteType: AnteType;
  button: Seat;
  startStacks: [number, number];
  stacks: [number, number];
  /** 見えない手札は null。 */
  hole: [Card[] | null, Card[] | null];
  board: Card[];
  street: Street;
  streetBets: [number, number];
  committed: [number, number];
  dead: number;
  status: HandStatus;
  toAct: Seat | null;
  allInShowdown: boolean;
  log: LogEntry[];
  /** 自分の手番のときだけ入る。 */
  legal: LegalActions | null;
  result: ResultView | null;
}

export interface HandRecordView {
  handNumber: number;
  levelIndex: number;
  sb: number;
  bb: number;
  ante: number;
  anteType: AnteType;
  button: Seat;
  startStacks: [number, number];
  endStacks: [number, number];
  hole: [Card[] | null, Card[] | null];
  board: Card[];
  log: LogEntry[];
  result: ResultView;
}

/** 効果音や演出のための出来事。すべて公開情報のみ。 */
export type GameEvent =
  | { type: 'handStart'; handNumber: number }
  | { type: 'action'; entry: LogEntry }
  | { type: 'street'; street: Street }
  | { type: 'reveal' }
  | { type: 'handEnd'; winners: Seat[] }
  | { type: 'paused'; by: Seat | null }
  | { type: 'resumed' }
  | { type: 'show'; seat: Seat }
  | { type: 'matchStart' }
  | { type: 'matchEnd'; winner: Seat };

export const NAME_MAX_LENGTH = 12;

/** ニックネームを整える。使えなければ null。 */
export function normalizeName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  // 制御文字を除き、前後の空白を落とす
  const name = input.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const length = [...name].length;
  if (length < 1 || length > NAME_MAX_LENGTH) return null;
  return name;
}
