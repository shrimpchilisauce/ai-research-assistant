import { fullDeck, shuffle, type RandomInt } from '../engine/cards';
import { clockNow, gameToWall, pauseClock, resumeClock, startedClock } from '../engine/clock';
import {
  applyAction,
  dealRunout,
  EngineError,
  other,
  revealHand,
  startHand,
  timeoutAction,
  type HandState,
  type PlayerAction,
  type Seat,
} from '../engine/hand';
import { defaultSettings, effectiveAnte, levelIndexAt, parseSettings, validateSettings } from '../engine/settings';
import { normalizeName, type GameEvent, type RoomView } from '../shared/protocol';
import type { HandRecord, MatchState, RoomState } from './state';
import { handView, recordFromHand } from './views';

export const TIMING = {
  startCountdownMs: 3_000,
  resumeCountdownMs: 3_000,
  runoutStepMs: 1_500,
  resultAfterFoldMs: 2_000,
  resultAfterShowdownMs: 5_000,
  roomTtlMs: 24 * 60 * 60 * 1_000,
} as const;

export class RoomError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

export interface RoomDeps {
  randomInt: RandomInt;
  newToken: () => string;
}

/** 状態変更のあとで Durable Object が処理するもの。 */
export interface Outbox {
  events: GameEvent[];
  /** 保存（上書き）するハンド記録。 */
  records: HandRecord[];
  /** 新しい試合が始まったので古い履歴を消す。 */
  clearHistory: boolean;
}

/**
 * 1部屋分のロジック。通信や保存からは独立していて、時刻はすべて引数で受け取る。
 * Durable Object はこのクラスを呼び出し、state を保存し、view を各接続へ送る。
 */
export class RoomCore {
  connected: [boolean, boolean] = [false, false];
  outbox: Outbox = { events: [], records: [], clearHistory: false };

  constructor(public state: RoomState, private deps: RoomDeps) {}

  static create(id: string, hostName: string, now: number, deps: RoomDeps): { core: RoomCore; token: string } {
    const name = normalizeName(hostName);
    if (!name) throw new RoomError('invalid_name', 'ニックネームは1〜12文字で入力してください');
    const token = deps.newToken();
    const state: RoomState = {
      id,
      createdAt: now,
      phase: 'lobby',
      settings: defaultSettings(),
      players: [{ name, token, ready: false, rematch: false }, null],
      startAt: null,
      matchNumber: 0,
      match: null,
      lastActiveAt: now,
    };
    return { core: new RoomCore(state, deps), token };
  }

  takeOutbox(): Outbox {
    const o = this.outbox;
    this.outbox = { events: [], records: [], clearHistory: false };
    return o;
  }

  private emit(e: GameEvent) {
    this.outbox.events.push(e);
  }

  // ───────── 参加・接続 ─────────

  seatForToken(token: unknown): Seat | null {
    if (typeof token !== 'string' || token.length === 0) return null;
    const i = this.state.players.findIndex((p) => p?.token === token);
    return i === 0 || i === 1 ? i : null;
  }

  /** ゲスト席に入れるか。ロビーで前のゲストが切断していれば入れ替われる。 */
  guestSeatOpen(): boolean {
    const guest = this.state.players[1];
    return !guest || (this.state.phase === 'lobby' && !this.connected[1]);
  }

  join(rawName: unknown, now: number): { seat: Seat; token: string } {
    const name = normalizeName(rawName);
    if (!name) throw new RoomError('invalid_name', 'ニックネームは1〜12文字で入力してください');
    if (!this.guestSeatOpen()) throw new RoomError('room_full', 'この部屋は満席です');
    const token = this.deps.newToken();
    this.state.players[1] = { name, token, ready: false, rematch: false };
    this.connected[1] = false;
    this.state.lastActiveAt = now;
    return { seat: 1, token };
  }

  setConnected(seat: Seat, connected: boolean, now: number) {
    if (this.connected[seat] === connected) return;
    // 接続状態は持ち時間の締め切りに影響するので、変える前に期限の来た処理を済ませる
    this.tick(now);
    this.connected[seat] = connected;
    this.state.lastActiveAt = now;
    const s = this.state;
    if (!connected && s.phase === 'starting') this.cancelStart();
    const m = s.match;
    if (s.phase === 'playing' && m && !m.pause && !this.connected[0] && !this.connected[1]) {
      this.pauseMatch(m, null, now);
    }
    this.tick(now);
  }

