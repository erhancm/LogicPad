import { useEffect, useMemo, useState, type ReactElement } from "react";
import type { LaunchEntry, Snapshot, SwitchConfig } from "./types";
import {
  defaultPackOptions,
  sectionsInPack,
  type LogicPadPack,
  type PackOptions,
} from "./pack";
import "./PackDialog.css";

const FLAGS: { key: keyof Omit<PackOptions, "profileIndices">; label: string }[] = [
  { key: "names", label: "Profile names and key labels" },
  { key: "actions", label: "Actions and typed text" },
  { key: "leds", label: "Key LEDs" },
  { key: "lights", label: "Lighting (mode, bright, dim)" },
  { key: "launches", label: "PC program launches" },
  { key: "autoSwitch", label: "Auto-switch rules" },
];

export function PackDialog(props: {
  mode: "export" | "import" | null;
  snap: Snapshot;
  launches: LaunchEntry[];
  switchCfg: SwitchConfig;
  importDraft?: LogicPadPack | null;
  onClose: () => void;
  onExport: (opts: PackOptions) => void;
  onImport: (opts: PackOptions) => void;
}): ReactElement | null {
  const { mode, snap, launches, switchCfg, importDraft, onClose, onExport, onImport } = props;
  const [opts, setOpts] = useState<PackOptions>(() => defaultPackOptions(snap, importDraft));

  useEffect(() => {
    setOpts(defaultPackOptions(snap, mode === "import" ? importDraft : null));
  }, [mode, snap, importDraft]);

  useEffect(() => {
    if (!mode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onClose]);

  const present = useMemo(
    () => (mode === "import" && importDraft ? sectionsInPack(importDraft) : null),
    [mode, importDraft],
  );

  if (!mode) return null;

  const allIdx = snap.profiles.map((p) => p.index);
  const selected = new Set(opts.profileIndices);
  const anyFlag = FLAGS.some((f) => opts[f.key]);
  const needSlots = opts.names || opts.actions || opts.leds || opts.lights || opts.launches;
  const canGo =
    anyFlag &&
    (opts.autoSwitch || (needSlots && opts.profileIndices.length > 0)) &&
    (mode === "export" || importDraft != null);

  const preview = mode === "export" ? exportPreview(snap, launches, switchCfg, opts) : importPreview(importDraft);

  function toggleFlag(key: (typeof FLAGS)[number]["key"], on: boolean) {
    setOpts((o) => ({ ...o, [key]: on }));
  }

  function toggleProfile(index: number) {
    setOpts((o) => {
      const has = o.profileIndices.includes(index);
      return {
        ...o,
        profileIndices: has ? o.profileIndices.filter((i) => i !== index) : [...o.profileIndices, index],
      };
    });
  }

  return (
    <div className="pack-overlay" onClick={onClose}>
      <div
        className="pack-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={mode === "export" ? "Save as file" : "Import file"}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{mode === "export" ? "Save as file" : "Import file"}</h2>
        <p className="hint">
          {mode === "export"
            ? "Write a YAML file you can copy or share. Pick which profiles and parts to include."
            : "Choose what to apply onto this pad. Existing profiles that you do not select are left alone."}
        </p>
        {mode === "import" && opts.launches && present?.launches ? (
          <p className="pack-warn">
            Launch paths point at programs on the machine that saved the file. Edit them after
            import if this PC uses different locations.
          </p>
        ) : null}

        <div className="pack-block">
          <h3>Include</h3>
          <div className="pack-checks">
            {FLAGS.map((f) => {
              const missing = present ? !present[f.key] : false;
              return (
                <label
                  key={f.key}
                  className={missing ? "pack-check is-off" : "pack-check"}
                  title={missing ? "Not in this file" : undefined}
                >
                  <input
                    type="checkbox"
                    checked={missing ? false : opts[f.key]}
                    disabled={missing}
                    onChange={(e) => toggleFlag(f.key, e.target.checked)}
                  />
                  {f.label}
                </label>
              );
            })}
          </div>
        </div>

        {mode === "import" && present && !present.profiles ? (
          <p className="hint">This file has no profiles — only auto-switch rules will apply.</p>
        ) : (
          <div className="pack-block">
            <h3>{mode === "export" ? "Profiles to include" : "Apply onto profiles"}</h3>
            {allIdx.length > 1 ? (
              <div className="pack-profile-bar">
                <button type="button" onClick={() => setOpts((o) => ({ ...o, profileIndices: allIdx }))}>
                  All
                </button>
                <button type="button" onClick={() => setOpts((o) => ({ ...o, profileIndices: [] }))}>
                  None
                </button>
              </div>
            ) : null}
            <div className="pack-profiles">
              {snap.profiles.map((p) => (
                <label key={p.index} className="pack-check">
                  <input
                    type="checkbox"
                    checked={selected.has(p.index)}
                    onChange={() => toggleProfile(p.index)}
                  />
                  {p.name.trim() || `P${p.index + 1}`}
                </label>
              ))}
            </div>
          </div>
        )}

        {preview ? <p className="pack-preview">{preview}</p> : null}

        <div className="bar">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          {mode === "export" ? (
            <button type="button" className="primary" disabled={!canGo} onClick={() => onExport(cleanOpts(opts, present))}>
              Save YAML…
            </button>
          ) : (
            <button type="button" className="primary" disabled={!canGo} onClick={() => onImport(cleanOpts(opts, present))}>
              Import
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function cleanOpts(opts: PackOptions, present: ReturnType<typeof sectionsInPack> | null): PackOptions {
  if (!present) return opts;
  return {
    ...opts,
    names: opts.names && present.names,
    actions: opts.actions && present.actions,
    leds: opts.leds && present.leds,
    lights: opts.lights && present.lights,
    launches: opts.launches && present.launches,
    autoSwitch: opts.autoSwitch && present.autoSwitch,
  };
}

function exportPreview(
  snap: Snapshot,
  launches: LaunchEntry[],
  switchCfg: SwitchConfig,
  opts: PackOptions,
): string {
  const idx = new Set(opts.profileIndices);
  const nProf = opts.profileIndices.length;
  const nLaunch = opts.launches
    ? launches.filter((l) => idx.has(l.profile) && l.path.trim()).length
    : 0;
  const nRules =
    opts.autoSwitch && nProf
      ? switchCfg.rules.filter((r) => idx.has(r.profile)).length
      : opts.autoSwitch
        ? switchCfg.rules.length
        : 0;
  const names = snap.profiles
    .filter((p) => idx.has(p.index))
    .map((p) => p.name.trim() || `P${p.index + 1}`);
  const bits = [
    nProf ? `${nProf} profile${nProf === 1 ? "" : "s"}` : null,
    names.length ? names.join(", ") : null,
    opts.launches ? `${nLaunch} launch${nLaunch === 1 ? "" : "es"}` : null,
    opts.autoSwitch ? `${nRules} auto-switch rule${nRules === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return bits.join(" · ");
}

function importPreview(pack: LogicPadPack | null | undefined): ReactElement | string | null {
  if (!pack) return "No file loaded.";
  const names = (pack.profiles ?? []).map((p, i) => p.name?.trim() || `Profile ${i + 1}`);
  const nRules = pack.autoSwitch?.rules.length ?? 0;
  return (
    <>
      {names.length ? (
        <>
          File has <strong>{names.length}</strong> profile{names.length === 1 ? "" : "s"}: {names.join(", ")}
        </>
      ) : (
        "No profiles in this file"
      )}
      {pack.autoSwitch != null ? (
        <>
          {". "}
          Auto-switch {pack.autoSwitch.enabled ? "on" : "off"}
          {nRules ? `, ${nRules} rule${nRules === 1 ? "" : "s"}` : ""}
        </>
      ) : null}
    </>
  );
}
