import { beforeEach, describe, expect, it } from 'vitest';
import { other, type Seat } from '../../engine/hand';
import { defaultSettings } from '../../engine/settings';
import { RoomCore, RoomError, TIMING } from '../room';

let now = 1_000_000;
let tokenSeq = 0;

function seeded(seed: number) {
  return (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed % n;
  };
}

function deps(seed = 42) {
  return { randomInt: seeded(seed), newToken: () => `token-${++tokenSeq}` };
}

function lobby(seed?: number) {
  const { core, token } = RoomCore.create('room1', 'ホスト', now, deps(seed));
  core.setConnected(0, true, now);
  const guest = core.join('ゲスト', now);
  core.setConnected(1, true, now);
  return { core, hostToken: token, guestToken: guest.token };
}

function advance(core: RoomCore, ms: number) {
  now += ms;
  core.tick(now);
}

function started(seed?: number, tweak?: (core: RoomCore) => void) {
  const r = lobby(seed);
  tweak?.(r.core);
  r.core.setReady(1, true, now);
  advance(r.core, TIMING.startCountdownMs);
  r.core.takeOutbox();
  return r;
}

const m = (core: RoomCore) => core.state.match!;
const h = (core: RoomCore) => m(core).hand!;
const toAct = (core: RoomCore) => h(core).toAct as Seat;
const act = (core: RoomCore, action: object, seat = toAct(core)) =>
  core.act(seat, h(core).handNumber, action, now);

beforeEach(() => {
  now = 1_000_000;
});

describe('lobby', () => {
  it('starts the match three seconds after the guest is ready', () => {
    const { core } = lobby();
    core.setReady(1, true, now);
    expect(core.state.phase).toBe('starting');
    advance(core, TIMING.startCountdownMs - 1);
    expect(core.state.phase).toBe('starting');
    advance(core, 1);
    expect(core.state.phase).toBe('playing');
    expect(m(core).handNumber).toBe(1);
    expect(m(core).turn?.seat).toBe(h(core).toAct);
    expect(core.takeOutbox().clearHistory).toBe(true);
  });

  it('lets only the host change settings and cancels readiness on change', () => {
    const { core } = lobby();
    const s = { ...defaultSettings(), startingStack: 5_000 };
    expect(() => core.updateSettings(1, s, now)).toThrow(RoomError);
    core.setReady(1, true, now);
    core.updateSettings(0, s, now);
    expect(core.state.phase).toBe('lobby');
    expect(core.state.players[1]!.ready).toBe(false);
    expect(core.state.settings.startingStack).toBe(5_000);
    expect(() => core.updateSettings(0, { bogus: true }, now)).toThrow(/形式/);
  });

  it('refuses to start with invalid settings or an absent host', () => {
    const { core } = lobby();
    core.updateSettings(0, { ...defaultSettings(), startingStack: 1 }, now);
    expect(() => core.setReady(1, true, now)).toThrow(/エラー/);
    core.updateSettings(0, defaultSettings(), now);
    core.setConnected(0, false, now);
    expect(() => core.setReady(1, true, now)).toThrow(/ホスト/);
  });

  it('cancels the countdown when someone disconnects', () => {
    const { core } = lobby();
    core.setReady(1, true, now);
    core.setConnected(0, false, now);
    expect(core.state.phase).toBe('lobby');
    advance(core, TIMING.startCountdownMs);
    expect(core.state.phase).toBe('lobby');
  });

  it('is full while the guest is connected but lets a new guest replace a disconnected one', () => {
    const { core, guestToken } = lobby();
    expect(() => core.join('三人目', now)).toThrow(/満席/);
    core.setConnected(1, false, now);
    const replaced = core.join('新ゲスト', now);
    expect(replaced.seat).toBe(1);
    expect(core.seatForToken(guestToken)).toBeNull();
    expect(core.seatForToken(replaced.token)).toBe(1);
    expect(core.state.players[1]!.name).toBe('新ゲスト');
  });

  it('validates nicknames', () => {
    expect(() => RoomCore.create('r', '   ', now, deps())).toThrow(RoomError);
    expect(() => RoomCore.create('r', 'あ'.repeat(13), now, deps())).toThrow(RoomError);
    expect(RoomCore.create('r', ' あ'.repeat(6), now, deps()).core.state.players[0]!.name).toHaveLength(11);
  });
});

