import { useEffect, useRef, useState } from 'react';
import { clockNow } from '../../engine/clock';
import { other, totalPot, type PlayerAction, type Seat } from '../../engine/hand';
import { effectiveAnte, levelIndexAt, msUntilNextLevel } from '../../engine/settings';
import type { HandView, MatchView, RoomView } from '../../shared/protocol';
import { chips, clockText, describeAction, durationText } from '../format';
import { isMuted, play, setMuted } from '../sound';
import { useTicker, type RoomConnection } from '../useRoom';
import { ActionPanel } from './ActionPanel';
import { Card, EmptyCard } from './Card';
import { HistorySheet } from './HistorySheet';
import { SettingsEditor } from './SettingsEditor';

interface Props {
  view: RoomView;
  conn: RoomConnection;
  onLeave: () => void;
}

type Sheet = null | 'menu' | 'history' | 'latest' | 'settings';

export function Game({ view, conn, onLeave }: Props) {
  const m = view.match!;
  const you = view.you!;
  const opp = other(you);
  const hand = m.hand;
  const settings = view.settings;
  const [sheet, setSheet] = useState<Sheet>(null);
  const [showResult, setShowResult] = useState(true);

  useTicker(200, view.phase === 'playing');
  const now = conn.serverNow();
  const gameNow = clockNow(m.clock, now);

  // レベル表示はトーナメントクロック基準、実際のブラインドはハンド開始時のレベル
  const clockLevel = levelIndexAt(gameNow, settings);
  const nextLevelIn = msUntilNextLevel(gameNow, settings);
  const handLevel = hand?.levelIndex ?? clockLevel;
  const level = settings.levels[clockLevel];

  useLevelUpSound(clockLevel, view.phase === 'playing');
  useWarningSound(m, you, gameNow);

  const names: [string, string] = [view.players[0]?.name ?? '', view.players[1]?.name ?? ''];
  const act = (action: PlayerAction) => hand && conn.send({ t: 'act', handNumber: hand.handNumber, action });

  return (
    <main className="game">
      <header className="game-head">
        <div className="level">
          <strong>Lv.{clockLevel + 1}</strong>
          <span>
            {chips(level.sb)}/{chips(level.bb)}
          </span>
          {effectiveAnte(level, settings.anteType) > 0 && (
            <span className="muted small">アンテ {chips(effectiveAnte(level, settings.anteType))}</span>
          )}
        </div>
        <div className="next-level">
          {m.pause ? (
            <span className="paused-tag">一時停止中</span>
          ) : nextLevelIn === null ? (
            <span className="muted">最終レベル</span>
          ) : (
            <>
              <span className="muted">次のレベルまで</span> <strong className="mono">{clockText(nextLevelIn)}</strong>
            </>
          )}
        </div>
        <div className="head-right">
          <span className="muted small">#{m.handNumber}</span>
          <button className="icon-btn menu-btn" aria-label="メニュー" onClick={() => setSheet('menu')}>
            ≡
          </button>
        </div>
      </header>

      {hand && clockLevel > handLevel && view.phase === 'playing' && (
        <div className="notice">
          次のハンドから Lv.{clockLevel + 1}（{chips(level.sb)}/{chips(level.bb)}）
        </div>
      )}

      <section className="table">
        <SeatPanel seat={opp} you={you} name={names[opp]} view={view} m={m} gameNow={gameNow} />
        <Board hand={hand} names={names} you={you} />
        <SeatPanel seat={you} you={you} name={names[you]} view={view} m={m} gameNow={gameNow} />
      </section>

      <section className="action-area">
        {view.phase === 'finished' ? (
          <div className="status-line">
            <button className="btn" onClick={() => setShowResult(true)}>
              結果を見る
            </button>
          </div>
        ) : m.pause ? null : hand?.legal ? (
          <ActionPanel
            key={`${hand.handNumber}:${hand.log.length}:${hand.board.length}`}
            hand={hand}
            legal={hand.legal}
            you={you}
            onAct={act}
          />
        ) : (
          <StatusLine hand={hand} you={you} oppName={names[opp]} onShow={() => hand && conn.send({ t: 'show', handNumber: hand.handNumber })} />
        )}
        {hand && hand.handNumber > 1 && view.phase === 'playing' && !hand.legal && (
          <button className="link-btn" onClick={() => setSheet('latest')}>
            直前のハンドを見る
          </button>
        )}
      </section>

      {m.pause && view.phase === 'playing' && (
        <PauseOverlay m={m} names={names} you={you} now={now} onResume={() => conn.send({ t: 'resume' })} onMenu={() => setSheet('menu')} />
      )}

      {view.phase === 'finished' && m.finished && showResult && (
        <ResultOverlay
          view={view}
          m={m}
          names={names}
          onRematch={() => conn.send({ t: 'rematch' })}
          onHistory={() => setSheet('history')}
          onClose={() => setShowResult(false)}
          onLeave={onLeave}
        />
      )}

      {sheet === 'menu' && (
        <MenuSheet
          view={view}
          m={m}
          onClose={() => setSheet(null)}
          onPause={() => conn.send({ t: 'pause' })}
          onResume={() => conn.send({ t: 'resume' })}
          onHistory={() => setSheet('history')}
          onSettings={() => setSheet('settings')}
          onResign={() => conn.send({ t: 'resign' })}
        />
      )}
      {(sheet === 'history' || sheet === 'latest') && (
        <HistorySheet view={view} conn={conn} openLatest={sheet === 'latest'} onClose={() => setSheet(null)} />
      )}
      {sheet === 'settings' && (
        <div className="sheet-backdrop" onClick={() => setSheet(null)}>
          <div className="sheet" role="dialog" aria-label="対戦の設定" onClick={(e) => e.stopPropagation()}>
            <header className="sheet-head">
              <h2>対戦の設定</h2>
              <button className="icon-btn" aria-label="閉じる" onClick={() => setSheet(null)}>
                ×
              </button>
            </header>
            <SettingsEditor value={settings} readOnly />
          </div>
        </div>
      )}
    </main>
  );
}

