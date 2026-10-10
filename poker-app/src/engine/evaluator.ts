import { type Card, rankValue, suitOf } from './cards';

export const HandCategory = {
  HighCard: 0,
  OnePair: 1,
  TwoPair: 2,
  Trips: 3,
  Straight: 4,
  Flush: 5,
  FullHouse: 6,
  Quads: 7,
  StraightFlush: 8,
} as const;

const CATEGORY_NAMES = [
  'ハイカード',
  'ワンペア',
  'ツーペア',
  'スリーカード',
  'ストレート',
  'フラッシュ',
  'フルハウス',
  'フォーカード',
  'ストレートフラッシュ',
];

export interface HandEval {
  category: number;
  /** 大きいほど強い。同値なら引き分け。 */
  score: number;
  /** ベスト5枚（役を構成する順に並べたもの）。 */
  cards: Card[];
  name: string;
}

function encode(category: number, ranks: number[]): number {
  let score = category;
  for (let i = 0; i < 5; i++) score = score * 16 + (ranks[i] ?? 0);
  return score;
}

/** ちょうど5枚の役を判定する。 */
export function evaluate5(cards: readonly Card[]): HandEval {
  if (cards.length !== 5) throw new Error('evaluate5 requires exactly 5 cards');

  const counts = new Map<number, number>();
  for (const c of cards) counts.set(rankValue(c), (counts.get(rankValue(c)) ?? 0) + 1);

  // 枚数の多い順 → ランクの高い順
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const groupRanks = groups.map(([r]) => r);
  const shape = groups.map(([, n]) => n).join('');

  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]));

  let straightHigh = 0;
  if (groups.length === 5) {
    const desc = groupRanks; // 全て異なるランクなので降順
    if (desc[0] - desc[4] === 4) straightHigh = desc[0];
    else if (desc.join(',') === '14,5,4,3,2') straightHigh = 5;
  }

  let category: number;
  let tiebreak: number[];
  if (straightHigh && flush) {
    category = HandCategory.StraightFlush;
    tiebreak = [straightHigh];
  } else if (shape === '41') {
    category = HandCategory.Quads;
    tiebreak = groupRanks;
  } else if (shape === '32') {
    category = HandCategory.FullHouse;
    tiebreak = groupRanks;
  } else if (flush) {
    category = HandCategory.Flush;
    tiebreak = groupRanks;
  } else if (straightHigh) {
    category = HandCategory.Straight;
    tiebreak = [straightHigh];
  } else if (shape === '311') {
    category = HandCategory.Trips;
    tiebreak = groupRanks;
  } else if (shape === '221') {
    category = HandCategory.TwoPair;
    tiebreak = groupRanks;
  } else if (shape === '2111') {
    category = HandCategory.OnePair;
    tiebreak = groupRanks;
  } else {
    category = HandCategory.HighCard;
    tiebreak = groupRanks;
  }

  // 表示用の並び：役を構成するカードを先に、ホイール（5-4-3-2-A）は A を最後に
  const order = (c: Card) => {
    const r = rankValue(c);
    const effective = straightHigh === 5 && r === 14 ? 1 : r;
    return (counts.get(r) ?? 0) * 100 + effective;
  };
  const ordered = cards.slice().sort((a, b) => order(b) - order(a));

  let name = CATEGORY_NAMES[category];
  if (category === HandCategory.StraightFlush && straightHigh === 14) name = 'ロイヤルフラッシュ';

  return { category, score: encode(category, tiebreak), cards: ordered, name };
}

/** 5〜7枚からベストの5枚を選んで判定する。 */
export function evaluateBest(cards: readonly Card[]): HandEval {
  if (cards.length < 5 || cards.length > 7) throw new Error('evaluateBest requires 5-7 cards');
  let best: HandEval | null = null;
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const ev = evaluate5([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (!best || ev.score > best.score) best = ev;
          }
  return best!;
}
