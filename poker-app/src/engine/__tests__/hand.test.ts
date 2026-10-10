import { describe, expect, it } from 'vitest';
import { fullDeck, shuffle } from '../cards';
import {
  applyAction,
  collectedPot,
  dealRunout,
  EngineError,
  legalActions,
  potFractionTo,
  revealHand,
  startHand,
  timeoutAction,
  type HandState,
  type PlayerAction,
  type Seat,
} from '../hand';
import { hand, riggedDeck, setup, total } from './helpers';

const act = (s: HandState, a: PlayerAction) => applyAction(s, s.toAct!, a);
const call = (s: HandState) => act(s, { type: 'call' });
const check = (s: HandState) => act(s, { type: 'check' });
const fold = (s: HandState) => act(s, { type: 'fold' });
const raise = (s: HandState, to: number) => act(s, { type: 'raise', to });

function runout(s: HandState): HandState {
  while (s.status === 'runout') s = dealRunout(s);
  return s;
}

describe('blinds and action order', () => {
  it('posts blinds with the button on the small blind and acting first preflop', () => {
    const s = hand({ button: 1 });
    expect(s.streetBets).toEqual([100, 50]);
    expect(s.stacks).toEqual([9_900, 9_950]);
    expect(s.toAct).toBe(1);
    expect(s.hole[0]).toHaveLength(2);
    expect(s.hole[1]).toHaveLength(2);
  });

  it('gives the big blind the option after a limp, then the big blind acts first postflop', () => {
    let s = hand({ button: 0 });
    s = call(s);
    expect(s.toAct).toBe(1);
    expect(legalActions(s, 1)).toMatchObject({ canCheck: true, canRaise: true, minRaiseTo: 200 });
    s = check(s);
    expect(s.street).toBe('flop');
    expect(s.board).toHaveLength(3);
    expect(s.toAct).toBe(1);
    s = check(s);
    expect(s.toAct).toBe(0);
    s = check(s);
    expect(s.street).toBe('turn');
    expect(s.toAct).toBe(1);
  });

  it('logs bet on an unopened street and raise when facing a bet', () => {
    let s = hand();
    s = call(s);
    s = check(s);
    s = raise(s, 100);
    expect(s.log.at(-1)).toMatchObject({ type: 'bet', amount: 100, to: 100, street: 'flop' });
    s = raise(s, 300);
    expect(s.log.at(-1)).toMatchObject({ type: 'raise', amount: 300, to: 300 });
  });
});

describe('raise sizing', () => {
  it('requires at least the previous raise increment', () => {
    let s = hand();
    expect(legalActions(s, 0)).toMatchObject({ minRaiseTo: 200, maxRaiseTo: 10_000, callAmount: 50 });
    s = raise(s, 300); // +200
    expect(legalActions(s, 1)).toMatchObject({ minRaiseTo: 500, callAmount: 200 });
    expect(() => raise(s, 499)).toThrow(EngineError);
    s = raise(s, 500);
    expect(legalActions(s, 0)?.minRaiseTo).toBe(700);
  });

  it('allows an all-in for less than a minimum raise but no re-raise against it', () => {
    let s = hand({ stacks: [10_000, 450] });
    s = raise(s, 300);
    // BB は 450 しかないので、最小レイズ 500 に届かなくてもオールインできる
    expect(legalActions(s, 1)).toMatchObject({ minRaiseTo: 450, maxRaiseTo: 450 });
    s = raise(s, 450);
    expect(s.stacks[1]).toBe(0);
    expect(legalActions(s, 0)).toMatchObject({ canRaise: false, canCall: true, callAmount: 150 });
    s = call(s);
    expect(s.status).toBe('runout');
    expect(s.allInShowdown).toBe(true);
  });

  it('only allows calling or folding against an all-in', () => {
    let s = hand({ stacks: [10_000, 3_000] });
    s = raise(s, 300);
    s = raise(s, 3_000);
    expect(legalActions(s, 0)).toMatchObject({ canRaise: false, canCall: true, callAmount: 2_700 });
  });

  it('rejects out-of-turn and illegal actions', () => {
    const s = hand();
    expect(() => applyAction(s, 1, { type: 'check' })).toThrow(/手番/);
    expect(() => act(s, { type: 'check' })).toThrow(EngineError);
    expect(() => raise(s, 150)).toThrow(EngineError);
    expect(() => raise(s, 10_001)).toThrow(EngineError);
    expect(() => raise(s, 250.5)).toThrow(EngineError);
    const limped = check(call(s));
    expect(() => fold(limped)).toThrow(EngineError);
    expect(() => call(limped)).toThrow(EngineError);
  });

  it('computes pot-fraction bets and raises', () => {
    let s = hand();
    s = call(s);
    s = check(s); // ポット 200
    const la = legalActions(s, s.toAct!)!;
    expect(potFractionTo(s, s.toAct!, la, 0.5)).toBe(100);
    s = raise(s, 100);
    const la2 = legalActions(s, s.toAct!)!;
    // コール後のポット 400 → 100 + 400 = 500
    expect(potFractionTo(s, s.toAct!, la2, 1)).toBe(500);
    expect(collectedPot(s)).toBe(200);
  });
});