  touch(now: number) {
    if (this.connected[0] || this.connected[1]) this.state.lastActiveAt = now;
  }

  // ───────── ロビー ─────────

  updateSettings(seat: Seat, input: unknown, now: number) {
    if (seat !== 0) throw new RoomError('forbidden', '設定を変更できるのはホストだけです');
    const s = this.state;
    if (s.phase !== 'lobby' && s.phase !== 'starting') throw new RoomError('bad_phase', '対戦中は設定を変更できません');
    const settings = parseSettings(input);
    if (!settings) throw new RoomError('invalid_settings', '設定の形式が正しくありません');
    s.settings = settings;
    this.cancelStart();
    this.touch(now);
  }

  setReady(seat: Seat, ready: boolean, now: number) {
    const s = this.state;
    if (seat !== 1) throw new RoomError('forbidden', '準備OKを押せるのはゲストだけです');
    if (s.phase !== 'lobby' && s.phase !== 'starting') throw new RoomError('bad_phase', '今は準備状態を変更できません');
    const guest = s.players[1]!;
    if (!ready) {
      this.cancelStart();
      return;
    }
    if (validateSettings(s.settings).errors.length > 0) {
      throw new RoomError('invalid_settings', '設定にエラーがあるため開始できません');
    }
    if (!this.connected[0]) throw new RoomError('host_away', 'ホストが接続していません');
    guest.ready = true;
    s.phase = 'starting';
    s.startAt = now + TIMING.startCountdownMs;
  }

  private cancelStart() {
    const s = this.state;
    if (s.players[1]) s.players[1].ready = false;
    if (s.phase === 'starting') {
      s.phase = 'lobby';
      s.startAt = null;
    }
  }

  // ───────── 試合 ─────────

  private startMatch(now: number) {
    const s = this.state;
    const tb = s.settings.timebankSeconds * 1_000;
    s.phase = 'playing';
    s.startAt = null;
    s.matchNumber += 1;
    for (const p of s.players) if (p) p.rematch = false;
    s.match = {
      stacks: [s.settings.startingStack, s.settings.startingStack],
      nextButton: this.deps.randomInt(2) as Seat,
      handNumber: 0,
      hand: null,
      clock: startedClock(now),
      timebankMs: [tb, tb],
      turn: null,
      pending: null,
      pause: null,
      maxLevelIndex: 0,
      finished: null,
    };
    this.outbox.clearHistory = true;
    this.emit({ type: 'matchStart' });
    this.startNextHand(s.match, now);
  }

  private gameNow(m: MatchState, now: number) {
    return clockNow(m.clock, now);
  }

  private startNextHand(m: MatchState, now: number) {
    const settings = this.state.settings;
    const levelIndex = levelIndexAt(this.gameNow(m, now), settings);
    const level = settings.levels[levelIndex];
    const button = m.nextButton;
    m.handNumber += 1;
    m.nextButton = other(button);
    m.maxLevelIndex = Math.max(m.maxLevelIndex, levelIndex);
    m.hand = startHand({
      handNumber: m.handNumber,
      levelIndex,
      sb: level.sb,
      bb: level.bb,
      ante: effectiveAnte(level, settings.anteType),
      anteType: settings.anteType,
      button,
      stacks: m.stacks,
      deck: shuffle(fullDeck(), this.deps.randomInt),
    });
    this.emit({ type: 'handStart', handNumber: m.handNumber });
    this.afterHandChange(m, null, now);
  }

  /** ハンドの状態が変わった後で、手番・演出の待ち時間・履歴を整える。 */
  private afterHandChange(m: MatchState, before: HandState | null, now: number) {
    const h = m.hand!;
    const g = this.gameNow(m, now);
    if (before && h.board.length > before.board.length) this.emit({ type: 'street', street: h.street });
    if (h.allInShowdown && !before?.allInShowdown) this.emit({ type: 'reveal' });
    m.turn = null;
    m.pending = null;
    if (h.status === 'betting') {
      m.turn = { seat: h.toAct!, baseDeadline: g + this.state.settings.actionSeconds * 1_000 };
    } else if (h.status === 'runout') {
      m.pending = { kind: 'runout', at: g + TIMING.runoutStepMs };
    } else {
      m.stacks = [h.stacks[0], h.stacks[1]];
      m.pending = {
        kind: 'nextHand',
        at: g + (h.result!.showdown ? TIMING.resultAfterShowdownMs : TIMING.resultAfterFoldMs),
      };
      this.outbox.records.push(recordFromHand(h));
      this.emit({ type: 'handEnd', winners: h.result!.winners });
    }
  }

