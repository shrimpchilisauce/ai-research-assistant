// 公開中（またはローカル）のアプリに2つの WebSocket クライアントでつなぎ、
// 部屋作成 → 参加 → 対戦 → 一時停止 → 履歴 → 再接続 → 投了 → リマッチ までを確認する。
// 使い方: node scripts/smoke.mjs https://headsup-poker.example.workers.dev
const BASE = (process.argv[2] ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const WS_BASE = BASE.replace(/^http/, 'ws');

function check(cond, message) {
  if (!cond) throw new Error(`NG: ${message}`);
  console.log(`OK: ${message}`);
}

const res = await fetch(`${BASE}/api/rooms`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: '動作確認' }),
});
const created = await res.json();
check(res.ok && created.roomId && created.token, '部屋を作成できる');

function client(token) {
  const ws = new WebSocket(`${WS_BASE}/api/rooms/${created.roomId}/ws`);
  const c = { ws, view: null, seat: null, token, msgs: [], waiters: [] };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token }));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    c.msgs.push(m);
    if (m.t === 'welcome') {
      c.seat = m.seat;
      if (m.token) c.token = m.token;
    }
    if (m.t === 'state') c.view = m.view;
    if (m.t === 'error') console.log('  (server error)', m.code, m.message);
    for (const w of c.waiters.splice(0)) w();
  };
  c.send = (m) => ws.send(JSON.stringify(m));
  return c;
}

async function until(c, pred, label, ms = 10_000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`NG: timeout waiting for ${label}`);
    await Promise.race([new Promise((r) => c.waiters.push(r)), new Promise((r) => setTimeout(r, 200))]);
  }
}

const host = client(created.token);
await until(host, () => host.view, 'host view');
check(host.seat === 0 && host.view.phase === 'lobby', 'ホストとしてロビーに入れる');

const guest = client(undefined);
await until(guest, () => guest.msgs.some((m) => m.t === 'welcome'), 'guest welcome');
guest.send({ t: 'join', name: 'ゲスト' });
await until(guest, () => guest.seat === 1 && guest.view, 'guest join');
check(true, 'ゲストとして参加できる');

const third = client(undefined);
await until(third, () => third.msgs.some((m) => m.t === 'welcome'), 'third welcome');
check(third.msgs.find((m) => m.t === 'welcome').canJoin === false, '3人目は満席になる');
third.ws.close();

guest.send({ t: 'ready', ready: true });
await until(host, () => host.view.phase === 'playing', 'match start');
check(true, '準備OKで対戦が始まる');

for (let i = 0; i < 2; i++) {
  const hand = host.view.match.hand;
  const actor = hand.toAct === host.seat ? host : guest;
  await until(actor, () => actor.view.match.hand.legal, 'legal actions');
  actor.send({ t: 'act', handNumber: hand.handNumber, action: { type: 'fold' } });
  await until(host, () => host.view.match.handNumber === hand.handNumber + 1, 'next hand');
}
check(host.view.match.stacks[0] + host.view.match.stacks[1] === 20_000, 'ハンドが進み、チップの合計が変わらない');

const hv = host.view.match.hand;
check(hv.hole[host.seat]?.length === 2 && hv.hole[guest.seat] === null, '相手の手札は送られてこない');

host.send({ t: 'pause' });
await until(guest, () => guest.view.match.pause, 'pause');
guest.send({ t: 'resume' });
await until(host, () => !host.view.match.pause, 'resume');
check(true, '一時停止と再開ができる');

guest.send({ t: 'history' });
await until(guest, () => guest.msgs.some((m) => m.t === 'history'), 'history');
check(guest.msgs.find((m) => m.t === 'history').hands.length === 2, 'ハンド履歴を取得できる');

guest.ws.close();
await until(host, () => !host.view.players[1].connected, 'disconnect');
const guest2 = client(guest.token);
await until(guest2, () => guest2.view, 'reconnect');
check(guest2.seat === 1, '同じトークンで同じ席に戻れる');

host.send({ t: 'resign' });
await until(host, () => host.view.phase === 'finished', 'finish');
host.send({ t: 'rematch' });
guest2.send({ t: 'rematch' });
await until(host, () => host.view.phase === 'lobby', 'rematch');
check(true, '投了とリマッチができる');

host.ws.close();
guest2.ws.close();
console.log('すべて OK');
process.exit(0);
