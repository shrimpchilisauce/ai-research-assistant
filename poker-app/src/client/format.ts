import type { LogEntry, Street } from '../engine/hand';

export const chips = (n: number) => n.toLocaleString('ja-JP');

export const STREET_NAMES: Record<Street, string> = {
  preflop: 'プリフロップ',
  flop: 'フロップ',
  turn: 'ターン',
  river: 'リバー',
};

export function describeAction(e: LogEntry): string {
  const amount = e.to ?? e.amount;
  let text: string;
  switch (e.type) {
    case 'sb':
      text = `SB ${chips(e.amount)}`;
      break;
    case 'bb':
      text = `BB ${chips(e.amount)}`;
      break;
    case 'ante':
      text = `アンテ ${chips(e.amount)}`;
      break;
    case 'fold':
      text = 'フォールド';
      break;
    case 'check':
      text = 'チェック';
      break;
    case 'call':
      text = `コール ${chips(e.amount)}`;
      break;
    case 'bet':
      text = `ベット ${chips(amount)}`;
      break;
    case 'raise':
      text = `レイズ ${chips(amount)}`;
      break;
  }
  if (e.allIn) text += '（オールイン）';
  if (e.auto) text += '（時間切れ）';
  return text;
}

/** mm:ss（負の値は 0 として扱う）。 */
export function clockText(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1_000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function durationText(ms: number): string {
  if (ms < 60_000) return '1分未満';
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}時間${m}分` : `${m}分`;
}
