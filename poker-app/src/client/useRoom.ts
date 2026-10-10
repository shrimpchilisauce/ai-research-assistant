import { useCallback, useEffect, useRef, useState } from 'react';
import type { Seat } from '../engine/hand';
import type { ClientMessage, GameEvent, HandRecordView, RoomView, ServerMessage } from '../shared/protocol';
import { storage } from './storage';

export type ConnStatus = 'connecting' | 'open' | 'reconnecting' | 'not_found' | 'replaced';

export interface RoomConnection {
  status: ConnStatus;
  welcomed: boolean;
  seat: Seat | null;
  canJoin: boolean;
  view: RoomView | null;
  error: string | null;
  history: { matchNumber: number; hands: HandRecordView[] } | null;
  send: (msg: ClientMessage) => void;
  /** サーバー時刻の推定値（ms）。 */
  serverNow: () => number;
  reconnect: () => void;
}

type EventHandler = (events: GameEvent[], view: RoomView, prev: RoomView | null) => void;

export function useRoom(roomId: string, onEvents: EventHandler): RoomConnection {
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [welcomed, setWelcomed] = useState(false);
  const [seat, setSeat] = useState<Seat | null>(null);
  const [canJoin, setCanJoin] = useState(false);
  const [view, setView] = useState<RoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<RoomConnection['history']>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const viewRef = useRef<RoomView | null>(null);
  const offsetRef = useRef<number | null>(null);
  const bestRttRef = useRef(Infinity);
  const attemptsRef = useRef(0);
  const stoppedRef = useRef(false);
  const timersRef = useRef<number[]>([]);
  const errorTimerRef = useRef<number | undefined>(undefined);
  const onEventsRef = useRef(onEvents);
  onEventsRef.current = onEvents;

  const serverNow = useCallback(() => Date.now() + (offsetRef.current ?? 0), []);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const connect = useCallback(() => {
    for (const t of timersRef.current) clearTimeout(t);
    timersRef.current = [];
    wsRef.current?.close();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/rooms/${roomId}/ws`);
    wsRef.current = ws;

    const ping = () => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'ping', c: Date.now() } satisfies ClientMessage));
    };

    ws.onopen = () => {
      attemptsRef.current = 0;
      ws.send(JSON.stringify({ t: 'hello', token: storage.token(roomId) ?? undefined } satisfies ClientMessage));
      // 最初は短い間隔で時刻合わせをして、あとはゆっくり
      ping();
      timersRef.current.push(window.setTimeout(ping, 1_000), window.setTimeout(ping, 3_000));
      timersRef.current.push(window.setInterval(ping, 25_000));
    };

    ws.onmessage = (e) => {
      if (wsRef.current !== ws) return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      switch (msg.t) {
        case 'welcome':
          if (msg.token) storage.setToken(roomId, msg.token);
          setSeat(msg.seat);
          setCanJoin(msg.canJoin);
          setWelcomed(true);
          setStatus('open');
          break;
        case 'state': {
          if (offsetRef.current === null) offsetRef.current = msg.view.serverNow - Date.now();
          const prev = viewRef.current;
          viewRef.current = msg.view;
          setView(msg.view);
          onEventsRef.current(msg.events, msg.view, prev);
          break;
        }
        case 'history':
          setHistory({ matchNumber: msg.matchNumber, hands: msg.hands });
          break;
        case 'pong': {
          const rtt = Date.now() - msg.c;
          // 往復時間が短いほど推定が正確なので、最短のものを採用する
          if (rtt <= bestRttRef.current) {
            bestRttRef.current = rtt;
            offsetRef.current = msg.s - (msg.c + rtt / 2);
          }
          break;
        }
        case 'error':
          if (msg.code === 'not_found') {
            stoppedRef.current = true;
            setStatus('not_found');
          } else if (msg.code === 'replaced') {
            stoppedRef.current = true;
            setStatus('replaced');
          } else {
            setError(msg.message);
            clearTimeout(errorTimerRef.current);
            errorTimerRef.current = window.setTimeout(() => setError(null), 4_000);
          }
          break;
      }
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      for (const t of timersRef.current) clearTimeout(t);
      timersRef.current = [];
      if (stoppedRef.current) return;
      setStatus('reconnecting');
      const delay = Math.min(10_000, 500 * 2 ** attemptsRef.current);
      attemptsRef.current += 1;
      timersRef.current.push(window.setTimeout(connect, delay));
    };
  }, [roomId]);

  const reconnect = useCallback(() => {
    stoppedRef.current = false;
    attemptsRef.current = 0;
    setStatus('connecting');
    connect();
  }, [connect]);

  useEffect(() => {
    stoppedRef.current = false;
    connect();
    const onVisible = () => {
      const ws = wsRef.current;
      if (document.visibilityState === 'visible' && !stoppedRef.current && (!ws || ws.readyState === WebSocket.CLOSED)) {
        attemptsRef.current = 0;
        connect();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      stoppedRef.current = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      for (const t of timersRef.current) clearTimeout(t);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  return { status, welcomed, seat, canJoin, view, error, history, send, serverNow, reconnect };
}

/** 一定間隔で再描画する（残り時間の表示用）。 */
export function useTicker(intervalMs: number, enabled = true) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
}