describe('fold', () => {
  it('awards the pot and returns the uncalled bet', () => {
    let s = hand();
    s = raise(s, 300);
    s = fold(s);
    expect(s.status).toBe('complete');
    expect(s.result).toMatchObject({ winners: [0], pot: 200, returned: [200, 0], showdown: false, foldedSeat: 1 });
    expect(s.stacks).toEqual([10_100, 9_900]);
  });

  it('folds or checks on timeout', () => {
    const s = hand();
    expect(timeoutAction(s, 0)).toEqual({ type: 'fold' });
    expect(timeoutAction(check(call(s)), 1)).toEqual({ type: 'check' });
  });
});

describe('short stacks on the blinds', () => {
  it('runs out immediately when the small blind cannot cover its blind', () => {
    let s = hand({ button: 0, stacks: [30, 10_000] });
    expect(s.streetBets).toEqual([30, 100]);
    expect(s.status).toBe('runout');
    expect(s.toAct).toBeNull();
    s = runout(s);
    expect(s.board).toHaveLength(5);
    expect(s.result!.returned).toEqual([0, 70]);
    expect(s.result!.pot).toBe(60);
    expect(total(s)).toBe(10_030);
  });

  it('lets the small blind call or fold against a short big blind', () => {
    const s = hand({ button: 0, stacks: [10_000, 70] });
    expect(s.toAct).toBe(0);
    expect(legalActions(s, 0)).toMatchObject({ callAmount: 20, canRaise: false, canFold: true });
  });

  it('pays the big blind before the ante when short', () => {
    const s = hand({ button: 0, anteType: 'bb', ante: 100, stacks: [10_000, 150] });
    expect(s.streetBets).toEqual([50, 100]);
    expect(s.dead).toBe(50);
    expect(s.stacks[1]).toBe(0);
  });
});

describe('antes', () => {
  it('collects a big blind ante from the big blind only', () => {
    const s = hand({ button: 0, anteType: 'bb', ante: 100 });
    expect(s.dead).toBe(100);
    expect(s.stacks).toEqual([9_950, 9_800]);
    // アンテはコール額に含まない
    expect(legalActions(s, 0)?.callAmount).toBe(50);
  });

  it('collects an ante from each player', () => {
    let s = hand({ button: 0, anteType: 'each', ante: 10 });
    expect(s.dead).toBe(20);
    s = raise(s, 300);
    s = fold(s);
    expect(s.result!.pot).toBe(220);
    expect(s.stacks).toEqual([10_110, 9_890]);
  });
});

