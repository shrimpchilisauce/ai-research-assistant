import { fullDeck, type Card } from '../cards';
import { startHand, type HandSetup, type HandState, type Seat } from '../hand';

/**
 * 配る札を指定したデッキを作る。
 * startHand は BB 側 → ボタン側の順に1枚ずつ2周配り、続けてボードを配る。
 */
export function riggedDeck(button: Seat, hole: [Card[], Card[]], board: Card[] = []): Card[] {
  const bb = button === 0 ? 1 : 0;
  const top = [hole[bb][0], hole[button][0], hole[bb][1], hole[button][1], ...board];
  const rest = fullDeck().filter((c) => !top.includes(c));
  return [...top, ...rest];
}

export function setup(over: Partial<HandSetup> = {}): HandSetup {
  return {
    handNumber: 1,
    levelIndex: 0,
    sb: 50,
    bb: 100,
    ante: 0,
    anteType: 'none',
    button: 0,
    stacks: [10_000, 10_000],
    deck: fullDeck(),
    ...over,
  };
}

export function hand(over: Partial<HandSetup> = {}): HandState {
  return startHand(setup(over));
}

export const total = (s: HandState) => s.stacks[0] + s.stacks[1];
