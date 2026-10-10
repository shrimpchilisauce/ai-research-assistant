import { useEffect, useRef, useState } from 'react';
import { validateSettings, type Settings } from '../../engine/settings';
import type { RoomView } from '../../shared/protocol';
import { useTicker, type RoomConnection } from '../useRoom';
import { SettingsEditor } from './SettingsEditor';

interface Props {
  view: RoomView;
  conn: RoomConnection;
}

const allNumbersFinite = (s: Settings) =>
  [s.startingStack, s.levelMinutes, s.actionSeconds, s.timebankSeconds].every(Number.isFinite) &&
  s.levels.every((l) => [l.sb, l.bb, l.ante].every(Number.isFinite));

export function Lobby({ view, conn }: Props) {
  const isHost = view.you === 0;
  const guest = view.players[1];
  const host = view.players[0];
  const [draft, setDraft] = useState<Settings>(view.settings);
  const serverSettings = useRef(view.settings);
  serverSettings.current = view.settings;

  // ホストの編集内容を少し待ってからサーバーへ送る（入力途中の値は送らない）
  useEffect(() => {
    if (!isHost || !allNumbersFinite(draft)) return;
    if (JSON.stringify(draft) === JSON.stringify(serverSettings.current)) return;
    const t = window.setTimeout(() => conn.send({ t: 'settings', settings: draft }), 300);
    return () => clearTimeout(t);
  }, [draft, isHost, conn]);

  const settings = isHost ? draft : view.settings;
  const check = validateSettings(settings);
  const starting = view.phase === 'starting';
  useTicker(100, starting);
  const countdown = starting && view.startAt ? Math.max(1, Math.ceil((view.startAt - conn.serverNow()) / 1_000)) : null;

  return (
    <main className="page lobby">
      <header className="lobby-head">
        <h1>ロビー</h1>
        <p className="muted">{isHost ? 'あなたがホストです。対戦の設定を決めてください。' : `${host?.name}さんの部屋`}</p>
      </header>

      <ShareBox roomId={view.roomId} />

      <section className="panel players">
        <PlayerRow label="ホスト" name={host?.name} connected={host?.connected} you={view.you === 0} />
        <PlayerRow
          label="ゲスト"
          name={guest?.name}
          connected={guest?.connected}
          you={view.you === 1}
          status={guest ? (guest.ready ? '準備OK' : '確認中') : undefined}
        />
      </section>

      <section className="panel">
        <h2>対戦の設定</h2>
        {!isHost && <p className="muted small">設定はホストだけが変更できます。</p>}
        <SettingsEditor value={settings} readOnly={!isHost} onChange={setDraft} />
        {check.errors.length > 0 && (
          <ul className="messages errors">
            {check.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {check.warnings.length > 0 && (
          <ul className="messages warnings">
            {check.warnings.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </section>

      <footer className="lobby-actions">
        {isHost ? (
          <p className="muted">
            {!guest
              ? '相手の参加を待っています。上のリンクを送ってください。'
              : !guest.connected
                ? `${guest.name}さんの接続を待っています…`
                : guest.ready
                  ? 'まもなく開始します'
                  : `${guest.name}さんが設定を確認しています。準備OKになると開始します。`}
          </p>
        ) : (
          <>
            <p className="muted small">設定を確認して「準備OK」を押すと、3秒後に対戦が始まります。</p>
            <button
              className={`btn big ${guest?.ready ? '' : 'primary'}`}
              disabled={!guest?.ready && (check.errors.length > 0 || !host?.connected)}
              onClick={() => conn.send({ t: 'ready', ready: !guest?.ready })}
            >
              {guest?.ready ? '準備OKを取り消す' : host?.connected ? '準備OK' : 'ホストの接続を待っています'}
            </button>
          </>
        )}
      </footer>

      {countdown !== null && (
        <div className="overlay">
          <div className="countdown">
            <p>まもなく対戦開始</p>
            <strong key={countdown}>{countdown}</strong>
          </div>
        </div>
      )}
    </main>
  );
}

function PlayerRow(props: { label: string; name?: string; connected?: boolean; you: boolean; status?: string }) {
  return (
    <div className="player-row">
      <span className="role">{props.label}</span>
      {props.name ? (
        <>
          <span className={`dot ${props.connected ? 'on' : 'off'}`} aria-label={props.connected ? '接続中' : '切断中'} />
          <span className="name">
            {props.name}
            {props.you && <span className="you">（あなた）</span>}
          </span>
          {props.status && <span className="tag">{props.status}</span>}
        </>
      ) : (
        <span className="muted">参加待ち…</span>
      )}
    </div>
  );
}

function ShareBox({ roomId }: { roomId: string }) {
  const url = `${location.origin}/r/${roomId}`;
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator.share === 'function';

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      // クリップボードが使えない環境では、入力欄を選択してコピーしてもらう
      const input = document.getElementById('share-url') as HTMLInputElement | null;
      input?.select();
    }
  }

  return (
    <section className="panel share">
      <label className="field">
        <span>この部屋のリンク</span>
        <input id="share-url" readOnly value={url} onFocus={(e) => e.target.select()} />
      </label>
      <div className="row">
        <button className="btn grow" onClick={copy}>
          {copied ? 'コピーしました' : 'リンクをコピー'}
        </button>
        {canShare && (
          <button
            className="btn grow"
            onClick={() => navigator.share({ title: 'ヘッズアップ・ホールデム', text: 'ポーカーで対戦しよう', url }).catch(() => {})}
          >
            共有
          </button>
        )}
      </div>
    </section>
  );
}