describe('showdown', () => {
  const board = ['2c', '7d', '9h', 'Js', '3c'];

  function toShowdown(s: HandState, riverBetBy?: Seat): HandState {
    s = call(s);
    s = check(s);
    for (const street of ['flop', 'turn', 'river']) {
      expect(s.street).toBe(street);
      if (street === 'river' && riverBetBy !== undefined) {
        if (s.toAct !== riverBetBy) s = check(s);
        s = raise(s, 200);
        s = call(s);
      } else {
        s = check(s);
        s = check(s);
      }
    }
    return s;
  }

  it('awards the pot to the better hand', () => {
    const deck = riggedDeck(0, [['Ac', 'Ad'], ['Kc', 'Kd']], board);
    const s = toShowdown(hand({ button: 0, deck }));
    expect(s.result).toMatchObject({ winners: [0], pot: 200, showdown: true });
    expect(s.result!.evals[0]!.name).toBe('ワンペア');
    expect(s.stacks).toEqual([10_100, 9_900]);
  });

  it('shows the big blind first after a checked river and mucks the losing button', () => {
    const deck = riggedDeck(0, [['Kc', 'Kd'], ['Ac', 'Ad']], board);
    const s = toShowdown(hand({ button: 0, deck }));
    expect(s.result!.winners).toEqual([1]);
    expect(s.result!.shown).toEqual([false, true]);
  });

  it('shows the river aggressor first and mucks the losing caller', () => {
    const deck = riggedDeck(0, [['Ac', 'Ad'], ['Kc', 'Kd']], board);
    const s = toShowdown(hand({ button: 0, deck }), 0);
    expect(s.result!.winners).toEqual([0]);
    expect(s.result!.shown).toEqual([true, false]);
    const shown = revealHand(s, 1);
    expect(shown.result!.shown).toEqual([true, true]);
  });

  it('shows the winning second player automatically', () => {
    const deck = riggedDeck(0, [['Kc', 'Kd'], ['Ac', 'Ad']], board);
    const s = toShowdown(hand({ button: 0, deck }), 0);
    expect(s.result!.shown).toEqual([true, true]);
  });

  it('splits a tied pot and gives the odd chip to the big blind', () => {
    const royal = ['As', 'Ks', 'Qs', 'Js', 'Ts'];
    const deck = riggedDeck(0, [['2c', '3d'], ['4h', '5h']], royal);
    const s = toShowdown(hand({ button: 0, deck, anteType: 'bb', ante: 1 }));
    expect(s.result!.winners).toEqual([0, 1]);
    expect(s.result!.pot).toBe(201);
    expect(s.result!.payouts).toEqual([100, 101]);
    expect(s.result!.shown).toEqual([true, true]);
  });

  it('reveals both hands on an all-in and returns the uncalled excess', () => {
    const deck = riggedDeck(0, [['Ac', 'Ad'], ['Kc', 'Kd']], board);
    let s = hand({ button: 0, deck, stacks: [10_000, 4_000] });
    s = raise(s, 10_000);
    s = call(s);
    expect(s.status).toBe('runout');
    expect(s.allInShowdown).toBe(true);
    s = dealRunout(s);
    expect(s.board).toHaveLength(3);
    s = dealRunout(s);
    expect(s.board).toHaveLength(4);
    s = dealRunout(s);
    expect(s.status).toBe('complete');
    expect(s.result).toMatchObject({ winners: [0], pot: 8_000, returned: [6_000, 0] });
    expect(s.result!.shown).toEqual([true, true]);
    expect(s.stacks).toEqual([14_000, 0]);
  });

  it('treats a called all-in on the river as an all-in showdown', () => {
    const deck = riggedDeck(0, [['Kc', 'Kd'], ['Ac', 'Ad']], board);
    let s = hand({ button: 0, deck, stacks: [1_000, 10_000] });
    s = call(s);
    s = check(s);
    for (let i = 0; i < 4; i++) s = check(s);
    s = check(s);
    s = raise(s, 900);
    s = call(s);
    expect(s.result!.shown).toEqual([true, true]);
    expect(s.stacks).toEqual([0, 11_000]);
  });
});

describe('random play', () => {
  it('conserves chips and always terminates', () => {
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let i = 0; i < 2_000; i++) {
      const stacks: [number, number] = [1 + rnd(5_000), 1 + rnd(5_000)];
      const anteType = (['none', 'bb', 'each'] as const)[rnd(3)];
      let s = startHand(
        setup({ button: rnd(2) as Seat, stacks, deck: shuffle(fullDeck(), rnd), anteType, ante: 25 }),
      );
      const start = total(s) + s.dead + s.committed[0] + s.committed[1];
      for (let steps = 0; s.status !== 'complete'; steps++) {
        expect(steps).toBeLessThan(200);
        if (s.status === 'runout') {
          s = dealRunout(s);
          continue;
        }
        const seat = s.toAct!;
        const la = legalActions(s, seat)!;
        const options: PlayerAction[] = [];
        if (la.canFold) options.push({ type: 'fold' });
        if (la.canCheck) options.push({ type: 'check' });
        if (la.canCall) options.push({ type: 'call' }, { type: 'call' });
        if (la.canRaise) {
          options.push({ type: 'raise', to: la.minRaiseTo }, { type: 'raise', to: la.maxRaiseTo });
          const span = la.maxRaiseTo - la.minRaiseTo;
          if (span > 0) options.push({ type: 'raise', to: la.minRaiseTo + rnd(span + 1) });
        }
        s = applyAction(s, seat, options[rnd(options.length)]);
        expect(s.stacks[0]).toBeGreaterThanOrEqual(0);
        expect(s.stacks[1]).toBeGreaterThanOrEqual(0);
      }
      expect(total(s)).toBe(start);
      expect(s.result!.payouts[0] + s.result!.payouts[1]).toBe(s.result!.pot);
    }
  });
});
