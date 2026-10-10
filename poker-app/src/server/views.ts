import type { HandEval } from '../engine/evaluator';
import { legalActions, type HandResult, type HandState, type Seat } from '../engine/hand';
import type { EvalView, HandRecordView, HandView, ResultView } from '../shared/protocol';
import type { HandRecord } from './state';

/**
 * 各プレイヤーに送る情報を絞り込む。
 * 相手の手札・デッキ・見せていない役は、ここを通ったものには含まれない。
 */

function canSee(h: Pick<HandState, 'allInShowdown' | 'result'>, owner: Seat, viewer: Seat | null): boolean {
  return owner === viewer || h.allInShowdown || !!h.result?.shown[owner];
}

function evalView(ev: HandEval | null): EvalView | null {
  return ev ? { name: ev.name, cards: ev.cards } : null;
}

function resultView(r: HandResult, visible: [boolean, boolean]): ResultView {
  return {
    winners: r.winners,
    payouts: r.payouts,
    returned: r.returned,
    pot: r.pot,
    showdown: r.showdown,
    foldedSeat: r.foldedSeat,
    shown: r.shown,
    evals: [visible[0] ? evalView(r.evals[0]) : null, visible[1] ? evalView(r.evals[1]) : null],
  };
}

export function handView(h: HandState, viewer: Seat | null, canAct: boolean): HandView {
  const visible: [boolean, boolean] = [canSee(h, 0, viewer), canSee(h, 1, viewer)];
  return {
    handNumber: h.handNumber,
    levelIndex: h.levelIndex,
    sb: h.sb,
    bb: h.bb,
    ante: h.ante,
    anteType: h.anteType,
    button: h.button,
    startStacks: h.startStacks,
    stacks: h.stacks,
    hole: [visible[0] ? h.hole[0] : null, visible[1] ? h.hole[1] : null],
    board: h.board,
    street: h.street,
    streetBets: h.streetBets,
    committed: h.committed,
    dead: h.dead,
    status: h.status,
    toAct: h.toAct,
    allInShowdown: h.allInShowdown,
    log: h.log,
    legal: canAct && viewer !== null ? legalActions(h, viewer) : null,
    result: h.result ? resultView(h.result, visible) : null,
  };
}

export function recordFromHand(h: HandState): HandRecord {
  if (!h.result) throw new Error('hand not complete');
  return {
    handNumber: h.handNumber,
    levelIndex: h.levelIndex,
    sb: h.sb,
    bb: h.bb,
    ante: h.ante,
    anteType: h.anteType,
    button: h.button,
    startStacks: h.startStacks,
    endStacks: h.stacks,
    hole: h.hole,
    board: h.board,
    log: h.log,
    allInShowdown: h.allInShowdown,
    result: h.result,
  };
}

export function recordView(r: HandRecord, viewer: Seat | null): HandRecordView {
  const visible: [boolean, boolean] = [canSee(r, 0, viewer), canSee(r, 1, viewer)];
  return {
    handNumber: r.handNumber,
    levelIndex: r.levelIndex,
    sb: r.sb,
    bb: r.bb,
    ante: r.ante,
    anteType: r.anteType,
    button: r.button,
    startStacks: r.startStacks,
    endStacks: r.endStacks,
    hole: [visible[0] ? r.hole[0] : null, visible[1] ? r.hole[1] : null],
    board: r.board,
    log: r.log,
    result: resultView(r.result, visible),
  };
}
