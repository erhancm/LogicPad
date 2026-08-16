import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "./api";
import {
  ACT,
  HID_LETTERS,
  LEDS,
  LIGHT_MODES,
  MEDIA,
  SEND,
  type Action,
  type LaunchEntry,
  type PadKey,
  type ProfileHdr,
  type Snapshot,
} from "./types";

function hidName(hid: number): string {
  return HID_LETTERS.find((h) => h.hid === hid)?.name ?? `0x${hid.toString(16)}`;
}

function fmtAct(a: Action): string {
  switch (a.type) {
    case ACT.key: {
      const send = a.code >> 8;
      const hid = a.code & 0xff;
      const mods = [
        a.mods & 1 ? "Ctrl" : "",
        a.mods & 2 ? "Shift" : "",
        a.mods & 4 ? "Alt" : "",
        a.mods & 8 ? "Gui" : "",
      ]
        .filter(Boolean)
        .join("+");
      const mode = send === SEND.down ? " down" : send === SEND.up ? " up" : "";
      const key = hid ? hidName(hid) : "";
      return [mods, key].filter(Boolean).join("+") + mode || "Key";
    }
    case ACT.delay:
      return `Wait ${a.code} ms`;
    case ACT.consumer:
      return MEDIA.find((m) => m.usage === a.code)?.name ?? "Media";
    case ACT.mouseBtn:
      return "Click";
    case ACT.mouseMove:
      return "Move";
    case ACT.wheel:
      return "Wheel";
    case ACT.release:
      return "Release";
    default:
      return "—";
  }
}

function emptyKey(profile: number, index: number): PadKey {
  return { profile, index, label: "", led: 0, acts: [] };
}

function launchOf(list: LaunchEntry[], profile: number, key: number): LaunchEntry {
  return (
    list.find((l) => l.profile === profile && l.key === key) ?? {
      profile,
      key,
      path: "",
      args: "",
    }
  );
}

