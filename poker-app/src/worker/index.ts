import { DurableObject } from 'cloudflare:workers';
import { cryptoRandomInt } from '../engine/cards';
import type { Seat } from '../engine/hand';
import { RoomCore, RoomError, type RoomDeps } from '../server/room';
import type { HandRecord, RoomState } from '../server/state';
import { recordView } from '../server/views';
import type { ClientMessage, GameEvent, ServerMessage } from '../shared/protocol';

const ROOM_ID_PATTERN = /^[A-Za-z0-9]{10}$/;
// 見間違えやすい文字（0/O, 1/l/I）を除いた英数字
const ROOM_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const MAX_MESSAGE_BYTES = 64 * 1024;

function newRoomId(): string {
  let id = '';
  for (let i = 0; i < 10; i++) id += ROOM_ID_ALPHABET[cryptoRandomInt(ROOM_ID_ALPHABET.length)];
  return id;
}

function newToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const deps: RoomDeps = { randomInt: cryptoRandomInt, newToken };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const roomId = newRoomId();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(roomId));
        const res = await stub.create(roomId, body?.name);
        if (res.ok) return json({ roomId, token: res.token });
        if (res.code !== 'exists') return json({ code: res.code, message: res.message }, 400);
      }
      return json({ code: 'unavailable', message: '部屋を作れませんでした。もう一度お試しください' }, 503);
    }

    const ws = url.pathname.match(/^\/api\/rooms\/([^/]+)\/ws$/);
    if (ws) {
      if (!ROOM_ID_PATTERN.test(ws[1])) return new Response('Not found', { status: 404 });
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
      return env.ROOMS.get(env.ROOMS.idFromName(ws[1])).fetch(request);
    }

    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

interface Attachment {
  seat: Seat | null;
  /** hello を受け取った（状態を送ってよい）接続か。 */
  hello: boolean;
}

const handKey = (matchNumber: number, handNumber: number) =>
  `hand:${String(matchNumber).padStart(6, '0')}:${String(handNumber).padStart(6, '0')}`;

/**
 * 1部屋 = 1 Durable Object。WebSocket Hibernation を使うので、
 * 誰も操作していない間はメモリから追い出され、状態はストレージから復元される。
 */