function useLevelUpSound(levelIndex: number, active: boolean) {
  const prev = useRef(levelIndex);
  useEffect(() => {
    if (active && levelIndex > prev.current) play('levelUp');
    prev.current = levelIndex;
  }, [levelIndex, active]);
}

/** 自分の残り時間（タイムバンク込み）が10秒になったら1回だけ鳴らす。 */
function useWarningSound(m: MatchView, you: Seat, gameNow: number) {
  const warned = useRef<string | null>(null);
  const turn = m.turn;
  const key = turn && turn.seat === you && m.hand ? `${m.hand.handNumber}:${m.hand.log.length}:${m.hand.board.length}` : null;
  const remaining = turn ? turn.deadline - gameNow : Infinity;
  useEffect(() => {
    if (!key || m.pause) return;
    if (remaining <= 10_000 && remaining > 0 && warned.current !== key) {
      warned.current = key;
      play('warning');
    }
  }, [key, remaining, m.pause]);
}

interface SeatProps {
  seat: Seat;
  you: Seat;
  name: string;
  view: RoomView;
  m: MatchView;
  gameNow: number;
}

function SeatPanel({ seat, you, name, view, m, gameNow }: SeatProps) {
  const hand = m.hand;
  const player = view.players[seat];
  const isYou = seat === you;
  const stack = hand ? hand.stacks[seat] : m.stacks[seat];
  const bet = hand && hand.status !== 'complete' ? hand.streetBets[seat] : 0;
  const cards = hand?.hole[seat];
  const folded = hand?.result?.foldedSeat === seat || hand?.log.some((e) => e.seat === seat && e.type === 'fold');
  const winner = hand?.result?.winners.includes(seat);
  const evalView = hand?.result?.evals[seat];
  const lastAction = hand?.log.filter((e) => e.seat === seat && e.street === hand.street && e.type !== 'ante').at(-1);
  const turn = m.turn?.seat === seat && !m.pause ? m.turn : null;
  // タイムバンクを使っている最中は、残りを減らしながら表示する
  const timebankLeft = turn && gameNow > turn.baseDeadline ? Math.max(0, turn.deadline - gameNow) : m.timebankMs[seat];
  const busted = view.phase === 'finished' && m.finished?.winner !== seat;

  return (
    <div className={`seat ${isYou ? 'self' : 'opponent'} ${turn ? 'acting' : ''} ${winner ? 'winner' : ''}`}>
      <div className="seat-info">
        <div className="seat-name">
          {hand?.button === seat && <span className="dealer" title="ディーラーボタン">D</span>}
          <span className="name">{name}</span>
          {isYou && <span className="you">あなた</span>}
          {!player?.connected && <span className="tag warn">切断中</span>}
        </div>
        <div className="seat-stack">
          <span className={`stack ${busted ? 'muted' : ''}`}>{chips(stack)}</span>
          <span className="timebank muted small" title="タイムバンク">
            ⏱ {Math.ceil(timebankLeft / 1_000)}秒
          </span>
        </div>
        {turn && <TurnTimer turn={turn} gameNow={gameNow} actionMs={view.settings.actionSeconds * 1_000} timebankMs={m.timebankMs[seat]} />}
      </div>
      <div className="seat-cards">
        {hand && !folded
          ? [0, 1].map((i) =>
              cards ? (
                <Card key={i} code={cards[i]} size={isYou ? 'lg' : 'md'} highlight={winner && evalView?.cards.includes(cards[i])} />
              ) : (
                <Card key={i} size={isYou ? 'lg' : 'md'} />
              ),
            )
          : hand && isYou && cards
            ? cards.map((c) => <Card key={c} code={c} size="lg" dim />)
            : null}
      </div>
      <div className="seat-extra">
        {bet > 0 && <span className="bet">{chips(bet)}</span>}
        {lastAction && hand?.status !== 'complete' && <span className="last-action">{describeAction(lastAction)}</span>}
        {evalView && <span className={`hand-name ${winner ? 'win' : ''}`}>{evalView.name}</span>}
        {hand?.result && hand.result.payouts[seat] > 0 && <span className="won">+{chips(hand.result.payouts[seat])}</span>}
        {hand?.result?.showdown && !cards && <span className="muted small">マック</span>}
      </div>
    </div>
  );
}