  private requirePlaying(): MatchState {
    const s = this.state;
    if (s.phase !== 'playing' || !s.match) throw new RoomError('bad_phase', '対戦中ではありません');
    return s.match;
  }

  private turnDeadline(m: MatchState): number | null {
    if (!m.turn) return null;
    const tb = this.connected[m.turn.seat] ? m.timebankMs[m.turn.seat] : 0;
    return m.turn.baseDeadline + tb;
  }

  /** 持ち時間を超えて考えた分をタイムバンクから引く。 */
  private chargeTimebank(m: MatchState, g: number) {
    if (!m.turn) return;
    const seat = m.turn.seat;
    const used = Math.min(m.timebankMs[seat], Math.max(0, g - m.turn.baseDeadline));
    m.timebankMs[seat] -= used;
  }

  act(seat: Seat, handNumber: unknown, action: unknown, now: number) {
    this.tick(now);
    const m = this.requirePlaying();
    if (m.pause) throw new RoomError('paused', '一時停止中です');
    const h = m.hand;
    if (!h || h.handNumber !== handNumber || h.status !== 'betting' || h.toAct !== seat) {
      throw new RoomError('not_your_turn', '手番ではありません');
    }
    const parsed = parseAction(action);
    if (!parsed) throw new RoomError('invalid_action', 'アクションの形式が正しくありません');
    let next: HandState;
    try {
      next = applyAction(h, seat, parsed);
    } catch (e) {
      if (e instanceof EngineError) throw new RoomError(e.code, e.message);
      throw e;
    }
    this.chargeTimebank(m, this.gameNow(m, now));
    m.hand = next;
    this.emit({ type: 'action', entry: next.log.at(-1)! });
    this.afterHandChange(m, h, now);
    this.touch(now);
  }

  show(seat: Seat, handNumber: unknown, now: number) {
    const m = this.state.match;
    const h = m?.hand;
    if (!m || !h || h.handNumber !== handNumber || h.status !== 'complete') {
      throw new RoomError('bad_phase', '今は手札を見せられません');
    }
    if (h.result!.shown[seat] || h.allInShowdown) return;
    m.hand = revealHand(h, seat);
    this.outbox.records.push(recordFromHand(m.hand));
    this.emit({ type: 'show', seat });
    this.touch(now);
  }

  pause(seat: Seat, now: number) {
    const m = this.requirePlaying();
    if (m.pause) {
      // 再開カウントダウン中なら取り消す
      if (m.pause.resumeAt !== null) {
        m.pause = { by: seat, resumeAt: null };
        this.emit({ type: 'paused', by: seat });
      }
      return;
    }
    this.pauseMatch(m, seat, now);
  }

  private pauseMatch(m: MatchState, by: Seat | null, now: number) {
    m.clock = pauseClock(m.clock, now);
    m.pause = { by, resumeAt: null };
    this.emit({ type: 'paused', by });
  }

  resume(_seat: Seat, now: number) {
    const m = this.requirePlaying();
    if (!m.pause || m.pause.resumeAt !== null) return;
    m.pause.resumeAt = now + TIMING.resumeCountdownMs;
  }

  resign(seat: Seat, now: number) {
    const m = this.requirePlaying();
    this.finishMatch(m, other(seat), 'resign', now);
  }

  private finishMatch(m: MatchState, winner: Seat, reason: 'bust' | 'resign', now: number) {
    const s = this.state;
    m.clock = pauseClock(m.clock, now);
    m.finished = {
      winner,
      reason,
      durationMs: m.clock.accumulatedMs,
      hands: m.handNumber,
      maxLevelIndex: m.maxLevelIndex,
    };
    m.turn = null;
    m.pending = null;
    m.pause = null;
    s.phase = 'finished';
    for (const p of s.players) if (p) p.rematch = false;
    this.emit({ type: 'matchEnd', winner });
  }

  rematch(seat: Seat, now: number) {
    const s = this.state;
    if (s.phase !== 'finished') throw new RoomError('bad_phase', '試合が終わっていません');
    s.players[seat]!.rematch = true;
    if (s.players.every((p) => p?.rematch)) {
      s.phase = 'lobby';
      s.match = null;
      for (const p of s.players) {
        p!.rematch = false;
        p!.ready = false;
      }
    }
    this.touch(now);
  }

