import { useEffect, useRef, useState } from 'react';
import { other, type Seat, type Street } from '../../engine/hand';
import type { HandRecordView, RoomView } from '../../shared/protocol';
import { chips, describeAction, STREET_NAMES } from '../format';
import type { RoomConnection } from '../useRoom';
import { Card } from './Card';

interface Props {
  view: RoomView;
  conn: RoomConnection;
  /** 直前のハンドを開いた状態で表示する。 */
  openLatest: boolean;
  onClose: () => void;
}

const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river'];
const BOARD_UPTO: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };

export function HistorySheet({ view, conn, openLatest, onClose }: Props) {
  const matchNumber = view.match?.matchNumber;
  const handCount = view.match?.handNumber ?? 0;
  const [expanded, setExpanded] = useState<number | null>(null);

  // 開いたとき・ハンドが進んだときに取り直す
  useEffect(() => {
    conn.send({ t: 'history' });
  }, [conn, handCount]);

  const hands = conn.history && conn.history.matchNumber === matchNumber ? [...conn.history.hands].reverse() : null;

  const autoOpened = useRef(false);
  const latest = hands?.[0]?.handNumber;
  useEffect(() => {
    if (!openLatest || autoOpened.current || latest === undefined) return;
    autoOpened.current = true;
    setExpanded(latest);
  }, [openLatest, latest]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="ハンド履歴" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>ハンド履歴</h2>
          <button className="icon-btn" aria-label="閉じる" onClick={onClose}>
            ×
          </button>
        </header>
        {!hands ? (
          <p className="muted">読み込み中…</p>
        ) : hands.length === 0 ? (
          <p className="muted">まだ終わったハンドはありません。</p>
        ) : (
          <ul className="history">
            {hands.map((h) => (
              <HistoryItem
                key={h.handNumber}
                hand={h}
                view={view}
                open={expanded === h.handNumber}
                onToggle={() => setExpanded(expanded === h.handNumber ? null : h.handNumber)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function HistoryItem({ hand: h, view, open, onToggle }: { hand: HandRecordView; view: RoomView; open: boolean; onToggle: () => void }) {
  const you = view.you!;
  const name = (s: Seat) => (s === you ? 'あなた' : (view.players[s]?.name ?? '相手'));
  const net = h.endStacks[you] - h.startStacks[you];
  const r = h.result;
  const winText =
    r.winners.length === 2 ? '引き分け' : `${name(r.winners[0])}の勝ち`;

  return (
    <li className={`history-item ${open ? 'open' : ''}`}>
      <button className="history-summary" onClick={onToggle} aria-expanded={open}>
        <span className="num">#{h.handNumber}</span>
        <span className="muted">
          Lv.{h.levelIndex + 1} {chips(h.sb)}/{chips(h.bb)}
        </span>
        <span className="mini-cards">
          {h.hole[you]?.map((c) => <Card key={c} code={c} size="sm" />)}
        </span>
        <span className={`net ${net > 0 ? 'plus' : net < 0 ? 'minus' : ''}`}>
          {net > 0 ? '+' : ''}
          {chips(net)}
        </span>
      </button>
      {open && (
        <div className="history-detail">
          <div className="hd-players">
            {([you, other(you)] as Seat[]).map((s) => (
              <div key={s} className="hd-player">
                <span className="name">
                  {name(s)}
                  {h.button === s && <span className="dealer small">D</span>}
                </span>
                <span className="cards">
                  {h.hole[s] ? h.hole[s]!.map((c) => <Card key={c} code={c} size="sm" />) : <span className="muted">非公開</span>}
                </span>
                <span className="muted">
                  {chips(h.startStacks[s])} → {chips(h.endStacks[s])}
                </span>
                {r.evals[s] && <span className="hand-name">{r.evals[s]!.name}</span>}
              </div>
            ))}
          </div>
          {STREETS.map((street) => {
            const entries = h.log.filter((e) => e.street === street);
            const board = h.board.slice(0, BOARD_UPTO[street]);
            if (entries.length === 0 && (street === 'preflop' || board.length < BOARD_UPTO[street])) return null;
            return (
              <div key={street} className="hd-street">
                <div className="hd-street-head">
                  <strong>{STREET_NAMES[street]}</strong>
                  {street !== 'preflop' && (
                    <span className="cards">
                      {board.map((c) => (
                        <Card key={c} code={c} size="sm" />
                      ))}
                    </span>
                  )}
                </div>
                <ol>
                  {entries.map((e, i) => (
                    <li key={i}>
                      <span className="who">{name(e.seat)}</span> {describeAction(e)}
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
          <p className="hd-result">
            {winText}・ポット {chips(r.pot)}
            {r.foldedSeat !== null && `（${name(r.foldedSeat)}がフォールド）`}
          </p>
        </div>
      )}
    </li>
  );
}
