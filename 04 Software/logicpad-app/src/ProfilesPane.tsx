import { useEffect, useState } from "react";
import { LEDS, LIGHT_MODES, type PadKey, type ProfileHdr, type Snapshot, type SwitchRule } from "./types";
import { TITLE_MAX } from "./text";
import "./ProfilesPane.css";

const LED_HEX = ["#2a2e38", "#e8e4d8", "#c04040", "#40a060", "#3a7ec0"];
export const SLEEP_LABELS = ["Never", "15s", "30s", "1m", "5m"] as const;

type Props = {
  snap: Snapshot;
  hdr: ProfileHdr | undefined;
  keys: PadKey[];
  bound: SwitchRule[];
  busy: boolean;
  memHint: string;
  onActivate: (index: number) => void;
  onAdd: () => void;
  onDuplicate: () => void;
  onReset: () => void;
  onDelete: () => void;
  onDraftName: (name: string) => void;
  onHdr: (hdr: ProfileHdr) => void;
  onKeyLed: (key: PadKey, led: number) => void;
  onFillLeds: (led: number) => void;
  onCopyLights: (fromIndex: number) => void;
  onScreen: (next: { contrast: number; flip: number; sleep: number }) => void;
  onRemoveSwitch: (exe: string) => void;
  onOpenSwitch: () => void;
};

function MiniLeds({ keys }: { keys: PadKey[] }) {
  return (
    <span className="prof-mini-leds" aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => {
        const led = keys[i]?.led ?? 0;
        return <i key={i} style={{ background: LED_HEX[led] ?? LED_HEX[0] }} />;
      })}
    </span>
  );
}