export class PokerRoom extends DurableObject<Env> {
  private core: RoomCore | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const state = ctx.storage.kv.get<RoomState>('room');
    if (state) {
      this.core = new RoomCore(state, deps);
      for (const ws of ctx.getWebSockets()) {
        const seat = this.attachment(ws).seat;
        if (seat !== null) this.core.connected[seat] = true;
      }
    }
  }

  async create(roomId: string, name: unknown) {
    if (this.core) return { ok: false as const, code: 'exists', message: '' };
    try {
      const { core, token } = RoomCore.create(roomId, String(name ?? ''), Date.now(), deps);
      this.core = core;
      await this.commit();
      return { ok: true as const, token };
    } catch (e) {
      if (e instanceof RoomError) return { ok: false as const, code: e.code, message: e.message };
      throw e;
    }
  }

  async fetch(): Promise<Response> {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ seat: null, hello: false } satisfies Attachment);
    if (!this.core) {
      this.send(server, { t: 'error', code: 'not_found', message: '部屋が見つかりません。期限が切れたか、URL が間違っています' });
      server.close(4004, 'not found');
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    if (typeof data !== 'string' || data.length > MAX_MESSAGE_BYTES) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    const now = Date.now();
    if (msg?.t === 'ping') {
      this.send(ws, { t: 'pong', c: msg.c, s: now });
      return;
    }
    const core = this.core;
    if (!core) {
      ws.close(4004, 'not found');
      return;
    }

    let seat = this.attachment(ws).seat;
    try {
      core.tick(now);
      switch (msg.t) {
        case 'hello': {
          seat = core.seatForToken(msg.token);
          if (seat !== null) this.closeOtherSockets(ws, seat);
          this.setAttachment(ws, { seat, hello: true });
          if (seat !== null) core.setConnected(seat, true, now);
          this.send(ws, { t: 'welcome', seat, canJoin: seat === null && core.guestSeatOpen() });
          break;
        }
        case 'join': {
          if (seat !== null) throw new RoomError('already_joined', 'すでに参加しています');
          const joined = core.join(msg.name, now);
          seat = joined.seat;
          this.setAttachment(ws, { seat, hello: true });
          core.setConnected(seat, true, now);
          this.send(ws, { t: 'welcome', seat, token: joined.token, canJoin: false });
          break;
        }
        case 'history': {
          if (seat === null) throw new RoomError('not_joined', '参加していません');
          const matchNumber = core.state.matchNumber;
          const prefix = handKey(matchNumber, 0).slice(0, -6);
          const hands = [...this.ctx.storage.kv.list<HandRecord>({ prefix })].map(([, r]) => recordView(r, seat));
          this.send(ws, { t: 'history', matchNumber, hands });
          break;
        }
        default: {
          if (seat === null) throw new RoomError('not_joined', '参加していません');
          this.dispatch(core, seat, msg, now);
        }
      }
    } catch (e) {
      if (e instanceof RoomError) {
        this.send(ws, { t: 'error', code: e.code, message: e.message });
      } else {
        console.error(e);
        this.send(ws, { t: 'error', code: 'internal', message: 'サーバーでエラーが起きました' });
      }
    }
    const events = await this.commit();
    this.broadcast(now, events);
  }

  private dispatch(core: RoomCore, seat: Seat, msg: ClientMessage, now: number) {
    switch (msg.t) {
      case 'settings':
        return core.updateSettings(seat, msg.settings, now);
      case 'ready':
        return core.setReady(seat, msg.ready === true, now);
      case 'act':
        return core.act(seat, msg.handNumber, msg.action, now);
      case 'pause':
        return core.pause(seat, now);
      case 'resume':
        return core.resume(seat, now);
      case 'show':
        return core.show(seat, msg.handNumber, now);
      case 'resign':
        return core.resign(seat, now);
      case 'rematch':
        return core.rematch(seat, now);
      default:
        throw new RoomError('unknown_message', '不明なメッセージです');
    }
  }

  async webSocketClose(ws: WebSocket) {
    await this.disconnected(ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.disconnected(ws);
  }

  private async disconnected(ws: WebSocket) {
    const core = this.core;
    const { seat } = this.attachment(ws);
    this.setAttachment(ws, { seat: null, hello: false });
    if (!core || seat === null) return;
    const stillConnected = this.ctx
      .getWebSockets()
      .some((o) => o !== ws && o.readyState === WebSocket.OPEN && this.attachment(o).seat === seat);
    if (stillConnected) return;
    const now = Date.now();
    core.setConnected(seat, false, now);
    const events = await this.commit();
    this.broadcast(now, events);
  }

  async alarm() {
    const core = this.core;
    if (!core) return;
    const now = Date.now();
    if (core.isExpired(now)) {
      for (const ws of this.ctx.getWebSockets()) ws.close(4004, 'expired');
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      this.core = null;
      return;
    }
    core.tick(now);
    const events = await this.commit();
    this.broadcast(now, events);
  }

  /** 状態を保存し、次のアラームを設定する。発生したイベントを返す。 */
  private async commit(): Promise<GameEvent[]> {
    const core = this.core;
    if (!core) return [];
    const out = core.takeOutbox();
    const kv = this.ctx.storage.kv;
    kv.put('room', core.state);
    if (out.clearHistory) {
      const keys = [...kv.list({ prefix: 'hand:' })].map(([k]) => k);
      for (const k of keys) kv.delete(k);
    }
    for (const r of out.records) kv.put(handKey(core.state.matchNumber, r.handNumber), r);
    const next = core.nextWakeAt();
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next);
    return out.events;
  }

  private broadcast(now: number, events: GameEvent[]) {
    const core = this.core;
    if (!core) return;
    for (const ws of this.ctx.getWebSockets()) {
      const a = this.attachment(ws);
      if (!a.hello) continue;
      this.send(ws, { t: 'state', view: core.view(a.seat, now), events: a.seat === null ? [] : events });
    }
  }

  private closeOtherSockets(current: WebSocket, seat: Seat) {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === current || this.attachment(ws).seat !== seat) continue;
      this.setAttachment(ws, { seat: null, hello: false });
      this.send(ws, { t: 'error', code: 'replaced', message: '別のタブ・端末でこの席が開かれました' });
      ws.close(4001, 'replaced');
    }
  }

  private attachment(ws: WebSocket): Attachment {
    return (ws.deserializeAttachment() as Attachment | null) ?? { seat: null, hello: false };
  }

  private setAttachment(ws: WebSocket, a: Attachment) {
    ws.serializeAttachment(a);
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // 切断済みの接続には送れない
    }
  }
}