describe('views', () => {
  it('never reveals the opponent hole cards, the deck or tokens', () => {
    const { core, hostToken, guestToken } = started();
    for (const seat of [0, 1] as Seat[]) {
      const view = core.view(seat, now);
      const json = JSON.stringify(view);
      const opp = h(core).hole[other(seat)];
      expect(view.match!.hand!.hole[seat]).toEqual(h(core).hole[seat]);
      expect(view.match!.hand!.hole[other(seat)]).toBeNull();
      for (const c of opp) expect(json).not.toContain(`"${c}"`);
      expect(json).not.toContain('deck');
      expect(json).not.toContain(hostToken);
      expect(json).not.toContain(guestToken);
    }
  });

  it('includes legal actions only for the player to act', () => {
    const { core } = started();
    const seat = toAct(core);
    expect(core.view(seat, now).match!.hand!.legal).not.toBeNull();
    expect(core.view(other(seat), now).match!.hand!.legal).toBeNull();
  });
});

describe('hand flow', () => {
  it('records a folded hand and deals the next one with the button moved', () => {
    const { core } = started();
    const button = h(core).button;
    act(core, { type: 'fold' });
    const out = core.takeOutbox();
    expect(out.records).toHaveLength(1);
    expect(out.events.map((e) => e.type)).toEqual(['action', 'handEnd']);
    expect(m(core).stacks[0] + m(core).stacks[1]).toBe(20_000);
    advance(core, TIMING.resultAfterFoldMs - 1);
    expect(m(core).handNumber).toBe(1);
    advance(core, 1);
    expect(m(core).handNumber).toBe(2);
    expect(h(core).button).toBe(other(button));
  });

  it('rejects stale or out-of-turn actions', () => {
    const { core } = started();
    const seat = toAct(core);
    expect(() => core.act(other(seat), 1, { type: 'call' }, now)).toThrow(/手番/);
    expect(() => core.act(seat, 99, { type: 'call' }, now)).toThrow(/手番/);
    expect(() => core.act(seat, 1, { type: 'raise', to: 1 }, now)).toThrow(RoomError);
    expect(() => core.act(seat, 1, { type: 'dance' }, now)).toThrow(/形式/);
  });

  it('runs out the board step by step after an all-in and reveals both hands', () => {
    const { core } = started();
    const seat = toAct(core);
    act(core, { type: 'raise', to: 10_000 });
    act(core, { type: 'call' });
    expect(h(core).status).toBe('runout');
    expect(core.takeOutbox().events.map((e) => e.type)).toEqual(['action', 'action', 'reveal']);
    expect(core.view(seat, now).match!.hand!.hole[other(seat)]).toEqual(h(core).hole[other(seat)]);
    advance(core, TIMING.runoutStepMs);
    expect(h(core).board).toHaveLength(3);
    advance(core, TIMING.runoutStepMs);
    expect(h(core).board).toHaveLength(4);
    advance(core, TIMING.runoutStepMs);
    expect(h(core).status).toBe('complete');
  });

  it('lets a player show their cards after winning by fold', () => {
    const { core } = started();
    const raiser = toAct(core);
    act(core, { type: 'raise', to: 300 });
    act(core, { type: 'fold' });
    core.takeOutbox();
    expect(core.view(other(raiser), now).match!.hand!.hole[raiser]).toBeNull();
    core.show(raiser, 1, now);
    expect(core.view(other(raiser), now).match!.hand!.hole[raiser]).toEqual(h(core).hole[raiser]);
    expect(core.takeOutbox().records[0].result.shown[raiser]).toBe(true);
    advance(core, TIMING.resultAfterFoldMs);
    expect(() => core.show(raiser, 1, now)).toThrow(RoomError);
  });

  it('uses the blinds of the level reached when each hand starts', () => {
    const { core } = started(42, (c) => c.updateSettings(0, { ...defaultSettings(), levelMinutes: 1 }, now));
    expect(h(core).bb).toBe(100);
    advance(core, 59_000);
    act(core, { type: 'fold' });
    advance(core, TIMING.resultAfterFoldMs);
    expect(h(core).bb).toBe(150);
    expect(h(core).levelIndex).toBe(1);
  });
});

