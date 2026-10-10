import type { Card } from './cards';
import { evaluateBest, type HandEval } from './evaluator';
import type { AnteType } from './settings';

/**
 * ヘッズアップ・ノーリミットホールデムの1ハンド分の進行。
 * 関数はすべて純粋で、入力の状態を変更せずに新しい状態を返す。
 */

export type Seat = 0 | 1;
export const other = (s: Seat): Seat => (s === 0 ? 1 : 0);

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
/** betting: 誰かの手番 / runout: オールインで残りのボードを配るだけ / complete: 終了 */
export type HandStatus = 'betting' | 'runout' | 'complete';

export type PlayerAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  /** to = このストリートで合計いくらにするか。ベットもこれで表す。 */
  | { type: 'raise'; to: number };

export type LogType = 'ante' | 'sb' | 'bb' | 'fold' | 'check' | 'call' | 'bet' | 'raise';

export interface LogEntry {
  street: Street;
  seat: Seat;
  type: LogType;
  /** このアクションで新たに出したチップ。 */
  amount: number;
  /** このストリートでの合計額（ブラインド・コール・ベット・レイズ）。 */
  to?: number;
  allIn: boolean;
  /** 時間切れによる自動アクション。 */
  auto?: boolean;
}

export interface HandSetup {
  handNumber: number;
  levelIndex: number;
  sb: number;
  bb: number;
  ante: number;
  anteType: AnteType;
  button: Seat;
  stacks: [number, number];
  /** シャッフル済みのデッキ。 */
  deck: Card[];
}

export interface HandResult {
  winners: Seat[];
  /** ポットから受け取った額。 */
  payouts: [number, number];
  /** コールされずに返却された額。 */
  returned: [number, number];
  pot: number;
  showdown: boolean;
  foldedSeat: Seat | null;
  /** ショーダウン時の役（見せていない側の役はクライアントに送らない）。 */
  evals: [HandEval | null, HandEval | null];
  shown: [boolean, boolean];
}

export interface HandState {
  handNumber: number;
  levelIndex: number;
  sb: number;
  bb: number;
  ante: number;
  anteType: AnteType;
  button: Seat;
  startStacks: [number, number];
  stacks: [number, number];
  hole: [Card[], Card[]];
  board: Card[];
  deck: Card[];
  street: Street;
  streetBets: [number, number];
  /** ブラインド・ベットとして出した額の合計（アンテを除く）。 */
  committed: [number, number];
  /** アンテ（デッドマネー）。 */
  dead: number;
  acted: [boolean, boolean];
  /** 最小レイズの増分。 */
  lastRaiseSize: number;
  /** このストリートで最後にベット／レイズした人。 */
  lastAggressor: Seat | null;
  status: HandStatus;
  toAct: Seat | null;
  /** オールインで両者の手札を公開済み。 */
  allInShowdown: boolean;
  log: LogEntry[];
  result: HandResult | null;
}

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  /** コールで新たに出す額（スタック不足ならオールイン額）。 */
  callAmount: number;
  canRaise: boolean;
  /** レイズ（ベット）の合計額の下限。スタックが足りなければオールイン額。 */
  minRaiseTo: number;
  /** オールインになる合計額。 */
  maxRaiseTo: number;
  /** 誰もベットしていない（ベットになる）。 */
  isBet: boolean;
}

export class EngineError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

const NEXT_STREET: Record<Street, Street | null> = {
  preflop: 'flop',
  flop: 'turn',
  turn: 'river',
  river: null,
};

