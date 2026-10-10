/** カードは "As"（スペードのA）、"Td"（ダイヤの10）のような2文字で表す。 */
export type Card = string;

export const RANKS = '23456789TJQKA';
export const SUITS = 'shdc';

/** 0 以上 maxExclusive 未満の整数を返す乱数関数。 */
export type RandomInt = (maxExclusive: number) => number;

export function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) {
    for (const r of RANKS) deck.push(r + s);
  }
  return deck;
}

/** 2〜14（A=14）。 */
export function rankValue(card: Card): number {
  return RANKS.indexOf(card[0]) + 2;
}

export function suitOf(card: Card): string {
  return card[1];
}

export function isCard(value: unknown): value is Card {
  return (
    typeof value === 'string' &&
    value.length === 2 &&
    RANKS.includes(value[0]) &&
    SUITS.includes(value[1])
  );
}

/** 暗号論的乱数を使い、剰余による偏りを棄却法で除いた乱数。 */
export const cryptoRandomInt: RandomInt = (maxExclusive) => {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 2 ** 32) {
    throw new RangeError(`invalid range: ${maxExclusive}`);
  }
  const limit = Math.floor(2 ** 32 / maxExclusive) * maxExclusive;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % maxExclusive;
  }
};

/** Fisher–Yates シャッフル（元の配列は変更しない）。 */
export function shuffle<T>(items: readonly T[], randomInt: RandomInt): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