  // ───────── 時間経過 ─────────

  /** 期限の来た処理（開始・再開・時間切れ・ランアウト・次のハンド）をまとめて進める。 */
  tick(now: number) {
    const s = this.state;
    for (let guard = 0; guard < 1_000; guard++) {
      if (s.phase === 'starting' && s.startAt !== null && now >= s.startAt) {
        this.startMatch(s.startAt);
        continue;
      }
      const m = s.match;
      if (s.phase !== 'playing' || !m) return;

      if (m.pause) {
        if (m.pause.resumeAt !== null && now >= m.pause.resumeAt) {
          m.clock = resumeClock(m.clock, m.pause.resumeAt);
          m.pause = null;
          this.emit({ type: 'resumed' });
          continue;
        }
        return;
      }

      const g = this.gameNow(m, now);
      const deadline = this.turnDeadline(m);
      if (m.turn && deadline !== null && g >= deadline) {
        const h = m.hand!;
        const seat = m.turn.seat;
        this.chargeTimebank(m, deadline);
        m.hand = applyAction(h, seat, timeoutAction(h, seat), { auto: true });
        this.emit({ type: 'action', entry: m.hand.log.at(-1)! });
        this.afterHandChange(m, h, now);
        continue;
      }
      if (m.pending && g >= m.pending.at) {
        const step = m.pending;
        m.pending = null;
        if (step.kind === 'runout') {
          const h = m.hand!;
          m.hand = dealRunout(h);
          this.afterHandChange(m, h, now);
        } else if (m.stacks[0] === 0 || m.stacks[1] === 0) {
          this.finishMatch(m, m.stacks[0] === 0 ? 1 : 0, 'bust', now);
        } else {
          this.startNextHand(m, now);
        }
        continue;
      }
      return;
    }
    throw new Error('tick did not settle');
  }

  /** 次に tick を呼ぶべき実時刻。 */
  nextWakeAt(): number | null {
    const s = this.state;
    const times: number[] = [];
    if (s.phase === 'starting' && s.startAt !== null) times.push(s.startAt);
    const m = s.match;
    if (s.phase === 'playing' && m) {
      if (m.pause) {
        if (m.pause.resumeAt !== null) times.push(m.pause.resumeAt);
      } else {
        const deadline = this.turnDeadline(m);
        for (const g of [deadline, m.pending?.at ?? null]) {
          if (g === null) continue;
          const wall = gameToWall(m.clock, g);
          if (wall !== null) times.push(wall);
        }
      }
    }
    if (!this.connected[0] && !this.connected[1]) times.push(s.lastActiveAt + TIMING.roomTtlMs);
    return times.length ? Math.min(...times) : null;
  }

  isExpired(now: number): boolean {
    return !this.connected[0] && !this.connected[1] && now >= this.state.lastActiveAt + TIMING.roomTtlMs;
  }

  // ───────── 表示 ─────────

  view(viewer: Seat | null, now: number): RoomView {
    const s = this.state;
    const m = s.match;
    const deadline = m ? this.turnDeadline(m) : null;
    return {
      roomId: s.id,
      serverNow: now,
      phase: s.phase,
      you: viewer,
      players: [0, 1].map((i) => {
        const p = s.players[i];
        return p ? { name: p.name, connected: this.connected[i], ready: p.ready, rematch: p.rematch } : null;
      }) as RoomView['players'],
      settings: s.settings,
      startAt: s.startAt,
      // 観戦はできないので、参加していない人には試合の中身を送らない
      match: viewer !== null && m ? {
        matchNumber: s.matchNumber,
        stacks: m.stacks,
        handNumber: m.handNumber,
        clock: m.clock,
        timebankMs: m.timebankMs,
        turn: m.turn && deadline !== null ? { ...m.turn, deadline } : null,
        pause: m.pause,
        hand: m.hand && handView(m.hand, viewer, s.phase === 'playing' && !m.pause),
        finished: m.finished,
      } : null,
    };
  }
}

function parseAction(input: unknown): PlayerAction | null {
  if (typeof input !== 'object' || input === null) return null;
  const a = input as Record<string, unknown>;
  switch (a.type) {
    case 'fold':
    case 'check':
    case 'call':
      return { type: a.type };
    case 'raise':
      return typeof a.to === 'number' ? { type: 'raise', to: a.to } : null;
    default:
      return null;
  }
}