export function startHand(setup: HandSetup): HandState {
  if (setup.deck.length < 9) throw new Error('deck too small');
  const bbSeat = other(setup.button);
  const s: HandState = {
    handNumber: setup.handNumber,
    levelIndex: setup.levelIndex,
    sb: setup.sb,
    bb: setup.bb,
    ante: setup.ante,
    anteType: setup.anteType,
    button: setup.button,
    startStacks: [setup.stacks[0], setup.stacks[1]],
    stacks: [setup.stacks[0], setup.stacks[1]],
    hole: [[], []],
    board: [],
    deck: setup.deck.slice(),
    street: 'preflop',
    streetBets: [0, 0],
    committed: [0, 0],
    dead: 0,
    acted: [false, false],
    lastRaiseSize: setup.bb,
    lastAggressor: null,
    status: 'betting',
    toAct: null,
    allInShowdown: false,
    log: [],
    result: null,
  };

  // ブラインドを先に払い、残りをアンテに充てる
  postBlind(s, setup.button, setup.sb, 'sb');
  postBlind(s, bbSeat, setup.bb, 'bb');
  if (setup.anteType === 'bb') {
    postAnte(s, bbSeat, setup.ante);
  } else if (setup.anteType === 'each') {
    postAnte(s, setup.button, setup.ante);
    postAnte(s, bbSeat, setup.ante);
  }

  for (let i = 0; i < 2; i++) {
    for (const seat of [bbSeat, setup.button]) s.hole[seat].push(s.deck.shift()!);
  }

  settle(s, null);
  return s;
}

function postBlind(s: HandState, seat: Seat, amount: number, type: 'sb' | 'bb') {
  const a = Math.min(amount, s.stacks[seat]);
  s.stacks[seat] -= a;
  s.streetBets[seat] += a;
  s.committed[seat] += a;
  s.log.push({ street: 'preflop', seat, type, amount: a, to: s.streetBets[seat], allIn: s.stacks[seat] === 0 });
}

function postAnte(s: HandState, seat: Seat, amount: number) {
  const a = Math.min(amount, s.stacks[seat]);
  if (a <= 0) return;
  s.stacks[seat] -= a;
  s.dead += a;
  s.log.push({ street: 'preflop', seat, type: 'ante', amount: a, allIn: s.stacks[seat] === 0 });
}

function needsAction(s: HandState, p: Seat): boolean {
  const o = other(p);
  if (s.stacks[p] === 0) return false;
  if (s.streetBets[p] < s.streetBets[o]) return true;
  return !s.acted[p] && s.stacks[o] > 0;
}

/** 次の手番を決める。ベッティングが終わっていれば次のストリート・ランアウト・ショーダウンへ進める。 */
function settle(s: HandState, lastActor: Seat | null) {
  for (;;) {
    const first: Seat =
      lastActor !== null ? other(lastActor) : s.street === 'preflop' ? s.button : other(s.button);
    const next = [first, other(first)].find((p) => needsAction(s, p));
    if (next !== undefined) {
      s.status = 'betting';
      s.toAct = next;
      return;
    }
    s.toAct = null;
    if (s.street === 'river') {
      showdown(s);
      return;
    }
    if (s.stacks[0] === 0 || s.stacks[1] === 0) {
      s.status = 'runout';
      s.allInShowdown = true;
      return;
    }
    dealStreet(s);
    lastActor = null;
  }
}

function dealStreet(s: HandState) {
  const next = NEXT_STREET[s.street];
  if (!next) throw new Error('no street after river');
  s.street = next;
  const n = next === 'flop' ? 3 : 1;
  for (let i = 0; i < n; i++) s.board.push(s.deck.shift()!);
  s.streetBets = [0, 0];
  s.acted = [false, false];
  s.lastRaiseSize = s.bb;
  s.lastAggressor = null;
}

export function legalActions(s: HandState, seat: Seat): LegalActions | null {
  if (s.status !== 'betting' || s.toAct !== seat) return null;
  const o = other(seat);
  const toCall = Math.max(0, s.streetBets[o] - s.streetBets[seat]);
  const currentBet = Math.max(s.streetBets[0], s.streetBets[1]);
  const maxRaiseTo = s.streetBets[seat] + s.stacks[seat];
  return {
    canFold: toCall > 0,
    canCheck: toCall === 0,
    canCall: toCall > 0,
    callAmount: Math.min(toCall, s.stacks[seat]),
    canRaise: s.stacks[seat] > toCall && s.stacks[o] > 0,
    minRaiseTo: Math.min(currentBet + s.lastRaiseSize, maxRaiseTo),
    maxRaiseTo,
    isBet: currentBet === 0,
  };
}