function TurnTimer({ turn, gameNow, actionMs, timebankMs }: { turn: { baseDeadline: number; deadline: number }; gameNow: number; actionMs: number; timebankMs: number }) {
  const base = turn.baseDeadline - gameNow;
  const inTimebank = base <= 0;
  const remaining = inTimebank ? turn.deadline - gameNow : base;
  const total = inTimebank ? Math.max(1, timebankMs) : actionMs;
  const ratio = Math.max(0, Math.min(1, remaining / total));
  const low = turn.deadline - gameNow <= 10_000;
  return (
    <div className={`turn-timer ${inTimebank ? 'timebank' : ''} ${low ? 'low' : ''}`}>
      <div className="bar" style={{ width: `${ratio * 100}%` }} />
      <span className="mono">
        {inTimebank ? 'タイムバンク ' : ''}
        {clockText(remaining)}
      </span>
    </div>
  );
}

function Board({ hand, names, you }: { hand: HandView | null; names: [string, string]; you: Seat }) {
  const r = hand?.result;
  const winningCards = r ? r.winners.flatMap((w) => r.evals[w]?.cards ?? []) : [];
  const nameOf = (s: Seat) => (s === you ? 'あなた' : names[s]);

  let banner: string | null = null;
  if (r) {
    if (r.winners.length === 2) banner = `引き分け（${chips(r.payouts[0])} / ${chips(r.payouts[1])}）`;
    else {
      const w = r.winners[0];
      banner = `${nameOf(w)}の勝ち +${chips(r.payouts[w])}`;
      if (r.foldedSeat !== null) banner += `（${nameOf(r.foldedSeat)}がフォールド）`;
    }
  } else if (hand?.status === 'runout') {
    banner = 'オールイン';
  }

  return (
    <div className="board">
      <div className="pot">
        {hand ? (
          <>
            <span className="muted small">ポット</span> <strong>{chips(r ? r.pot : totalPot(hand))}</strong>
          </>
        ) : (
          <span className="muted">配っています…</span>
        )}
      </div>
      <div className="board-cards">
        {[0, 1, 2, 3, 4].map((i) =>
          hand?.board[i] ? (
            <Card key={hand.board[i]} code={hand.board[i]} highlight={winningCards.includes(hand.board[i])} />
          ) : (
            <EmptyCard key={`e${i}`} />
          ),
        )}
      </div>
      {banner && <div className={`board-banner ${r ? 'result' : 'allin'}`}>{banner}</div>}
    </div>
  );
}

function StatusLine({ hand, you, oppName, onShow }: { hand: HandView | null; you: Seat; oppName: string; onShow: () => void }) {
  if (!hand) return <div className="status-line muted">次のハンドを配っています…</div>;
  if (hand.status === 'complete') {
    const canShow = !hand.allInShowdown && hand.result && !hand.result.shown[you] && hand.hole[you];
    return (
      <div className="status-line">
        <span className="muted">次のハンドを準備中…</span>
        {canShow && (
          <button className="btn small" onClick={onShow}>
            手札を見せる
          </button>
        )}
      </div>
    );
  }
  if (hand.status === 'runout') return <div className="status-line muted">ボードを配っています…</div>;
  if (hand.toAct !== null && hand.toAct !== you) return <div className="status-line muted">{oppName}さんが考えています…</div>;
  return <div className="status-line muted">…</div>;
}

