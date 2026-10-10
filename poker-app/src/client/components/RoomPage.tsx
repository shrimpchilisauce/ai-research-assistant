import { useCallback, useEffect, useRef } from 'react';
import type { GameEvent, RoomView } from '../../shared/protocol';
import { play, type SoundName } from '../sound';
import { useRoom } from '../useRoom';
import { Game } from './Game';
import { Lobby } from './Lobby';
import { NameForm } from './NameForm';

interface Props {
  roomId: string;
  navigate: (path: string) => void;
}

const ACTION_SOUNDS: Partial<Record<string, SoundName>> = {
  fold: 'fold',
  check: 'check',
  call: 'chip',
  bet: 'chip',
  raise: 'chip',
};

function turnKey(v: RoomView | null): string | null {
  const m = v?.match;
  if (!v || !m?.turn || m.turn.seat !== v.you || !m.hand) return null;
  return `${m.hand.handNumber}:${m.hand.log.length}:${m.hand.board.length}`;
}

export function RoomPage({ roomId, navigate }: Props) {
  const lastTurnKey = useRef<string | null>(null);

  const onEvents = useCallback((events: GameEvent[], view: RoomView) => {
    for (const e of events) {
      if (e.type === 'handStart' || e.type === 'street' || e.type === 'reveal') play('deal');
      else if (e.type === 'action' && ACTION_SOUNDS[e.entry.type]) play(ACTION_SOUNDS[e.entry.type]!);
      else if (e.type === 'handEnd') play('win');
      else if (e.type === 'matchStart' || e.type === 'matchEnd') play('levelUp');
    }
    const key = turnKey(view);
    if (key && key !== lastTurnKey.current) window.setTimeout(() => play('turn'), 200);
    lastTurnKey.current = key;
  }, []);

  const conn = useRoom(roomId, onEvents);
  const { view, status } = conn;
  const playing = view?.phase === 'playing';

  // 対戦中は画面のスリープを防ぐ
  useEffect(() => {
    if (!playing || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let active = true;
    const request = async () => {
      try {
        const l = await navigator.wakeLock.request('screen');
        if (active) lock = l;
        else void l.release();
      } catch {
        // 対応していない・許可されない場合は何もしない
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request();
    };
    void request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release();
    };
  }, [playing]);

  if (status === 'not_found') {
    return (
      <main className="page center">
        <div className="panel">
          <h2>部屋が見つかりません</h2>
          <p>部屋の期限（最後の接続から24時間）が切れたか、リンクが間違っています。</p>
          <button className="btn primary" onClick={() => navigate('/')}>
            トップへ
          </button>
        </div>
      </main>
    );
  }

  if (status === 'replaced') {
    return (
      <main className="page center">
        <div className="panel">
          <h2>別のタブで開かれています</h2>
          <p>この席は別のタブまたは端末で開かれたため、こちらの接続を切りました。</p>
          <button className="btn primary" onClick={conn.reconnect}>
            このタブで開き直す
          </button>
        </div>
      </main>
    );
  }

  let body: React.ReactNode;
  if (!conn.welcomed || !view) {
    body = <p className="page center muted">接続中…</p>;
  } else if (conn.seat === null) {
    body = conn.canJoin ? (
      <main className="page center">
        <NameForm
          title={`${view.players[0]?.name ?? 'ホスト'}さんの部屋に参加`}
          submitLabel="参加する"
          onSubmit={(name) => conn.send({ t: 'join', name })}
        />
      </main>
    ) : (
      <main className="page center">
        <div className="panel">
          <h2>この部屋は満席です</h2>
          <p>この部屋ではすでに2人が対戦しています。</p>
          <button className="btn" onClick={() => navigate('/')}>
            トップへ
          </button>
        </div>
      </main>
    );
  } else if (view.phase === 'lobby' || view.phase === 'starting') {
    body = <Lobby view={view} conn={conn} />;
  } else {
    body = <Game view={view} conn={conn} onLeave={() => navigate('/')} />;
  }

  return (
    <>
      {body}
      {status === 'reconnecting' && <div className="banner warn">接続が切れました。再接続しています…</div>}
      {conn.error && (
        <div className="toast error" role="alert">
          {conn.error}
        </div>
      )}
    </>
  );
}