function put(s: HandState, seat: Seat, amount: number) {
  s.stacks[seat] -= amount;
  s.streetBets[seat] += amount;
  s.committed[seat] += amount;
}

export function applyAction(
  state: HandState,
  seat: Seat,
  action: PlayerAction,
  opts: { auto?: boolean } = {},
): HandState {
  const la = legalActions(state, seat);
  if (!la) throw new EngineError('not_your_turn', '手番ではありません');
  const s = structuredClone(state);
  const auto = opts.auto ? { auto: true } : {};
  const street = s.street;

  switch (action.type) {
    case 'fold': {
      if (!la.canFold) throw new EngineError('illegal_action', 'チェックできるときはフォールドできません');
      s.log.push({ street, seat, type: 'fold', amount: 0, allIn: false, ...auto });
      finishByFold(s, seat);
      return s;
    }
    case 'check': {
      if (!la.canCheck) throw new EngineError('illegal_action', 'チェックできません');
      s.acted[seat] = true;
      s.log.push({ street, seat, type: 'check', amount: 0, allIn: false, ...auto });
      break;
    }
    case 'call': {
      if (!la.canCall) throw new EngineError('illegal_action', 'コールできません');
      put(s, seat, la.callAmount);
      s.acted[seat] = true;
      s.log.push({
        street, seat, type: 'call', amount: la.callAmount, to: s.streetBets[seat],
        allIn: s.stacks[seat] === 0, ...auto,
      });
      break;
    }
    case 'raise': {
      if (!la.canRaise) throw new EngineError('illegal_action', 'レイズできません');
      const to = action.to;
      if (!Number.isInteger(to)) throw new EngineError('invalid_amount', '金額が不正です');
      if (to > la.maxRaiseTo) throw new EngineError('invalid_amount', 'スタックを超えています');
      if (to < la.minRaiseTo) throw new EngineError('invalid_amount', '最小レイズ額に足りません');
      const currentBet = Math.max(s.streetBets[0], s.streetBets[1]);
      const raiseSize = to - currentBet;
      if (raiseSize >= s.lastRaiseSize) s.lastRaiseSize = raiseSize;
      put(s, seat, to - s.streetBets[seat]);
      s.acted[seat] = true;
      s.lastAggressor = seat;
      s.log.push({
        street, seat, type: currentBet === 0 ? 'bet' : 'raise', amount: to - state.streetBets[seat], to,
        allIn: s.stacks[seat] === 0, ...auto,
      });
      break;
    }
    default:
      throw new EngineError('illegal_action', '不明なアクションです');
  }

  settle(s, seat);
  return s;
}

/** 時間切れ時の自動アクション：チェックできればチェック、できなければフォールド。 */
export function timeoutAction(s: HandState, seat: Seat): PlayerAction {
  return legalActions(s, seat)?.canCheck ? { type: 'check' } : { type: 'fold' };
}

/** オールイン後のランアウトで、次のストリートを配る（リバーの後はショーダウン）。 */
export function dealRunout(state: HandState): HandState {
  if (state.status !== 'runout') throw new Error('not in runout');
  const s = structuredClone(state);
  dealStreet(s);
  if (s.street === 'river') showdown(s);
  return s;
}

/** コールされなかった額を返し、その額を返す。 */
function returnUncalled(s: HandState): [number, number] {
  const returned: [number, number] = [0, 0];
  const diff = s.committed[0] - s.committed[1];
  const seat: Seat = diff > 0 ? 0 : 1;
  const amount = Math.abs(diff);
  if (amount > 0) {
    s.committed[seat] -= amount;
    s.stacks[seat] += amount;
    returned[seat] = amount;
  }
  return returned;
}