function baseName(path: string): string {
  const p = path.replaceAll("\\", "/");
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

export default function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(0);
  const [hidPick, setHidPick] = useState(0x04);
  const [mods, setMods] = useState(0);
  const [status, setStatus] = useState("Looking for LogicPad…");
  const [launches, setLaunches] = useState<LaunchEntry[]>([]);
  const fwInput = useRef<HTMLInputElement>(null);

  const profile = snap?.meta.active ?? 0;
  const hdr = snap?.profiles[profile];
  const keys = snap?.keys[profile] ?? [];
  const key = keys[sel] ?? emptyKey(profile, sel);
  const launch = launchOf(launches, profile, sel);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true);
    setErr("");
    try {
      await fn();
      setStatus(label);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onConnect() {
    await run("Connected", async () => {
      await api.connect();
      setSnap(await api.loadPad());
    });
  }

  useEffect(() => {
    void onConnect();
    void api.getLaunches().then(setLaunches).catch(() => undefined);
    // Connect once on launch; retry with the button if the pad was unplugged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let gone = false;
    let unlisten: (() => void) | undefined;
    void listen<{ profile: number; key: number; down: boolean }>("pad-key", (e) => {
      if (!e.payload.down) return;
      setSel(e.payload.key);
    }).then((fn) => {
      if (gone) fn();
      else unlisten = fn;
    });
    void listen<string>("launch-error", (e) => setErr(String(e.payload))).then((fn) => {
      if (gone) fn();
      else {
        const prev = unlisten;
        unlisten = () => {
          prev?.();
          fn();
        };
      }
    });
    return () => {
      gone = true;
      unlisten?.();
    };
  }, []);

  async function saveLaunch(next: LaunchEntry) {
    try {
      await api.setLaunch(next);
      setLaunches(await api.getLaunches());
    } catch (e) {
      setErr(String(e));
    }
  }

  async function pushKey(next: PadKey) {
    if (!snap) return;
    const copy: Snapshot = structuredClone(snap);
    copy.keys[next.profile][next.index] = next;
    copy.meta.dirty = true;
    setSnap(copy);
    try {
      await api.applyKey(next);
    } catch (e) {
      setErr(String(e));
    }
  }

  async function pushHdr(next: ProfileHdr) {
    if (!snap) return;
    const copy: Snapshot = structuredClone(snap);
    copy.profiles[next.index] = next;
    copy.meta.dirty = true;
    setSnap(copy);
    try {
      await api.applyProfile(next);
    } catch (e) {
      setErr(String(e));
    }
  }

  async function onFlashFile(file: File) {
    if (!confirm("Update firmware? The pad will reboot. Do not unplug until it reconnects.")) {
      return;
    }
    await run("Firmware updated", async () => {
      const buf = new Uint8Array(await file.arrayBuffer());
      await api.flashFirmware(Array.from(buf));
      setSnap(null);
      await api.connect();
      setSnap(await api.loadPad());
    });
  }

  const letterGrid = useMemo(() => HID_LETTERS, []);

  return (
    <div className="app">
      <header>
        <div>
          <h1>LogicPad</h1>
          <p className="sub">{status}</p>
        </div>
        <div className="bar">
          <button disabled={busy} onClick={onConnect}>
            Connect
          </button>
          <button
            disabled={busy || !snap}
            onClick={() =>
              run("Saved", async () => {
                await api.save();
                setSnap(await api.loadPad());
              })
            }
          >
            Save
          </button>
          <button
            disabled={busy || !snap}
            onClick={() =>
              run("Reloaded", async () => {
                setSnap(await api.reload());
              })
            }
          >
            Reload
          </button>
          <button
            className="danger"
            disabled={busy || !snap}
            onClick={() => {
              if (!confirm("Reset all profiles to empty factory keys?")) return;
              run("Factory reset", async () => {
                setSnap(await api.factory());
              });
            }}
          >
            Factory
          </button>
          <button
            disabled={busy}
            onClick={() => fwInput.current?.click()}
          >
            Update firmware
          </button>
          <input
            ref={fwInput}
            type="file"
            accept=".bin,application/octet-stream"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void onFlashFile(f);
            }}
          />
          {snap?.meta.dirty ? <span className="dirty">unsaved</span> : null}
        </div>
      </header>
      {err ? <div className="err">{err}</div> : null}

      {!snap ? (
        <section className="hero">
          <p>Plug the pad in over USB, then connect. The editor loads profiles and keys from the device.</p>
          <button className="primary" disabled={busy} onClick={onConnect}>
            {busy ? "Connecting…" : "Connect to LogicPad"}
          </button>
        </section>
      ) : (
        <main>
          <aside>
            <h2>Profiles</h2>
            <div className="profiles">
              {snap.profiles.map((p) => (
                <button
                  key={p.index}
                  className={p.index === profile ? "on" : ""}
                  onClick={() =>
                    run("Active profile", async () => {
                      await api.setActive(p.index);
                      const next = structuredClone(snap);
                      next.meta.active = p.index;
                      next.meta.dirty = true;
                      setSnap(next);
                      setSel(0);
                    })
                  }
                >
                  {p.name || `P${p.index + 1}`}
                  {p.index === profile ? " *" : ""}
                </button>
              ))}
            </div>
            {hdr ? (
              <>
                <label>
                  Name
                  <input
                    maxLength={12}
                    value={hdr.name}
                    onChange={(e) => {
                      const next = { ...hdr, name: e.target.value };
                      const copy = structuredClone(snap);
                      copy.profiles[hdr.index] = next;
                      setSnap(copy);
                    }}
                    onBlur={() => pushHdr(hdr)}
                  />
                </label>
                <label>
                  Lights
                  <select
                    value={hdr.lightMode}
                    onChange={(e) => pushHdr({ ...hdr, lightMode: Number(e.target.value) })}
                  >
                    {LIGHT_MODES.map((n, i) => (
                      <option key={n} value={i}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Bright {hdr.bright}
                  <input
                    type="range"
                    min={0}
                    max={10}
                    value={hdr.bright}
                    onChange={(e) => {
                      const next = { ...hdr, bright: Number(e.target.value) };
                      const copy = structuredClone(snap);
                      copy.profiles[hdr.index] = next;
                      setSnap(copy);
                    }}
                    onPointerUp={(e) =>
                      pushHdr({ ...hdr, bright: Number((e.target as HTMLInputElement).value) })
                    }
                  />
                </label>
                <label>
                  Dim {hdr.dim}
                  <input
                    type="range"
                    min={0}
                    max={10}
                    value={hdr.dim}
                    onChange={(e) => {
                      const next = { ...hdr, dim: Number(e.target.value) };
                      const copy = structuredClone(snap);
                      copy.profiles[hdr.index] = next;
                      setSnap(copy);
                    }}
                    onPointerUp={(e) =>
                      pushHdr({ ...hdr, dim: Number((e.target as HTMLInputElement).value) })
                    }
                  />
                </label>
              </>
            ) : null}
          </aside>

          <section className="pad">
            <h2>Keys</h2>
            <div className="grid">
              {Array.from({ length: 9 }, (_, i) => {
                const k = keys[i] ?? emptyKey(profile, i);
                return (
                  <button
                    key={i}
                    className={sel === i ? "key on" : "key"}
                    onClick={() => setSel(i)}
                  >
                    <span className="idx">{i + 1}</span>
                    <span className="lab">{k.label || "—"}</span>
                    {launchOf(launches, profile, i).path ? (
                      <span className="run">app</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="edit">
            <h2>Key {sel + 1}</h2>
            <label>
              Label
              <input
                maxLength={6}
                value={key.label}
                onChange={(e) => {
                  const next = { ...key, label: e.target.value };
                  const copy = structuredClone(snap);
                  copy.keys[profile][sel] = next;
                  setSnap(copy);
                }}
                onBlur={() => pushKey(key)}
              />
            </label>
            <label>
              LED
              <select
                value={key.led}
                onChange={(e) => pushKey({ ...key, led: Number(e.target.value) })}
              >
                {LEDS.map((n, i) => (
                  <option key={n} value={i}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <h3>Launch program</h3>
            <p className="hint">
              Runs on this PC when you press the key. LogicPad must stay open. Needs current firmware.
            </p>
            <label>
              Program
              <input
                value={launch.path}
                placeholder="C:\Path\app.exe"
                onChange={(e) => {
                  const next = { ...launch, path: e.target.value };
                  setLaunches((list) => {
                    const rest = list.filter((l) => !(l.profile === profile && l.key === sel));
                    return next.path ? [...rest, next] : rest;
                  });
                }}
                onBlur={() => void saveLaunch(launch)}
              />
            </label>
            <div className="add">
              <button
                onClick={async () => {
                  const path = await api.pickProgram();
                  if (!path) return;
                  const next = { ...launch, path };
                  setLaunches((list) => {
                    const rest = list.filter((l) => !(l.profile === profile && l.key === sel));
                    return [...rest, next];
                  });
                  await saveLaunch(next);
                }}
              >
                Browse…
              </button>
              <button
                disabled={!launch.path}
                onClick={() => void saveLaunch({ ...launch, path: "", args: "" })}
              >
                Clear
              </button>
            </div>
            <label>
              Arguments
              <input
                value={launch.args}
                placeholder="optional"
                onChange={(e) => {
                  const next = { ...launch, args: e.target.value };
                  setLaunches((list) => {
                    const rest = list.filter((l) => !(l.profile === profile && l.key === sel));
                    return [...rest, next];
                  });
                }}
                onBlur={() => void saveLaunch(launch)}
              />
            </label>
            {launch.path ? <p className="hint">Opens {baseName(launch.path)}</p> : null}
            <h3>Macro</h3>
            <ul className="acts">
              {key.acts.length === 0 ? <li className="empty">No actions</li> : null}
              {key.acts.map((a, i) => (
                <li key={i}>
                  <span>{fmtAct(a)}</span>
                  <button
                    onClick={() =>
                      pushKey({ ...key, acts: key.acts.filter((_, j) => j !== i) })
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <div className="mods">
              {(
                [
                  [1, "Ctrl"],
                  [2, "Shift"],
                  [4, "Alt"],
                  [8, "Gui"],
                ] as const
              ).map(([bit, name]) => (
                <label key={bit} className="chk">
                  <input
                    type="checkbox"
                    checked={(mods & bit) !== 0}
                    onChange={() => setMods((m) => m ^ bit)}
                  />
                  {name}
                </label>
              ))}
            </div>
            <div className="letters">
              {letterGrid.map((h) => (
                <button
                  key={h.hid}
                  className={hidPick === h.hid ? "on" : ""}
                  onClick={() => setHidPick(h.hid)}
                >
                  {h.name}
                </button>
              ))}
            </div>
            <div className="add">
              <button
                disabled={key.acts.length >= 12}
                onClick={() =>
                  pushKey({
                    ...key,
                    acts: [
                      ...key.acts,
                      { type: ACT.key, mods, code: hidPick | (SEND.tap << 8) },
                    ],
                  })
                }
              >
                Add key
              </button>
              <button
                disabled={key.acts.length >= 12}
                onClick={() =>
                  pushKey({
                    ...key,
                    acts: [...key.acts, { type: ACT.delay, mods: 0, code: 50 }],
                  })
                }
              >
                Add wait 50ms
              </button>
              {MEDIA.map((m) => (
                <button
                  key={m.usage}
                  disabled={key.acts.length >= 12}
                  onClick={() =>
                    pushKey({
                      ...key,
                      acts: [...key.acts, { type: ACT.consumer, mods: SEND.tap, code: m.usage }],
                    })
                  }
                >
                  {m.name}
                </button>
              ))}
            </div>
          </section>
        </main>
      )}
    </div>
  );
}
