import type { Card as CardCode } from '../../engine/cards';

// U+FE0E で絵文字ではなく文字として表示させる
const SUIT_SYMBOL: Record<string, string> = { s: '♠\uFE0E', h: '♥\uFE0E', d: '♦\uFE0E', c: '♣\uFE0E' };
const SUIT_NAME: Record<string, string> = { s: 'スペード', h: 'ハート', d: 'ダイヤ', c: 'クラブ' };

export function rankLabel(code: CardCode) {
  return code[0] === 'T' ? '10' : code[0];
}

export function cardLabel(code: CardCode) {
  return `${SUIT_NAME[code[1]]}の${rankLabel(code)}`;
}

interface Props {
  code?: CardCode | null;
  size?: 'sm' | 'md' | 'lg';
  /** 役を構成するカードを強調する。 */
  highlight?: boolean;
  dim?: boolean;
}

/** 4色デッキ：♠黒・♥赤・♦青・♣緑。code が無ければ裏面。 */
export function Card({ code, size = 'md', highlight, dim }: Props) {
  if (!code) return <span className={`card back ${size}`} aria-label="伏せたカード" />;
  const classes = ['card', size, `suit-${code[1]}`, highlight ? 'highlight' : '', dim ? 'dim' : ''];
  return (
    <span className={classes.join(' ')} aria-label={cardLabel(code)}>
      <span className="rank">{rankLabel(code)}</span>
      <span className="suit">{SUIT_SYMBOL[code[1]]}</span>
    </span>
  );
}

export function EmptyCard({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`card empty ${size}`} aria-hidden="true" />;
}
