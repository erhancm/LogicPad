import { useEffect, useRef, useState } from "react";
import { LEDS, LIGHT_MODES, type PadKey, type ProfileHdr, type Snapshot, type SwitchRule } from "./types";
import { cssLedId, pixOf, type LedFrame } from "./leds";
import { useLedPreview } from "./ledPreview";
import { TITLE_MAX } from "./text";
import {
  CLOCK_ANIMS,
  CLOCK_SPEEDS,
  DEFAULT_CLOCK_STYLE,
  migrateClockStyle,
  packClockStyle,
  unpackClockStyle,
} from "./clockAnim";
import { ClockPreview, usePadClockPreview } from "./ClockPreview";
import "./ProfilesPane.css";

export const SLEEP_LABELS = ["Never", "15s", "30s", "1m", "5m"] as const;

type Props = {
  snap: Snapshot;
  hdr: ProfileHdr | undefined;
  keys: PadKey[];
  bound: SwitchRule[];
  busy: boolean;
  simulated: boolean;
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
  onScreen: (next: {
    contrast: number;
    flip: number;
    sleep: number;
    clockStyle: number;
  }) => void;
  onRemoveSwitch: (exe: string) => void;
  onOpenSwitch: () => void;
};

function MiniLeds({ keys, live }: { keys: PadKey[]; live?: LedFrame | null }) {
  const pix = [9, -1, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8];
  return (
    <span className="prof-mini-leds" aria-hidden="true">
      {pix.map((idx, i) => {
        if (idx < 0) return <i key={i} className="skip" />;
        const fallback = keys[idx === 9 ? 0 : idx]?.led ?? 0;
        const { background } = pixOf(live, idx, fallback);
        return <i key={i} style={{ background }} />;
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
  simulated,
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
  const canClockStyle = snap.canSetClockStyle ?? false;
  const clockPacked = migrateClockStyle(snap.meta.clockStyle ?? DEFAULT_CLOCK_STYLE);
  const clockStyle = unpackClockStyle(clockPacked);
  const [paintLed, setPaintLed] = useState(1);
  const [copyFrom, setCopyFrom] = useState("");
  const [clockHover, setClockHover] = useState(false);
  const clockSectionRef = useRef<HTMLElement>(null);
  const canPreviewPad = (snap.canPreviewClock ?? false) && !simulated && !busy;
  usePadClockPreview(canPreviewPad, clockHover, clockSectionRef, setClockHover);
  const live = useLedPreview({
    simulated,
    canGetLeds: snap.canGetLeds ?? false,
    hdr,
    keys,
  });

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

  function pushScreen(patch: Partial<{ contrast: number; flip: number; sleep: number; clockStyle: number }>) {
    onScreen({
      contrast: patch.contrast ?? snap.meta.contrast,
      flip: patch.flip ?? snap.meta.flip,
      sleep: patch.sleep ?? snap.meta.sleep,
      clockStyle: patch.clockStyle ?? clockPacked,
    });
  }

  function setClockStyle(next: { anim?: number; speed?: number; bar?: number }) {
    pushScreen({
      clockStyle: packClockStyle(
        next.anim ?? clockStyle.anim,
        next.speed ?? clockStyle.speed,
        next.bar ?? clockStyle.bar,
      ),
    });
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
              <MiniLeds
                keys={snap.keys[p.index] ?? []}
                live={p.index === profile ? live : null}
              />
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
            <div className="light-grid pad-leds">
              {(() => {
                const k0 = keys[0];
                const sel = pixOf(live, 9, k0?.led ?? 0);
                return (
                  <button
                    type="button"
                    className="light-cell sel"
                    disabled={busy || !k0}
                    style={sel}
                    title="Select — follows key 1 in Solid"
                    onClick={() => k0 && cycleLed(k0)}
                  >
                    SEL
                  </button>
                );
              })()}
              <span className="light-skip" />
              <span className="light-skip" />
              {Array.from({ length: 9 }, (_, i) => {
                const k = keys[i];
                const led = k?.led ?? 0;
                const pix = pixOf(live, i, led);
                return (
                  <button
                    key={i}
                    type="button"
                    className="light-cell"
                    disabled={busy || !k}
                    style={pix}
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
                    style={{ background: cssLedId(i), color: "#e8e4d8" }}
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
            <p className="hint">
              SEL sits above key 1 and follows it in Solid. These cells match the pad lights
              {simulated
                ? " (same engine as firmware)."
                : snap.canGetLeds
                  ? " (live from the pad)."
                  : " — update firmware for a live match."}{" "}
              Per-key colors also live on each key in Keys.
            </p>
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
        <h2>This pad — screen</h2>
        <p className="hint">OLED contrast, flip, and sleep. Not per profile.</p>
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
                onChange={(e) => pushScreen({ contrast: Number(e.target.value) })}
              />
            </label>
            <label className="flip-field">
              Flip
              <button
                type="button"
                className={`flip-btn${snap.meta.flip ? " on" : ""}`}
                disabled={busy}
                aria-pressed={snap.meta.flip !== 0}
                onClick={() => pushScreen({ flip: snap.meta.flip ? 0 : 1 })}
              >
                180°
              </button>
            </label>
            <label>
              Sleep
              <select
                value={snap.meta.sleep}
                disabled={busy}
                onChange={(e) => pushScreen({ sleep: Number(e.target.value) })}
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

      <section
        ref={clockSectionRef}
        className="pad-clock"
        onPointerEnter={() => setClockHover(true)}
        onPointerLeave={() => setClockHover(false)}
      >
        <div className="pad-clock-head">
          <div>
            <h2>Standby clock</h2>
            <p className="hint">
              Shown when USB is away or the PC is locked. Setup → Screen on the pad has the same
              options.
            </p>
          </div>
        </div>
        {canClockStyle ? (
          <div className="pad-clock-body">
            <div className="pad-clock-controls">
              <label>
                Style
                <select
                  value={clockStyle.anim}
                  disabled={busy}
                  onChange={(e) => setClockStyle({ anim: Number(e.target.value) })}
                >
                  {CLOCK_ANIMS.map((n, i) => (
                    <option key={n} value={i}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Speed
                <select
                  value={clockStyle.speed}
                  disabled={busy}
                  onChange={(e) => setClockStyle({ speed: Number(e.target.value) })}
                >
                  {CLOCK_SPEEDS.map((n, i) => (
                    <option key={n} value={i}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Seconds bar
                <select
                  value={clockStyle.bar}
                  disabled={busy}
                  onChange={(e) => setClockStyle({ bar: Number(e.target.value) })}
                >
                  <option value={1}>On</option>
                  <option value={0}>Off</option>
                </select>
              </label>
            </div>
            <ClockPreview
              style={clockStyle}
              flip={snap.meta.flip !== 0}
              padPreview={clockHover && canPreviewPad}
            />
          </div>
        ) : (
          <p className="hint">Update firmware for standby clock style, speed, and bar.</p>
        )}
      </section>
    </div>
  );
}
