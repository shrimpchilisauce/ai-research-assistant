import { useState } from 'react';
import { NAME_MAX_LENGTH, normalizeName } from '../../shared/protocol';
import { storage } from '../storage';

interface Props {
  title: string;
  submitLabel: string;
  busy?: boolean;
  onSubmit: (name: string) => void;
  onCancel?: () => void;
}

export function NameForm({ title, submitLabel, busy, onSubmit, onCancel }: Props) {
  const [name, setName] = useState(storage.name);
  const valid = normalizeName(name) !== null;

  return (
    <form
      className="panel name-form"
      onSubmit={(e) => {
        e.preventDefault();
        const n = normalizeName(name);
        if (!n || busy) return;
        storage.setName(n);
        onSubmit(n);
      }}
    >
      <h2>{title}</h2>
      <label className="field">
        <span>ニックネーム（{NAME_MAX_LENGTH}文字まで）</span>
        <input
          autoFocus
          value={name}
          maxLength={NAME_MAX_LENGTH * 2}
          onChange={(e) => setName(e.target.value)}
          placeholder="例：たろう"
          autoComplete="nickname"
        />
      </label>
      <div className="row">
        {onCancel && (
          <button type="button" className="btn ghost" onClick={onCancel}>
            戻る
          </button>
        )}
        <button type="submit" className="btn primary grow" disabled={!valid || busy}>
          {busy ? '処理中…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