function PauseOverlay({ m, names, you, now, onResume, onMenu }: { m: MatchView; names: [string, string]; you: Seat; now: number; onResume: () => void; onMenu: () => void }) {
  const p = m.pause!;
  const who = p.by === null ? '両者の接続が切れたため' : p.by === you ? 'あなたが' : `${names[p.by]}さんが`;
  const countdown = p.resumeAt !== null ? Math.max(1, Math.ceil((p.resumeAt - now) / 1_000)) : null;
  return (
    <div className="overlay pause">
      <div className="panel">
        <h2>一時停止中</h2>
        <p className="muted">{who}一時停止しました。ブラインドと持ち時間の時計は止まっています。</p>
        {countdown !== null ? (
          <p className="countdown small-count">
            再開まで <strong key={countdown}>{countdown}</strong>
          </p>
        ) : (
          <button className="btn primary big" onClick={onResume}>
            再開する
          </button>
        )}
        <button className="link-btn" onClick={onMenu}>
          メニュー
        </button>
      </div>
    </div>
  );
}

function MenuSheet(props: {
  view: RoomView;
  m: MatchView;
  onClose: () => void;
  onPause: () => void;
  onResume: () => void;
  onHistory: () => void;
  onSettings: () => void;
  onResign: () => void;
}) {
  const { view, m, onClose } = props;
  const [muted, setMutedState] = useState(isMuted());
  const [confirmResign, setConfirmResign] = useState(false);
  const playing = view.phase === 'playing';

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet menu" role="dialog" aria-label="メニュー" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>メニュー</h2>
          <button className="icon-btn" aria-label="閉じる" onClick={onClose}>
            ×
          </button>
        </header>
        {playing &&
          (m.pause ? (
            m.pause.resumeAt === null && (
              <button className="btn block" onClick={() => (props.onResume(), onClose())}>
                再開する
              </button>
            )
          ) : (
            <button className="btn block" onClick={() => (props.onPause(), onClose())}>
              一時停止
            </button>
          ))}
        <button className="btn block" onClick={props.onHistory}>
          ハンド履歴
        </button>
        <button className="btn block" onClick={props.onSettings}>
          対戦の設定を見る
        </button>
        <button
          className="btn block"
          onClick={() => {
            setMuted(!muted);
            setMutedState(!muted);
          }}
        >
          効果音：{muted ? 'オフ' : 'オン'}
        </button>
        {playing &&
          (confirmResign ? (
            <div className="confirm">
              <p>本当に投了しますか？相手の勝ちで試合が終わります。</p>
              <div className="row">
                <button className="btn grow" onClick={() => setConfirmResign(false)}>
                  やめる
                </button>
                <button className="btn danger grow" onClick={() => (props.onResign(), onClose())}>
                  投了する
                </button>
              </div>
            </div>
          ) : (
            <button className="btn block danger-outline" onClick={() => setConfirmResign(true)}>
              投了
            </button>
          ))}
      </div>
    </div>
  );
}

function ResultOverlay(props: {
  view: RoomView;
  m: MatchView;
  names: [string, string];
  onRematch: () => void;
  onHistory: () => void;
  onClose: () => void;
  onLeave: () => void;
}) {
  const { view, m, names } = props;
  const f = m.finished!;
  const you = view.you!;
  const won = f.winner === you;
  const me = view.players[you];
  const opp = view.players[other(you)];
  const level = view.settings.levels[f.maxLevelIndex];

  return (
    <div className="overlay result">
      <div className="panel">
        <p className="result-kicker">{f.reason === 'resign' ? (won ? '相手が投了しました' : '投了しました') : '試合終了'}</p>
        <h2 className={won ? 'win' : 'lose'}>{won ? 'あなたの勝ち！' : `${names[f.winner]}さんの勝ち`}</h2>
        <dl className="stats">
          <div>
            <dt>ハンド数</dt>
            <dd>{f.hands}</dd>
          </div>
          <div>
            <dt>試合時間</dt>
            <dd>{durationText(f.durationMs)}</dd>
          </div>
          <div>
            <dt>到達レベル</dt>
            <dd>
              Lv.{f.maxLevelIndex + 1}（{chips(level.sb)}/{chips(level.bb)}）
            </dd>
          </div>
        </dl>
        <button className="btn primary big" disabled={me?.rematch} onClick={props.onRematch}>
          {me?.rematch ? '相手を待っています…' : opp?.rematch ? 'リマッチを受ける' : 'リマッチ'}
        </button>
        {opp?.rematch && !me?.rematch && <p className="muted small">{names[other(you)]}さんがリマッチを希望しています</p>}
        <div className="row">
          <button className="btn grow" onClick={props.onHistory}>
            ハンド履歴
          </button>
          <button className="btn grow" onClick={props.onClose}>
            テーブルを見る
          </button>
        </div>
        <button className="link-btn" onClick={props.onLeave}>
          トップへ戻る
        </button>
      </div>
    </div>
  );
}