export function ProfilesPane({
  snap,
  hdr,
  keys,
  bound,
  busy,
  memHint,
  onActivate,
  onAdd,
  onDuplicate,
  onReset,
  onDelete,
  onDraftName,
  onHdr,
  onKeyLed,
  onFillLeds,
  onCopyLights,
  onScreen,
  onRemoveSwitch,
  onOpenSwitch,
}: Props) {
  const profile = snap.meta.active;
  const canMutate = snap.canMutateProfiles ?? false;
  const canAdd = snap.canAddProfiles ?? snap.profiles.length < 4;
  const canScreen = snap.canSetScreen ?? false;
  const [paintLed, setPaintLed] = useState(1);
  const [copyFrom, setCopyFrom] = useState("");

  useEffect(() => {
    const first = keys.find((k) => k.led > 0)?.led;
    if (first != null) setPaintLed(first);
    // Intentionally only when the active profile changes, not on every LED paint.
  }, [profile]); // eslint-disable-line react-hooks/exhaustive-deps -- keys follow profile

  function cycleLed(k: PadKey) {
    const next = (k.led + 1) % LEDS.length;
    setPaintLed(next);
    onKeyLed(k, next);
  }

  return (
    <div className="pane-profiles">
      <section className="pad">
        <h2>Profiles</h2>
        <p className="hint">{memHint}</p>
        <div className="prof-cards">
          {snap.profiles.map((p) => (
            <button
              key={p.index}
              type="button"
              className={`prof-card${p.index === profile ? " on" : ""}`}
              disabled={busy}
              onClick={() => onActivate(p.index)}
            >
              <span className="prof-card-text">
                <strong>
                  {p.name || `P${p.index + 1}`}
                  {p.index === profile ? " *" : ""}
                </strong>
                <em>{LIGHT_MODES[p.lightMode] ?? "Off"}</em>
              </span>
              <MiniLeds keys={snap.keys[p.index] ?? []} />
            </button>
          ))}
        </div>
        {canMutate ? (
          <div className="add prof-actions">
            <button type="button" disabled={busy || !canAdd} onClick={onAdd}>
              New
            </button>
            <button type="button" disabled={busy || !canAdd} onClick={onDuplicate}>
              Duplicate
            </button>
            <button type="button" disabled={busy || !hdr} onClick={onReset}>
              Reset
            </button>
            <button
              type="button"
              className="danger"
              disabled={busy || snap.profiles.length <= 1}
              onClick={onDelete}
            >
              Delete
            </button>
          </div>
        ) : (
          <p className="hint">Update firmware to add or delete profiles.</p>
        )}
      </section>

      <section className="edit">
        <h2>This profile</h2>
        {hdr ? (
          <>
            <label>
              Name
              <input
                maxLength={TITLE_MAX}
                value={hdr.name}
                disabled={busy}
                onChange={(e) => onDraftName(e.target.value)}
                onBlur={() => onHdr(hdr)}
              />
            </label>
            <h3>Lights</h3>
            <div className="mode-tiles">
              {LIGHT_MODES.map((n, i) => (
                <button
                  key={n}
                  type="button"
                  className={hdr.lightMode === i ? "on" : ""}
                  disabled={busy}
                  onClick={() => onHdr({ ...hdr, lightMode: i })}
                >
                  {n}
                </button>
              ))}
            </div>
            <label>
              Bright {hdr.bright}
              <input
                type="range"
                min={0}
                max={10}
                value={hdr.bright}
                disabled={busy}
                onChange={(e) => onHdr({ ...hdr, bright: Number(e.target.value) })}
              />
            </label>
            <label>
              Dim {hdr.dim}
              <input
                type="range"
                min={0}
                max={10}
                value={hdr.dim}
                disabled={busy}
                onChange={(e) => onHdr({ ...hdr, dim: Number(e.target.value) })}
              />
            </label>
            <h3>Key LEDs</h3>
            <div className="light-grid">
              {Array.from({ length: 9 }, (_, i) => {
                const k = keys[i];
                const led = k?.led ?? 0;
                return (
                  <button
                    key={i}
                    type="button"
                    className="light-cell"
                    disabled={busy || !k}
                    style={{ background: LED_HEX[led] ?? LED_HEX[0] }}
                    title={`${k?.label || `Key ${i + 1}`} — ${LEDS[led] ?? "Off"}`}
                    onClick={() => k && cycleLed(k)}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
            <div className="led-helpers">
              <span className="hint">Fill color</span>
              <div className="led-palette">
                {LEDS.map((n, i) => (
                  <button
                    key={n}
                    type="button"
                    className={`light-cell swatch${paintLed === i ? " on" : ""}`}
                    style={{ background: LED_HEX[i] }}
                    title={n}
                    disabled={busy}
                    onClick={() => setPaintLed(i)}
                  />
                ))}
              </div>
              <button type="button" disabled={busy} onClick={() => onFillLeds(paintLed)}>
                Fill all 9
              </button>
              <label className="copy-lights">
                Copy lights from
                <select
                  value={copyFrom}
                  disabled={busy || snap.profiles.length < 2}
                  onChange={(e) => {
                    const v = e.target.value;
                    setCopyFrom("");
                    if (v !== "") onCopyLights(Number(v));
                  }}
                >
                  <option value="">Choose…</option>
                  {snap.profiles
                    .filter((p) => p.index !== profile)
                    .map((p) => (
                      <option key={p.index} value={p.index}>
                        {p.name || `P${p.index + 1}`}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <p className="hint">Per-key LEDs also live on each key in Keys.</p>
            <h3>This profile in Auto-switch</h3>
            {bound.length ? (
              <ul className="switch-list">
                {bound.map((r) => (
                  <li key={r.exe}>
                    <span title={r.exe}>{r.exe}</span>
                    <button type="button" disabled={busy} onClick={() => onRemoveSwitch(r.exe)}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">No programs for this profile in the graph.</p>
            )}
            <div className="add">
              <button type="button" onClick={onOpenSwitch}>
                Open Auto-switch
              </button>
            </div>
          </>
        ) : (
          <p className="hint">Select a profile.</p>
        )}
      </section>

      <section className="pad-screen">
        <div>
          <h2>This pad</h2>
          <p className="hint">OLED Screen — not per profile. Same as Setup → Screen on the pad.</p>
        </div>
        {canScreen ? (
          <div className="pad-screen-controls">
            <label>
              Contrast {snap.meta.contrast}
              <input
                type="range"
                min={0}
                max={10}
                value={snap.meta.contrast}
                disabled={busy}
                onChange={(e) =>
                  onScreen({
                    contrast: Number(e.target.value),
                    flip: snap.meta.flip,
                    sleep: snap.meta.sleep,
                  })
                }
              />
            </label>
            <label className="flip-row">
              <span>Flip 180°</span>
              <input
                type="checkbox"
                checked={snap.meta.flip !== 0}
                disabled={busy}
                onChange={(e) =>
                  onScreen({
                    contrast: snap.meta.contrast,
                    flip: e.target.checked ? 1 : 0,
                    sleep: snap.meta.sleep,
                  })
                }
              />
            </label>
            <label>
              Sleep
              <select
                value={snap.meta.sleep}
                disabled={busy}
                onChange={(e) =>
                  onScreen({
                    contrast: snap.meta.contrast,
                    flip: snap.meta.flip,
                    sleep: Number(e.target.value),
                  })
                }
              >
                {SLEEP_LABELS.map((n, i) => (
                  <option key={n} value={i}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <p className="hint">Update firmware to set contrast, flip, and sleep from this app.</p>
        )}
      </section>
    </div>
  );
}
