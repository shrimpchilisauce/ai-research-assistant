import { describe, expect, it } from 'vitest';
import { evaluate5, evaluateBest, HandCategory } from '../evaluator';

const ev = (s: string) => evaluate5(s.split(' '));
const best = (s: string) => evaluateBest(s.split(' '));

describe('evaluate5', () => {
  it.each([
    ['As Ks Qs Js Ts', HandCategory.StraightFlush, 'ロイヤルフラッシュ'],
    ['9h 8h 7h 6h 5h', HandCategory.StraightFlush, 'ストレートフラッシュ'],
    ['7c 7d 7h 7s 2c', HandCategory.Quads, 'フォーカード'],
    ['Kc Kd Kh 2s 2c', HandCategory.FullHouse, 'フルハウス'],
    ['Ad 9d 7d 4d 2d', HandCategory.Flush, 'フラッシュ'],
    ['Tc 9d 8h 7s 6c', HandCategory.Straight, 'ストレート'],
    ['5c 4d 3h 2s Ac', HandCategory.Straight, 'ストレート'],
    ['Qc Qd Qh 9s 2c', HandCategory.Trips, 'スリーカード'],
    ['Jc Jd 4h 4s Ac', HandCategory.TwoPair, 'ツーペア'],
    ['Tc Td 8h 4s 2c', HandCategory.OnePair, 'ワンペア'],
    ['Ac Jd 8h 4s 2c', HandCategory.HighCard, 'ハイカード'],
  ])('%s → %s', (cards, category, name) => {
    const r = ev(cards);
    expect(r.category).toBe(category);
    expect(r.name).toBe(name);
  });

  it('ranks categories in order', () => {
    const hands = [
      'Ac Jd 8h 4s 2c',
      'Tc Td 8h 4s 2c',
      'Jc Jd 4h 4s Ac',
      'Qc Qd Qh 9s 2c',
      'Tc 9d 8h 7s 6c',
      'Ad 9d 7d 4d 2d',
      'Kc Kd Kh 2s 2c',
      '7c 7d 7h 7s 2c',
      '9h 8h 7h 6h 5h',
    ].map(ev);
    for (let i = 1; i < hands.length; i++) expect(hands[i].score).toBeGreaterThan(hands[i - 1].score);
  });

  it('treats the wheel as the lowest straight', () => {
    expect(ev('6c 5d 4h 3s 2c').score).toBeGreaterThan(ev('5c 4d 3h 2s Ac').score);
    expect(ev('5c 4d 3h 2s Ac').cards.map((c) => c[0]).join('')).toBe('5432A');
  });

  it('compares kickers', () => {
    expect(ev('Ac Ad Kh 4s 2c').score).toBeGreaterThan(ev('Ac Ad Qh 4s 2c').score);
    expect(ev('Jc Jd 4h 4s Ac').score).toBeGreaterThan(ev('Jc Jd 4h 4s Kc').score);
    expect(ev('Jc Jd 5h 5s 2c').score).toBeGreaterThan(ev('Jc Jd 4h 4s Ac').score);
    expect(ev('Ad 9d 7d 4d 3d').score).toBeGreaterThan(ev('Ad 9d 7d 4d 2d').score);
    expect(ev('Kc Kd Kh 2s 2c').score).toBeGreaterThan(ev('Qc Qd Qh As Ac').score);
  });

  it('ties identical ranks regardless of suit', () => {
    expect(ev('Ac Kd 8h 4s 2c').score).toBe(ev('Ad Kh 8s 4c 2d').score);
  });

  it('orders cards by role', () => {
    expect(ev('2c Kd 2h Ks 2s').cards.map((c) => c[0]).join('')).toBe('222KK');
  });
});

describe('evaluateBest', () => {
  it('finds the best five of seven', () => {
    const r = best('Ah Kh Qh Jh 2c 3d Th');
    expect(r.name).toBe('ロイヤルフラッシュ');
    expect(r.cards).toHaveLength(5);
  });

  it('makes a full house from two sets of trips', () => {
    const r = best('9c 9d 9h 4s 4c 4d Ac');
    expect(r.category).toBe(HandCategory.FullHouse);
    expect(r.cards.map((c) => c[0]).join('')).toBe('99944');
  });

  it('lets the board play', () => {
    const board = 'As Ks Qs Js Ts';
    expect(best(`2c 3d ${board}`).score).toBe(best(`4h 5h ${board}`).score);
  });

  it('prefers a straight flush over a higher plain straight', () => {
    const r = best('5h 6h 7h 8h 9h Tc Jc');
    expect(r.category).toBe(HandCategory.StraightFlush);
  });
});
