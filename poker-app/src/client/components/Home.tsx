import { useState } from 'react';
import { storage } from '../storage';
import { NameForm } from './NameForm';

export function Home({ navigate }: { navigate: (path: string) => void }) {
  const [step, setStep] = useState<'top' | 'name'>('top');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(name: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const body = (await res.json()) as { roomId?: string; token?: string; message?: string };
      if (!res.ok || !body.roomId || !body.token) throw new Error(body.message ?? '部屋を作れませんでした');
      storage.setToken(body.roomId, body.token);
      navigate(`/r/${body.roomId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '部屋を作れませんでした');
      setBusy(false);
    }
  }

  return (
    <main className="page home">
      <header className="hero">
        <div className="hero-suits" aria-hidden="true">
          <span className="suit-s">♠</span>
          <span className="suit-h">♥</span>
          <span className="suit-d">♦</span>
          <span className="suit-c">♣</span>
        </div>
        <h1>ヘッズアップ・ホールデム</h1>
        <p>リンクを送るだけで、1対1のノーリミットホールデムをトーナメント形式で遊べます。</p>
      </header>
      {step === 'top' ? (
        <div className="panel">
          <button className="btn primary big" onClick={() => setStep('name')}>
            部屋を作る
          </button>
          <ul className="notes">
            <li>部屋を作ったら、表示されるリンクを相手に送ってください。</li>
            <li>ブラインドの上がり方や初期スタックは対戦前に設定できます。</li>
            <li>チップはゲーム内だけのポイントです。</li>
          </ul>
        </div>
      ) : (
        <NameForm
          title="部屋を作る"
          submitLabel="作成する"
          busy={busy}
          onSubmit={create}
          onCancel={() => setStep('top')}
        />
      )}
      {error && <p className="error-text">{error}</p>}
    </main>
  );
}
