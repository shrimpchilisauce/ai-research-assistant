import { useEffect, useState } from 'react';
import { potFractionTo, type LegalActions, type PlayerAction, type Seat } from '../../engine/hand';
import type { HandView } from '../../shared/protocol';
import { chips } from '../format';

interface Props {
  hand: HandView;
  legal: LegalActions;
  you: Seat;
  onAct: (action: PlayerAction) => void;
}

interface Quick {
  label: string;
  to: number;
}

const clamp = (v: number, la: LegalActions) => Math.min(Math.max(v, la.minRaiseTo), la.maxRaiseTo);

function quickAmounts(hand: HandView, la: LegalActions, you: Seat): Quick[] {
  const quicks: Quick[] = [];
  if (hand.street === 'preflop') {
    const currentBet = Math.max(...hand.streetBets);
    const unopened = currentBet <= hand.bb;
    for (const mult of [2.5, 3, 4]) {
      const to = Math.round((unopened ? hand.bb : currentBet) * mult);
      quicks.push({ label: unopened ? `${mult}BB` : `×${mult}`, to: clamp(to, la) });
    }
  } else {
    const fractions: [string, number][] = [
      ['1/3', 1 / 3],
      ['1/2', 1 / 2],
      ['2/3', 2 / 3],
      ['ポット', 1],
    ];
    for (const [label, f] of fractions) quicks.push({ label, to: potFractionTo(hand, you, la, f) });
  }
  quicks.push({ label: '全額', to: la.maxRaiseTo });
  return quicks;
}

/** 全角数字・カンマを許容して読む。 */
function parseAmount(text: string): number {
  const ascii = text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[^\d]/g, '');
  return ascii === '' ? NaN : Number(ascii);
}

export function ActionPanel({ hand, legal: la, you, onAct }: Props) {
  const [amount, setAmount] = useState(la.minRaiseTo);
  const [text, setText] = useState(String(la.minRaiseTo));
  const [sent, setSent] = useState(false);

  // サーバーに拒否されたときに押せないままにならないよう、少し待って戻す
  useEffect(() => {
    if (!sent) return;
    const t = window.setTimeout(() => setSent(false), 3_000);
    return () => clearTimeout(t);
  }, [sent]);

  const setTo = (v: number) => {
    const c = clamp(v, la);
    setAmount(c);
    setText(String(c));
  };

  const act = (a: PlayerAction) => {
    if (sent) return;
    setSent(true);
    onAct(a);
  };

  const callAllIn = la.callAmount === hand.stacks[you];
  const raiseAllIn = amount === la.maxRaiseTo;
  const raiseLabel = raiseAllIn ? 'オールイン' : la.isBet ? 'ベット' : 'レイズ';
  const step = Math.max(1, hand.sb);

  return (
    <div className="action-panel">
      {la.canRaise && (
        <div className="sizing">
          <div className="quick">
            {quickAmounts(hand, la, you).map((q) => (
              <button
                key={q.label}
                type="button"
                className={`chip-btn ${q.to === amount ? 'active' : ''}`}
                onClick={() => setTo(q.to)}
              >
                {q.label}
              </button>
            ))}
          </div>
          <div className="slider-row">
            <input
              type="range"
              aria-label="ベット額"
              min={la.minRaiseTo}
              max={la.maxRaiseTo}
              step={1}
              value={amount}
              disabled={la.minRaiseTo === la.maxRaiseTo}
              onChange={(e) => {
                const v = Number(e.target.value);
                setTo(v >= la.maxRaiseTo ? la.maxRaiseTo : Math.round(v / step) * step);
              }}
            />
            <input
              className="num amount"
              inputMode="numeric"
              aria-label="ベット額（数値）"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                const v = parseAmount(e.target.value);
                if (Number.isFinite(v)) setAmount(clamp(v, la));
              }}
              onBlur={() => setTo(Number.isFinite(parseAmount(text)) ? parseAmount(text) : amount)}
            />
          </div>
        </div>
      )}
      <div className="buttons">
        {la.canFold && (
          <button className="btn act fold" disabled={sent} onClick={() => act({ type: 'fold' })}>
            フォールド
          </button>
        )}
        {la.canCheck && (
          <button className="btn act check" disabled={sent} onClick={() => act({ type: 'check' })}>
            チェック
          </button>
        )}
        {la.canCall && (
          <button className="btn act call" disabled={sent} onClick={() => act({ type: 'call' })}>
            コール {chips(la.callAmount)}
            {callAllIn && <small>オールイン</small>}
          </button>
        )}
        {la.canRaise && (
          <button
            className="btn act raise"
            disabled={sent}
            onClick={() => act({ type: 'raise', to: amount })}
          >
            {raiseLabel} {chips(amount)}
          </button>
        )}
      </div>
    </div>
  );
}
