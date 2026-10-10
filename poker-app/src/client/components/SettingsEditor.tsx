import { useEffect, useState } from 'react';
import {
  ANTE_TYPE_LABELS,
  defaultAnte,
  LIMITS,
  PRESETS,
  presetSettings,
  withAnteType,
  type AnteType,
  type BlindLevel,
  type PresetId,
  type Settings,
} from '../../engine/settings';
import { chips } from '../format';

interface Props {
  value: Settings;
  onChange?: (s: Settings) => void;
  readOnly: boolean;
}

const PRESET_IDS = Object.keys(PRESETS) as PresetId[];
const ANTE_TYPES = Object.keys(ANTE_TYPE_LABELS) as AnteType[];

function range(min: number, max: number, step: number) {
  const out: number[] = [];
  for (let v = min; v <= max; v += step) out.push(v);
  return out;
}

/** 全角数字・カンマを許容して整数を読む。空なら NaN。 */
function parseIntText(text: string): number {
  const ascii = text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[^\d]/g, '');
  return ascii === '' ? NaN : Number(ascii);
}

function NumberField({
  value,
  onChange,
  readOnly,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  readOnly: boolean;
  label: string;
}) {
  const [text, setText] = useState(Number.isFinite(value) ? String(value) : '');
  useEffect(() => {
    // プリセット選択など、外から値が変わったときに表示を合わせる
    if (parseIntText(text) !== value && !(text === '' && Number.isNaN(value))) {
      setText(Number.isFinite(value) ? String(value) : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      className="num"
      inputMode="numeric"
      aria-label={label}
      value={readOnly && Number.isFinite(value) ? chips(value) : text}
      disabled={readOnly}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        onChange(parseIntText(t));
      }}
    />
  );
}

function isPresetValues(s: Settings): boolean {
  if (s.preset === 'custom') return false;
  const p = presetSettings(s.preset, s.anteType);
  return (
    s.startingStack === p.startingStack &&
    s.levelMinutes === p.levelMinutes &&
    JSON.stringify(s.levels) === JSON.stringify(p.levels)
  );
}

export function SettingsEditor({ value: s, onChange, readOnly }: Props) {
  const update = (patch: Partial<Settings>) => onChange?.({ ...s, ...patch });
  const setLevel = (i: number, patch: Partial<BlindLevel>) =>
    update({ levels: s.levels.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const applyPreset = (id: PresetId) =>
    onChange?.({ ...presetSettings(id, s.anteType), actionSeconds: s.actionSeconds, timebankSeconds: s.timebankSeconds });

  const edited = !isPresetValues(s);
  const last = s.levels.at(-1);

  return (
    <div className="settings">
      <section>
        <h3>
          プリセット
          {edited && <span className="tag">編集済み</span>}
        </h3>
        <div className="segmented">
          {PRESET_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className={s.preset === id ? 'active' : ''}
              disabled={readOnly}
              aria-pressed={s.preset === id}
              onClick={() => applyPreset(id)}
            >
              <strong>{PRESETS[id].label}</strong>
              <small>
                {chips(PRESETS[id].startingStack)}・{PRESETS[id].levelMinutes}分
              </small>
            </button>
          ))}
        </div>
        {edited && !readOnly && s.preset !== 'custom' && (
          <button type="button" className="btn small ghost" onClick={() => applyPreset(s.preset as PresetId)}>
            {PRESETS[s.preset as PresetId].label}のプリセットに戻す
          </button>
        )}
      </section>

      <section className="grid2">
        <label className="field">
          <span>初期スタック</span>
          <NumberField
            label="初期スタック"
            value={s.startingStack}
            readOnly={readOnly}
            onChange={(v) => update({ startingStack: v })}
          />
        </label>
        <label className="field">
          <span>レベル時間（分）</span>
          <NumberField
            label="レベル時間（分）"
            value={s.levelMinutes}
            readOnly={readOnly}
            onChange={(v) => update({ levelMinutes: v })}
          />
        </label>
        <label className="field">
          <span>持ち時間</span>
          <select
            value={s.actionSeconds}
            disabled={readOnly}
            onChange={(e) => update({ actionSeconds: Number(e.target.value) })}
          >
            {range(LIMITS.actionSeconds.min, LIMITS.actionSeconds.max, LIMITS.actionSeconds.step).map((v) => (
              <option key={v} value={v}>
                {v}秒
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>タイムバンク</span>
          <select
            value={s.timebankSeconds}
            disabled={readOnly}
            onChange={(e) => update({ timebankSeconds: Number(e.target.value) })}
          >
            {range(LIMITS.timebankSeconds.min, LIMITS.timebankSeconds.max, LIMITS.timebankSeconds.step).map((v) => (
              <option key={v} value={v}>
                {v === 0 ? 'なし' : `${v}秒`}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section>
        <h3>アンテ</h3>
        <div className="segmented">
          {ANTE_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className={s.anteType === t ? 'active' : ''}
              disabled={readOnly}
              aria-pressed={s.anteType === t}
              onClick={() => onChange?.(withAnteType(s, t))}
            >
              {ANTE_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </section>

      <details className="blinds" open={!readOnly}>
        <summary>
          ブラインド表（{s.levels.length}レベル
          {last && Number.isFinite(last.bb) ? `・最終 ${chips(last.sb)}/${chips(last.bb)}` : ''}）
        </summary>
        <table>
          <thead>
            <tr>
              <th>Lv</th>
              <th>SB</th>
              <th>BB</th>
              {s.anteType !== 'none' && <th>アンテ</th>}
              <th className="muted">開始</th>
              {!readOnly && <th aria-label="削除" />}
            </tr>
          </thead>
          <tbody>
            {s.levels.map((l, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>
                  <NumberField label={`Lv.${i + 1} SB`} value={l.sb} readOnly={readOnly} onChange={(v) => setLevel(i, { sb: v })} />
                </td>
                <td>
                  <NumberField label={`Lv.${i + 1} BB`} value={l.bb} readOnly={readOnly} onChange={(v) => setLevel(i, { bb: v })} />
                </td>
                {s.anteType !== 'none' && (
                  <td>
                    <NumberField
                      label={`Lv.${i + 1} アンテ`}
                      value={l.ante}
                      readOnly={readOnly}
                      onChange={(v) => setLevel(i, { ante: v })}
                    />
                  </td>
                )}
                <td className="muted">{Number.isFinite(s.levelMinutes) ? `${i * s.levelMinutes}分` : '-'}</td>
                {!readOnly && (
                  <td>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Lv.${i + 1} を削除`}
                      disabled={s.levels.length <= LIMITS.levels.min}
                      onClick={() => update({ levels: s.levels.filter((_, j) => j !== i) })}
                    >
                      ×
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!readOnly && (
          <button
            type="button"
            className="btn small"
            disabled={s.levels.length >= LIMITS.levels.max}
            onClick={() => {
              const sb = Number.isFinite(last?.sb) ? last!.sb * 2 : 50;
              const bb = Number.isFinite(last?.bb) ? last!.bb * 2 : 100;
              update({ levels: [...s.levels, { sb, bb, ante: defaultAnte(bb, s.anteType) }] });
            }}
          >
            ＋ レベルを追加
          </button>
        )}
      </details>
    </div>
  );
}