function finishByFold(s: HandState, folder: Seat) {
  const winner = other(folder);
  s.toAct = null;
  s.status = 'complete';
  const returned = returnUncalled(s);
  const pot = s.dead + s.committed[0] + s.committed[1];
  const payouts: [number, number] = [0, 0];
  payouts[winner] = pot;
  s.stacks[winner] += pot;
  s.result = {
    winners: [winner],
    payouts,
    returned,
    pot,
    showdown: false,
    foldedSeat: folder,
    evals: [null, null],
    shown: [false, false],
  };
}

function showdown(s: HandState) {
  s.toAct = null;
  s.status = 'complete';
  if (s.stacks[0] === 0 || s.stacks[1] === 0) s.allInShowdown = true;
  const returned = returnUncalled(s);
  const evals: [HandEval, HandEval] = [
    evaluateBest([...s.hole[0], ...s.board]),
    evaluateBest([...s.hole[1], ...s.board]),
  ];
  const cmp = evals[0].score - evals[1].score;
  const winners: Seat[] = cmp > 0 ? [0] : cmp < 0 ? [1] : [0, 1];
  const pot = s.dead + s.committed[0] + s.committed[1];
  const payouts: [number, number] = [0, 0];
  if (winners.length === 1) {
    payouts[winners[0]] = pot;
  } else {
    // 端数チップはボタンでない側（BB）へ
    const half = Math.floor(pot / 2);
    payouts[s.button] = half;
    payouts[other(s.button)] = pot - half;
  }
  s.stacks[0] += payouts[0];
  s.stacks[1] += payouts[1];

  let shown: [boolean, boolean];
  if (s.allInShowdown) {
    shown = [true, true];
  } else {
    // リバーの最後のアグレッサー、いなければ先に行動する BB 側から公開する。
    // 後から公開する側は、負けていれば自動でマックする。
    const first = s.lastAggressor ?? other(s.button);
    const second = other(first);
    shown = [false, false];
    shown[first] = true;
    shown[second] = winners.includes(second);
  }

  s.result = { winners, payouts, returned, pot, showdown: true, foldedSeat: null, evals, shown };
}

/** ハンド終了後に手札を任意で公開する。 */
export function revealHand(state: HandState, seat: Seat): HandState {
  if (state.status !== 'complete' || !state.result) throw new EngineError('illegal_action', 'ハンドが終わっていません');
  if (state.result.shown[seat]) return state;
  const s = structuredClone(state);
  s.result!.shown[seat] = true;
  return s;
}

/** ポット計算に必要な公開情報。HandState とクライアント向けのビューの両方が満たす。 */
export interface PotContext {
  streetBets: [number, number];
  committed: [number, number];
  dead: number;
}

/** 前のストリートまでに集まったポット（アンテ込み、現在のストリートのベットを除く）。 */
export function collectedPot(s: PotContext): number {
  return s.dead + s.committed[0] + s.committed[1] - s.streetBets[0] - s.streetBets[1];
}

/** ポット全体（現在のストリートのベットを含む）。 */
export function totalPot(s: PotContext): number {
  return s.dead + s.committed[0] + s.committed[1];
}

/** ポットの何割かでベット／レイズする場合の合計額（下限・上限で丸める）。 */
export function potFractionTo(s: PotContext, seat: Seat, la: LegalActions, fraction: number): number {
  const o = other(seat);
  const toCall = Math.max(0, s.streetBets[o] - s.streetBets[seat]);
  const currentBet = Math.max(s.streetBets[0], s.streetBets[1]);
  // コールした後のポットに対する割合を、現在のベットに上乗せする
  const potAfterCall = totalPot(s) + toCall;
  const to = currentBet + Math.round(potAfterCall * fraction);
  return Math.min(Math.max(to, la.minRaiseTo), la.maxRaiseTo);
}