describe('action timer', () => {
  it('uses the timebank after the action time and then auto-folds', () => {
    const { core } = started();
    const seat = toAct(core);
    advance(core, 30_000 + 60_000 - 1);
    expect(m(core).hand!.log.at(-1)!.type).not.toBe('fold');
    advance(core, 1);
    expect(h(core).log.at(-1)).toMatchObject({ type: 'fold', seat, auto: true });
    expect(m(core).timebankMs[seat]).toBe(0);
  });

  it('charges only the time used beyond the action time', () => {
    const { core } = started();
    const seat = toAct(core);
    advance(core, 40_000);
    act(core, { type: 'call' });
    expect(m(core).timebankMs[seat]).toBe(50_000);
    expect(m(core).timebankMs[other(seat)]).toBe(60_000);
  });

  it('auto-checks when checking is possible', () => {
    const { core } = started();
    act(core, { type: 'call' });
    const bb = toAct(core);
    advance(core, 90_000);
    expect(h(core).log.at(-1)).toMatchObject({ type: 'check', seat: bb, auto: true });
  });

  it('does not wait for the timebank of a disconnected player', () => {
    const { core } = started();
    const seat = toAct(core);
    core.setConnected(seat, false, now);
    advance(core, 30_000);
    expect(h(core).log.at(-1)).toMatchObject({ type: 'fold', seat, auto: true });
    expect(m(core).timebankMs[seat]).toBe(60_000);
  });

  it('reports the wall-clock time of the next deadline', () => {
    const { core } = started();
    expect(core.nextWakeAt()).toBe(now + 90_000);
  });
});

describe('pause', () => {
  it('freezes the clock and the action timer until resumed', () => {
    const { core } = started();
    advance(core, 10_000);
    core.pause(0, now);
    expect(core.nextWakeAt()).toBeNull();
    expect(() => act(core, { type: 'call' })).toThrow(/一時停止/);
    advance(core, 600_000);
    expect(h(core).log.some((e) => e.auto)).toBe(false);
    core.resume(1, now);
    advance(core, TIMING.resumeCountdownMs - 1);
    expect(m(core).pause).not.toBeNull();
    advance(core, 1);
    expect(m(core).pause).toBeNull();
    // 一時停止前に 10 秒使っているので、残りは持ち時間 20 秒 + タイムバンク 60 秒
    expect(core.nextWakeAt()).toBe(now + 80_000);
    const g = m(core).clock.accumulatedMs;
    expect(g).toBe(10_000);
  });

  it('cancels a pending resume when paused again', () => {
    const { core } = started();
    core.pause(0, now);
    core.resume(0, now);
    core.pause(1, now);
    advance(core, TIMING.resumeCountdownMs);
    expect(m(core).pause).toEqual({ by: 1, resumeAt: null });
  });

  it('pauses automatically when both players disconnect', () => {
    const { core } = started();
    core.setConnected(0, false, now);
    expect(m(core).pause).toBeNull();
    core.setConnected(1, false, now);
    expect(m(core).pause).toEqual({ by: null, resumeAt: null });
    expect(core.nextWakeAt()).toBe(now + TIMING.roomTtlMs);
  });
});

describe('end of match', () => {
  function bust(core: RoomCore) {
    for (let i = 0; i < 50 && core.state.phase === 'playing'; i++) {
      act(core, { type: 'raise', to: h(core).streetBets[toAct(core)] + h(core).stacks[toAct(core)] });
      act(core, { type: 'call' });
      for (let j = 0; j < 4 && h(core).status !== 'complete'; j++) advance(core, TIMING.runoutStepMs);
      advance(core, TIMING.resultAfterShowdownMs);
    }
  }

  it('ends when a player busts and returns to the lobby after both ask for a rematch', () => {
    const { core } = started(7);
    bust(core);
    expect(core.state.phase).toBe('finished');
    const f = m(core).finished!;
    expect(m(core).stacks[f.winner]).toBe(20_000);
    expect(f.reason).toBe('bust');
    core.rematch(0, now);
    expect(core.state.phase).toBe('finished');
    core.rematch(1, now);
    expect(core.state.phase).toBe('lobby');
    expect(core.state.players[1]!.ready).toBe(false);
    core.setReady(1, true, now);
    advance(core, TIMING.startCountdownMs);
    expect(core.state.matchNumber).toBe(2);
    expect(m(core).stacks).toEqual([10_000, 10_000]);
  });

  it('ends immediately on resignation', () => {
    const { core } = started();
    core.resign(1, now);
    expect(core.state.phase).toBe('finished');
    expect(m(core).finished).toMatchObject({ winner: 0, reason: 'resign', hands: 1 });
    expect(core.nextWakeAt()).toBeNull();
  });
});

describe('room expiry', () => {
  it('expires a day after everyone has left', () => {
    const { core } = lobby();
    core.setConnected(0, false, now);
    core.setConnected(1, false, now);
    expect(core.isExpired(now + TIMING.roomTtlMs - 1)).toBe(false);
    expect(core.isExpired(now + TIMING.roomTtlMs)).toBe(true);
  });
});
