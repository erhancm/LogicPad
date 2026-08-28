import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { api } from "./api";
import {
  ACT,
  HID_ALPHA,
  HID_DIGIT,
  HID_FN,
  HID_MORE,
  HID_NAV,
  HID_SPECIALS,
  LEDS,
  MEDIA,
  SEND,
  type Action,
  type HidKey,
  type LaunchEntry,
  type PadInfo,
  type PadKey,
  type ProfileHdr,
  type Snapshot,
  type SwitchConfig,
  type SwitchFocus,
} from "./types";
import { PrintOverlay } from "./PrintSheet";
import { ClearAllButton, clearedKeys } from "./ClearAllButton";
import { LogicPadMark } from "./LogicPadMark";
import { ProfilesPane } from "./ProfilesPane";
import {
  KeyContextMenu,
  preventGridMenu,
  type KeyMenuTarget,
} from "./KeyContextMenu";
import { applyShowcaseToPad } from "./showcaseApply";
import { ensureGraph, exeStem, listRuleCards, stemName as exeDisplayName } from "./switchGraph";
import { SwitchEditor } from "./SwitchEditor";
import { SyncBadge } from "./SyncBadge";
import { PackDialog } from "./PackDialog";
import {
  applyPack,
  buildPack,
  packToYaml,
  suggestedFileName,
  yamlToPack,
  type LogicPadPack,
  type PackOptions,
} from "./pack";
import { cloneSnap, syncStatus } from "./syncState";
import { baseName, fmtAct, launchesOf } from "./format";
import { buildSteps, type Step } from "./steps";
import {
  addLaunchDraft,
  keyHasLaunch,
  makeLaunch,
  newLaunchId,
  nudgeLaunchSlot,
  onActRemoved,
  remapKeyLaunches,
  removeKeyLaunches,
  removeProfileLaunches,
  tombstonesForKey,
  tombstonesForProfile,
  upsertLaunch,
  withLaunchId,
} from "./launches";
import {
  ACT_SLOTS,
  TEXT_MAX,
  TITLE_MAX,
  LABEL_HID,
  addTextAct,
  memoryOf,
  moveAct,
  removeAct,
  roomForText,
  segmentOf,
  setSegment,
  stemName,
  typedDisplayAt,
  uniqueProfileName,
  uniqueTitle,
  utf8Len,
  withTextStep,
} from "./text";

function emptyKey(profile: number, index: number): PadKey {
  return { profile, index, label: "", led: 0, acts: [], text: "" };
}

type AppTab = "keys" | "profiles" | "switch";

const TABS: { id: AppTab; label: string }[] = [
  { id: "keys", label: "Keys" },
  { id: "profiles", label: "Profiles" },
  { id: "switch", label: "Auto-switch" },
];

function padChipLabel(pad: PadInfo | undefined, linked: boolean, pads: PadInfo[]): string {
  if (!linked || !pad) return "No pad";
  if (pad.simulated) return "Virtual keypad";
  const usb = pads.filter((p) => !p.simulated);
  if (usb.length <= 1) return "LogicPad";
  if (pad.serial) {
    const s = pad.serial;
    return s.length > 8 ? s.slice(0, 8) : s;
  }
  const i = usb.findIndex((p) => p.id === pad.id);
  return i >= 0 ? `LogicPad ${i + 1}` : "LogicPad";
}

function PadSwitch({
  pads,
  activeId,
  simulated,
  linked,
  disabled,
  onSelect,
}: {
  pads: PadInfo[];
  activeId: string;
  simulated: boolean;
  linked: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const active = pads.find((p) => p.id === activeId);
  const name = padChipLabel(active, linked, pads);
  const tone = !linked ? "off" : simulated ? "sim" : "usb";

  useEffect(() => {
    const el = detailsRef.current;
    if (!el) return;
    const onDoc = (e: globalThis.PointerEvent) => {
      if (!el.open) return;
      if (!el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, []);

  return (
    <details ref={detailsRef} className={`pad-switch ${tone}`}>
      <summary
        aria-disabled={disabled}
        aria-label={`Pad: ${name}. Choose a LogicPad`}
        title={
          simulated
            ? "Virtual keypad on this PC — not a USB LogicPad"
            : active?.label || "Choose a LogicPad"
        }
        onClick={(e) => {
          if (!disabled) return;
          e.preventDefault();
        }}
        onKeyDown={(e) => {
          if (disabled && (e.key === "Enter" || e.key === " ")) e.preventDefault();
        }}
      >
        <span className="pad-switch-dot" aria-hidden="true" />
        <span className="pad-switch-name">{name}</span>
      </summary>
      <div className="pad-switch-list" role="listbox" aria-label="LogicPads">
        {pads.map((p) => (
          <button
            key={p.id}
            type="button"
            role="option"
            aria-selected={p.id === activeId}
            className={p.id === activeId ? "on" : ""}
            disabled={disabled}
            onClick={() => {
              if (detailsRef.current) detailsRef.current.open = false;
              onSelect(p.id);
            }}
          >
            <span
              className={`pad-switch-dot ${p.simulated ? "sim" : "usb"}`}
              aria-hidden="true"
            />
            <span className="pad-switch-copy">
              <strong>{p.simulated ? "Virtual keypad" : p.label}</strong>
              <em>{p.simulated ? "On this PC" : "USB"}</em>
            </span>
          </button>
        ))}
      </div>
    </details>
  );
}

function TabGlyph({ tab }: { tab: AppTab }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.35,
  };
  if (tab === "keys") {
    return (
      <svg {...common} aria-hidden="true">
        <rect x="1.5" y="1.5" width="4" height="4" rx="0.8" />
        <rect x="6" y="1.5" width="4" height="4" rx="0.8" />
        <rect x="10.5" y="1.5" width="4" height="4" rx="0.8" />
        <rect x="1.5" y="6" width="4" height="4" rx="0.8" />
        <rect x="6" y="6" width="4" height="4" rx="0.8" />
        <rect x="10.5" y="6" width="4" height="4" rx="0.8" />
        <rect x="1.5" y="10.5" width="4" height="4" rx="0.8" />
        <rect x="6" y="10.5" width="4" height="4" rx="0.8" />
        <rect x="10.5" y="10.5" width="4" height="4" rx="0.8" />
      </svg>
    );
  }
  if (tab === "profiles") {
    return (
      <svg {...common} aria-hidden="true">
        <rect x="3" y="2" width="10" height="3.2" rx="0.8" />
        <rect x="3" y="6.4" width="10" height="3.2" rx="0.8" />
        <rect x="3" y="10.8" width="10" height="3.2" rx="0.8" />
      </svg>
    );
  }
  return (
    <svg {...common} aria-hidden="true">
      <circle cx="4" cy="4" r="2" />
      <circle cx="12" cy="8" r="2" />
      <circle cx="4" cy="12" r="2" />
      <path d="M6 4.5 L10 7.2" />
      <path d="M6 11.5 L10 8.8" />
    </svg>
  );
}

type ActPick = { kind: "launch"; id: string } | number | null;

function tauriListen<T>(event: string, cb: (e: { payload: T }) => void) {
  try {
    return listen<T>(event, cb).catch(() => () => undefined);
  } catch {
    return Promise.resolve(() => undefined);
  }
}

function HidPad({
  keys,
  selected,
  onPick,
  className,
}: {
  keys: HidKey[];
  selected: number;
  onPick: (hid: number) => void;
  className?: string;
}) {
  return (
    <div className={className ? `letters ${className}` : "letters"}>
      {keys.map((h) => (
        <button
          key={`${h.name}-${h.hid}`}
          className={selected === h.hid ? "on" : ""}
          onClick={() => onPick(h.hid)}
        >
          {h.name}
        </button>
      ))}
    </div>
  );
}

function MemBar({
  label,
  used,
  max,
  unit,
  warn,
}: {
  label: string;
  used: number;
  max: number;
  unit: string;
  warn?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const tone = pct >= 90 ? "hot" : pct >= 70 ? "warn" : "ok";
  return (
    <div className="mem-row">
      <div className="mem-lab">
        <span>{label}</span>
        <span>
          {used} / {max} {unit}
        </span>
      </div>
      <div className="mem-track">
        <div className={`mem-fill ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      {warn ? <p className="mem-warn">{warn}</p> : null}
    </div>
  );
}

function keyAtClient(x: number, y: number): number | null {
  const el = document.elementFromPoint(x, y);
  const node = el?.closest(".grid [data-key]") as HTMLElement | null;
  if (!node) return null;
  const n = Number(node.dataset.key);
  return Number.isInteger(n) && n >= 0 && n < 9 ? n : null;
}

function keyAtPoint(pos: { x: number; y: number }): number | null {
  const x = pos.x / (window.devicePixelRatio || 1);
  const y = pos.y / (window.devicePixelRatio || 1);
  return keyAtClient(x, y);
}

export default function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(0);
  const [hidPick, setHidPick] = useState(0x04);
  const [mods, setMods] = useState(0);
  const [sendMode, setSendMode] = useState<number>(SEND.tap);
  const [status, setStatus] = useState("Looking for LogicPad…");
  const [launches, setLaunches] = useState<LaunchEntry[]>([]);
  const [switchCfg, setSwitchCfg] = useState<SwitchConfig>({ enabled: false, rules: [] });
  const [focusNow, setFocusNow] = useState<SwitchFocus | null>(null);
  const [flash, setFlash] = useState<{ phase: string; done: number; total: number } | null>(null);
  const [dropHover, setDropHover] = useState<number | null>(null);
  const [linked, setLinked] = useState(false);
  const [pads, setPads] = useState<PadInfo[]>([]);
  const [dragKey, setDragKey] = useState<number | null>(null);
  const [swapAnim, setSwapAnim] = useState<{
    from: number;
    to: number;
    fromRect: DOMRect;
    toRect: DOMRect;
  } | null>(null);
  const fwInput = useRef<HTMLInputElement>(null);
  const snapRef = useRef(snap);
  const launchesRef = useRef(launches);
  const hdrBusy = useRef(false);
  const hdrWait = useRef<ProfileHdr | null>(null);
  const screenBusy = useRef(false);
  const screenWait = useRef<{
    contrast: number;
    flip: number;
    sleep: number;
    clockStyle: number;
  } | null>(null);
  const skipClick = useRef(false);
  const dragKeyRef = useRef<number | null>(null);
  const dragOrigin = useRef<{ x: number; y: number; i: number } | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [actPick, setActPick] = useState<ActPick>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [printAll, setPrintAll] = useState(true);
  const [baseline, setBaseline] = useState<Snapshot | null>(null);
  const [keyMenu, setKeyMenu] = useState<KeyMenuTarget | null>(null);
  const [packMode, setPackMode] = useState<"export" | "import" | null>(null);
  const [importDraft, setImportDraft] = useState<LogicPadPack | null>(null);
  const [tab, setTab] = useState<AppTab>("keys");
  const [fwVer, setFwVer] = useState<string | null>(null);
  const showcaseOnce = useRef(false);
  snapRef.current = snap;
  launchesRef.current = launches;

  const profile = snap?.meta.active ?? 0;
  const hdr = snap?.profiles[profile];
  const keys = snap?.keys[profile] ?? [];
  const poolOn = snap?.textPool?.enabled ?? false;
  const titleMax = snap?.canTitles ? TITLE_MAX : LABEL_HID;
  const key = withTextStep(keys[sel] ?? emptyKey(profile, sel), poolOn);
  const mine = launchesOf(launches, profile, sel);
  const steps = buildSteps(key.acts, mine);
  const pickedLaunch =
    typeof actPick === "object" && actPick?.kind === "launch"
      ? mine.find((l) => l.id === actPick.id)
      : undefined;
  const padOptions =
    pads.length > 0
      ? pads
      : [
          {
            id: "sim",
            kind: "simulated",
            label: "Simulated LogicPad",
            serial: null,
            simulated: true,
            selected: false,
          } satisfies PadInfo,
        ];
  const activePad = padOptions.find((p) => p.selected) ?? (linked ? padOptions[0] : undefined);
  const simulated = Boolean(linked && activePad?.simulated);

  function takePad(next: Snapshot) {
    setSnap(next);
    setBaseline(cloneSnap(next));
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true);
    setErr("");
    try {
      await fn();
      if (label) setStatus(label);
    } catch (e) {
      const msg = String(e);
      if (!/reading 'invoke'|__TAURI_INTERNALS__/i.test(msg)) setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  async function syncPadTime() {
    const n = new Date();
    await api.setTime({
      year: n.getFullYear(),
      month: n.getMonth() + 1,
      day: n.getDate(),
      hour: n.getHours(),
      minute: n.getMinutes(),
      second: n.getSeconds(),
    });
  }

  async function reloadSidecar() {
    try {
      setLaunches(await api.getLaunches());
      setSwitchCfg(await api.getSwitchRules());
    } catch {
      /* old backend */
    }
  }

  async function afterLink(label: string) {
    try {
      await syncPadTime();
    } catch {
      /* old firmware / app without SET_TIME */
    }
    takePad(await api.loadPad());
    setLinked(true);
    try {
      setPads(await api.listPads());
    } catch {
      /* list_pads missing on an old backend */
    }
    await reloadSidecar();
    setStatus(label);
  }

  async function onConnect() {
    await run("", async () => {
      try {
        await api.connect();
      } catch {
        await api.connectTo("sim");
      }
      const pad = await api.currentPad().catch(() => undefined);
      const sim = pad?.simulated ?? false;
      if (sim) setFwVer(null);
      await afterLink(sim ? "Using simulated LogicPad" : "Connected");
    });
  }

  async function selectPad(id: string) {
    if (activePad?.id === id && linked && snap) return;
    if (snap && syncStatus({ linked, snap, baseline }) === "unsaved") {
      if (!confirm("Unsaved changes on this pad. Switch anyway?")) return;
    }
    const sim = id === "sim";
    await run(sim ? "Using simulated LogicPad" : "Connected", async () => {
      await api.connectTo(id);
      if (sim) setFwVer(null);
      await afterLink(sim ? "Using simulated LogicPad" : "Connected");
    });
  }

  async function activateProfile(index: number) {
    await run("Active profile", async () => {
      await api.setActive(index);
      const cur = snapRef.current;
      if (!cur) return;
      const next = structuredClone(cur);
      next.meta.active = index;
      setSnap(next);
      setSel(0);
    });
  }

  useEffect(() => {
    void onConnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "p") return;
      e.preventDefault();
      if (printOpen) return;
      if (snapRef.current) setPrintOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [printOpen]);

  useEffect(() => {
    setActPick(null);
  }, [profile, sel]);

  useEffect(() => {
    setKeyMenu(null);
  }, [profile]);

  useEffect(() => {
    if (!linked || busy || flash) return;
    const id = window.setInterval(() => {
      void api
        .ping()
        .then(async (ver) => {
          if (!simulated && Array.isArray(ver) && ver.length >= 2) {
            setFwVer(`${ver[0]}.${ver[1]}`);
          }
          try {
            const meta = await api.getMeta();
            setSnap((s) => {
              if (!s || s.meta.dirty === meta.dirty) return s;
              const next = structuredClone(s);
              next.meta.dirty = meta.dirty;
              return next;
            });
          } catch {
            /* GET_META missing on old firmware */
          }
        })
        .catch((e) => {
          if (String(e).toLowerCase().includes("busy")) return;
          if (simulated) return;
          setLinked(false);
          setFwVer(null);
          setStatus("Pad disconnected");
        });
    }, 2000);
    return () => window.clearInterval(id);
  }, [linked, busy, flash, simulated]);

  useEffect(() => {
    let gone = false;
    let unlisten: (() => void) | undefined;
    void tauriListen<{ profile: number; key: number; down: boolean }>("pad-key", (e) => {
      if (!e.payload.down) return;
      setSel(e.payload.key);
    }).then((fn) => {
      if (gone) fn();
      else unlisten = fn;
    });
    void tauriListen<string>("launch-error", (e) => setErr(String(e.payload))).then((fn) => {
      if (gone) fn();
      else {
        const prev = unlisten;
        unlisten = () => {
          prev?.();
          fn();
        };
      }
    });
    void tauriListen<{ profile: number }>("active-profile", (e) => {
      const p = e.payload.profile;
      setSnap((s) => {
        if (!s || s.meta.active === p) return s;
        const next = structuredClone(s);
        next.meta.active = p;
        return next;
      });
      setSel(0);
    }).then((fn) => {
      if (gone) fn();
      else {
        const prev = unlisten;
        unlisten = () => {
          prev?.();
          fn();
        };
      }
    });
    void tauriListen<SwitchFocus>("switch-focus", (e) => setFocusNow(e.payload)).then((fn) => {
      if (gone) fn();
      else {
        const prev = unlisten;
        unlisten = () => {
          prev?.();
          fn();
        };
      }
    });
    void tauriListen<{ phase: string; done: number; total: number }>("flash-progress", (e) => {
      const { phase, done, total } = e.payload;
      setFlash(e.payload);
      const pct = total ? Math.round((done / total) * 100) : 0;
      const label =
        phase === "reboot"
          ? "Rebooting into updater…"
          : phase === "wait"
            ? "Waiting for LogicPad Boot…"
            : phase === "start"
              ? "Erasing…"
              : phase === "write"
                ? `Writing firmware… ${pct}%`
                : phase === "verify"
                  ? "Verifying…"
                  : phase === "done"
                    ? "Firmware written"
                    : phase;
      setStatus(label);
    }).then((fn) => {
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

  useEffect(() => {
    let gone = false;
    let unlisten: (() => void) | undefined;
    void tauriListen<PadInfo[]>("pads", (e) => {
      setPads(e.payload);
    }).then((fn) => {
      if (gone) fn();
      else unlisten = fn;
    });
    void tauriListen<PadInfo>("pad-session", (e) => {
      setPads((list) => {
        if (list.length === 0) return [e.payload];
        return list.map((p) => ({ ...p, selected: p.id === e.payload.id }));
      });
      setLinked(true);
      if (e.payload.simulated) setFwVer(null);
      setStatus(e.payload.simulated ? "Using simulated LogicPad" : "Connected");
      void api
        .loadPad()
        .then((next) => takePad(next))
        .catch(() => undefined);
      void reloadSidecar();
    }).then((fn) => {
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

  useEffect(() => {
    if (!snap || busy || showcaseOnce.current) return;
    let gone = false;
    void (async () => {
      try {
        if (!(await api.takeShowcaseFlag())) return;
        if (gone) return;
        if (simulated) {
          setErr("Showcase demo needs a USB LogicPad connected (not the virtual keypad).");
          return;
        }
        showcaseOnce.current = true;
        setStatus("Applying showcase demo…");
        const result = await applyShowcaseToPad(snap, launches, switchCfg);
        if (gone) return;
        takePad(result.snap);
        setLaunches(result.launches);
        setSwitchCfg(result.switchCfg);
        setBaseline(cloneSnap(result.snap));
        setTab("switch");
        setStatus("Showcase demo saved to your LogicPad");
      } catch (e) {
        if (!gone) setErr(String(e));
      }
    })();
    return () => {
      gone = true;
    };
  }, [snap, simulated, busy, launches, switchCfg]);

  useEffect(() => {
    let gone = false;
    let unlisten: (() => void) | undefined;
    try {
      void getCurrentWebview()
        .onDragDropEvent((ev) => {
          const p = ev.payload;
          if (p.type === "leave") {
            setDropHover(null);
            return;
          }
          if (p.type === "over" || p.type === "enter") {
            setDropHover(keyAtPoint(p.position));
            return;
          }
          if (p.type === "drop") {
            setDropHover(null);
            const idx = keyAtPoint(p.position);
            const path = p.paths[0];
            if (idx == null || !path) return;
            void linkProgram(idx, path);
          }
        })
        .then((fn) => {
          if (gone) fn();
          else unlisten = fn;
        })
        .catch(() => undefined);
    } catch {
      /* browser preview / no Tauri webview */
    }
    return () => {
      gone = true;
      unlisten?.();
    };
    // linkProgram reads latest pad state from refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveLaunch(next: LaunchEntry) {
    try {
      await api.setLaunch(next);
      setLaunches(await api.getLaunches());
    } catch (e) {
      setErr(String(e));
    }
  }

  useLayoutEffect(() => {
    if (!swapAnim) return;
    const a = document.querySelector(`.grid [data-key="${swapAnim.from}"]`) as HTMLElement | null;
    const b = document.querySelector(`.grid [data-key="${swapAnim.to}"]`) as HTMLElement | null;
    if (!a || !b) {
      setSwapAnim(null);
      return;
    }
    const dxA = swapAnim.toRect.left - swapAnim.fromRect.left;
    const dyA = swapAnim.toRect.top - swapAnim.fromRect.top;
    const dxB = swapAnim.fromRect.left - swapAnim.toRect.left;
    const dyB = swapAnim.fromRect.top - swapAnim.toRect.top;
    a.style.transition = "none";
    b.style.transition = "none";
    a.style.transform = `translate(${dxA}px, ${dyA}px)`;
    b.style.transform = `translate(${dxB}px, ${dyB}px)`;
    a.style.zIndex = "6";
    b.style.zIndex = "6";
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        a.style.transition = "transform 0.32s cubic-bezier(0.22, 1, 0.36, 1)";
        b.style.transition = "transform 0.32s cubic-bezier(0.22, 1, 0.36, 1)";
        a.style.transform = "";
        b.style.transform = "";
      });
    });
    const done = (ev: TransitionEvent) => {
      if (ev.propertyName !== "transform") return;
      a.style.transition = "";
      b.style.transition = "";
      a.style.zIndex = "";
      b.style.zIndex = "";
      setSwapAnim(null);
    };
    a.addEventListener("transitionend", done);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      a.removeEventListener("transitionend", done);
    };
  }, [swapAnim]);

  async function pushKey(next: PadKey) {
    const cur = snapRef.current;
    if (!cur) return;
    const copy: Snapshot = structuredClone(cur);
    copy.keys[next.profile][next.index] = next;
    copy.meta.dirty = true;
    setSnap(copy);
    try {
      await api.applyKey(next);
    } catch (e) {
      setErr(String(e));
    }
  }

  async function swapKeys(from: number, to: number) {
    const cur = snapRef.current;
    if (!cur || from === to) return;
    const p = cur.meta.active;
    const fromEl = document.querySelector(`.grid [data-key="${from}"]`);
    const toEl = document.querySelector(`.grid [data-key="${to}"]`);
    const fromRect = fromEl?.getBoundingClientRect();
    const toRect = toEl?.getBoundingClientRect();
    const a = cur.keys[p]?.[from] ?? emptyKey(p, from);
    const b = cur.keys[p]?.[to] ?? emptyKey(p, to);
    const remapped = remapKeyLaunches(launchesRef.current, p, from, to);
    const aAtTo: PadKey = { ...a, profile: p, index: to };
    const bAtFrom: PadKey = { ...b, profile: p, index: from };
    const copy: Snapshot = structuredClone(cur);
    copy.keys[p][from] = bAtFrom;
    copy.keys[p][to] = aAtTo;
    copy.meta.dirty = true;
    setSnap(copy);
    setSel(to);
    if (fromRect && toRect) {
      setSwapAnim({ from, to, fromRect, toRect });
    }
    await pushKey(bAtFrom);
    await pushKey(aAtTo);
    launchesRef.current = remapped;
    setLaunches(remapped);
    for (const l of remapped) {
      if (l.profile !== p || (l.key !== from && l.key !== to) || !l.path.trim()) continue;
      await saveLaunch(l);
    }
    setStatus(`Swapped key ${from + 1} and key ${to + 1}`);
  }

  function onKeyPointerDown(i: number, e: PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    dragOrigin.current = { x: e.clientX, y: e.clientY, i };
    dragKeyRef.current = null;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onKeyPointerMove(e: PointerEvent<HTMLButtonElement>) {
    const o = dragOrigin.current;
    if (!o) return;
    const dx = e.clientX - o.x;
    const dy = e.clientY - o.y;
    if (dragKeyRef.current == null) {
      if (dx * dx + dy * dy < 64) return;
      dragKeyRef.current = o.i;
      setDragKey(o.i);
      skipClick.current = true;
    }
    setDragPos({ x: e.clientX, y: e.clientY });
    const over = keyAtClient(e.clientX, e.clientY);
    setDropHover(over != null && over !== o.i ? over : null);
  }

  function endKeyDrag(e: PointerEvent<HTMLButtonElement>) {
    const from = dragKeyRef.current;
    dragOrigin.current = null;
    dragKeyRef.current = null;
    setDragPos(null);
    setDragKey(null);
    setDropHover(null);
    if (from == null) return;
    skipClick.current = true;
    const to = keyAtClient(e.clientX, e.clientY);
    if (to != null && to !== from) void swapKeys(from, to);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }

  async function linkProgram(index: number, path: string) {
    const cur = snapRef.current;
    if (!cur) {
      setErr("Connect the pad before linking a program.");
      return;
    }
    const p = cur.meta.active;
    setSel(index);
    setErr("");
    let resolved = { path, args: "" };
    try {
      resolved = await api.resolveProgram(path);
    } catch (e) {
      setErr(String(e));
      return;
    }
    const k = cur.keys[p]?.[index] ?? emptyKey(p, index);
    const next = makeLaunch(
      p,
      index,
      resolved.path,
      resolved.args.trim() ? resolved.args : "",
      k.acts.length,
    );
    await saveLaunch(next);
    setActPick({ kind: "launch", id: next.id ?? "" });
    if (!k.label.trim()) {
      const name = uniqueTitle(
        cur.keys[p] ?? [],
        index,
        stemName(next.path, titleMax),
        titleMax,
      );
      await pushKey({ ...k, label: name });
    }
    setStatus(`Linked ${baseName(next.path)} to key ${index + 1}`);
  }

  async function pushHdr(next: ProfileHdr) {
    const cur = snapRef.current;
    if (!cur) return;
    const copy: Snapshot = structuredClone(cur);
    copy.profiles[next.index] = next;
    copy.meta.dirty = true;
    setSnap(copy);
    hdrWait.current = next;
    if (hdrBusy.current) return;
    hdrBusy.current = true;
    try {
      while (hdrWait.current) {
        const send = hdrWait.current;
        hdrWait.current = null;
        try {
          await api.applyProfile(send);
        } catch (e) {
          setErr(String(e));
          break;
        }
      }
    } finally {
      hdrBusy.current = false;
      if (hdrWait.current) void pushHdr(hdrWait.current);
    }
  }

  async function persistSwitch(next: SwitchConfig) {
    setSwitchCfg(next);
    try {
      setSwitchCfg(await api.setSwitchRules(next));
    } catch (e) {
      const msg = String(e);
      if (!/reading 'invoke'|__TAURI_INTERNALS__/i.test(msg)) setErr(msg);
    }
  }

  async function onRemoveSwitchProgram(exe: string) {
    try {
      setSwitchCfg(await api.removeSwitchProgram(exe));
    } catch (e) {
      setErr(String(e));
    }
  }

  async function onExportPack(opts: PackOptions) {
    if (!snap) return;
    const pack = buildPack(snap, launches, switchCfg, opts);
    try {
      const path = await api.saveTextFile(suggestedFileName(pack), packToYaml(pack));
      if (path) {
        setStatus(
          simulated
            ? `Saved ${path}. Select a LogicPad, then Import… to program it.`
            : `Saved ${path}`,
        );
        setPackMode(null);
      }
    } catch (e) {
      setErr(String(e));
    }
  }

  async function onImportPick() {
    try {
      const loaded = await api.loadTextFile();
      if (!loaded) return;
      setImportDraft(yamlToPack(loaded[1]));
      setPackMode("import");
    } catch (e) {
      setErr(String(e));
    }
  }

  async function onImportPack(opts: PackOptions) {
    if (!snap || !importDraft) return;
    await run("", async () => {
      const packCount = importDraft.profiles?.length ?? 0;
      let destSnap = snap;
      const dests = [...opts.profileIndices];
      const keepActive = destSnap.meta.active;
      const wantSlots = opts.names || opts.actions || opts.leds || opts.lights || opts.launches;
      if (wantSlots) {
        while (packCount > dests.length) {
          const canAdd = destSnap.canAddProfiles ?? destSnap.profiles.length < 4;
          if (!canAdd) break;
          destSnap = await api.addProfile();
          const added = destSnap.profiles[destSnap.profiles.length - 1]?.index;
          if (added == null || dests.includes(added)) break;
          dests.push(added);
        }
        if (destSnap.meta.active !== keepActive) {
          await api.setActive(keepActive);
          destSnap = { ...destSnap, meta: { ...destSnap.meta, active: keepActive } };
        }
      }
      const result = applyPack(destSnap, launches, switchCfg, importDraft, {
        ...opts,
        profileIndices: dests,
      });
      const destSet = new Set(dests);
      if (opts.names || opts.lights) {
        for (const hdr of result.snap.profiles) {
          if (destSet.has(hdr.index)) await api.applyProfile(hdr);
        }
      }
      if (opts.names || opts.actions || opts.leds) {
        for (const idx of dests) {
          for (const key of result.snap.keys[idx] ?? []) {
            await api.applyKey(key);
          }
        }
      }
      if (opts.launches) {
        const tagged = result.launches.map((l) => withLaunchId(l));
        for (const idx of dests) {
          for (let k = 0; k < 9; k++) {
            for (const t of tombstonesForKey(launchesRef.current, idx, k)) {
              await api.setLaunch(t);
            }
            for (const l of tagged.filter((x) => x.profile === idx && x.key === k && x.path.trim())) {
              await api.setLaunch(l);
            }
          }
        }
        launchesRef.current = tagged;
        setLaunches(tagged);
      }
      if (opts.autoSwitch) {
        setSwitchCfg(await api.setSwitchRules(result.switchCfg));
      }
      snapRef.current = result.snap;
      setSnap(result.snap);
      const mapped = Math.min(packCount, dests.length);
      const onto = activePad?.label ?? "this pad";
      const saveHint = simulated ? "Save to keep this virtual keypad." : "Save to write the pad.";
      setStatus(
        wantSlots && packCount > mapped
          ? `Imported ${mapped} of ${packCount} profiles onto ${onto}. The pad is full — extra profiles were skipped. ${saveHint}`
          : `Imported onto ${onto}. ${saveHint}`,
      );
    });
    setPackMode(null);
    setImportDraft(null);
  }

  const bound = switchCfg.rules.filter((r) => r.profile === profile);
  const focusLabel = (() => {
    if (!focusNow?.exe) return null;
    const graph = ensureGraph(switchCfg);
    const cards = listRuleCards(graph);
    const stem = exeStem(focusNow.exe);
    const card = cards.find(
      (c) =>
        c.programs.some((p) => exeStem(p) === stem) ||
        c.andRunning?.some((p) => exeStem(p) === stem),
    );
    const profName =
      focusNow.profile != null
        ? snap?.profiles[focusNow.profile]?.name || `P${focusNow.profile + 1}`
        : null;
    if (card && profName) {
      return `Matched: ${exeDisplayName(card.programs[0] || focusNow.exe)} → ${profName}`;
    }
    if (profName) return `Now: ${focusNow.exe} → ${profName}`;
    return `Now: ${focusNow.exe}`;
  })();

  async function onAddProfile() {
    await run("Profile added", async () => {
      takePad(await api.addProfile());
      setSel(0);
    });
  }

  async function onDeleteProfile() {
    if (!snap) return;
    const name = hdr?.name || `P${profile + 1}`;
    if (!confirm(`Delete profile “${name}”? Its keys and typed text are removed.`)) {
      return;
    }
    await run("Profile deleted", async () => {
      takePad(await api.deleteProfile(profile));
      setLaunches(await api.getLaunches());
      setSwitchCfg(await api.getSwitchRules());
      setSel(0);
    });
  }

  async function onDuplicateProfile() {
    const cur = snapRef.current;
    if (!cur) return;
    const src = cur.meta.active;
    const srcHdr = cur.profiles[src];
    const srcKeys = cur.keys[src] ?? [];
    const srcLaunches = launchesRef.current.filter(
      (l) => l.profile === src && l.path.trim() !== "",
    );
    if (!srcHdr) return;
    await run("Profile copied", async () => {
      const next = await api.addProfile();
      const dest = next.meta.active;
      const others = next.profiles.filter((p) => p.index !== dest).map((p) => p.name);
      const name = srcHdr.name.trim()
        ? uniqueProfileName(others, srcHdr.name)
        : next.profiles[dest]?.name ?? "";
      await api.applyProfile({
        ...srcHdr,
        index: dest,
        name,
      });
      for (const k of srcKeys) {
        await api.applyKey({ ...structuredClone(k), profile: dest });
      }
      for (const l of srcLaunches) {
        await api.setLaunch({
          ...l,
          id: newLaunchId(),
          profile: dest,
        });
      }
      takePad(await api.loadPad());
      setLaunches(await api.getLaunches());
      setSel(0);
    });
  }

  async function onResetProfile() {
    if (!snapRef.current) return;
    const name = hdr?.name || `P${profile + 1}`;
    if (
      !confirm(
        `Reset profile “${name}”? Keys, typed text, and key LEDs are cleared. The name and light mode stay.`,
      )
    ) {
      return;
    }
    await run("Profile reset", async () => {
      for (const key of clearedKeys(profile)) {
        await api.applyKey(key);
      }
      const tombs = tombstonesForProfile(launchesRef.current, profile);
      for (const t of tombs) await api.setLaunch(t);
      launchesRef.current = removeProfileLaunches(launchesRef.current, profile);
      setLaunches(await api.getLaunches());
      takePad(await api.loadPad());
      setActPick(null);
      setSel(0);
    });
  }

  async function onFillLeds(led: number) {
    const cur = snapRef.current;
    if (!cur) return;
    const copy: Snapshot = structuredClone(cur);
    const row = copy.keys[profile] ?? [];
    for (let i = 0; i < 9; i++) {
      const k = row[i] ?? emptyKey(profile, i);
      row[i] = { ...k, led };
    }
    copy.keys[profile] = row;
    copy.meta.dirty = true;
    setSnap(copy);
    for (let i = 0; i < 9; i++) {
      const prev = cur.keys[profile]?.[i]?.led ?? 0;
      if (prev !== led) {
        try {
          await api.applyKey(row[i]);
        } catch (e) {
          setErr(String(e));
          break;
        }
      }
    }
  }

  async function onCopyLights(fromIndex: number) {
    const cur = snapRef.current;
    if (!cur || !hdr) return;
    const srcHdr = cur.profiles[fromIndex];
    const srcKeys = cur.keys[fromIndex];
    if (!srcHdr || !srcKeys) return;
    const nextHdr = {
      ...hdr,
      lightMode: srcHdr.lightMode,
      bright: srcHdr.bright,
      dim: srcHdr.dim,
    };
    const copy: Snapshot = structuredClone(cur);
    copy.profiles[hdr.index] = nextHdr;
    const row = (copy.keys[profile] ?? []).slice();
    for (let i = 0; i < 9; i++) {
      const k = row[i] ?? emptyKey(profile, i);
      row[i] = { ...k, led: srcKeys[i]?.led ?? 0 };
    }
    copy.keys[profile] = row;
    copy.meta.dirty = true;
    setSnap(copy);
    try {
      await api.applyProfile(nextHdr);
      for (let i = 0; i < 9; i++) {
        const prev = cur.keys[profile]?.[i]?.led ?? 0;
        const led = srcKeys[i]?.led ?? 0;
        if (prev !== led) await api.applyKey(row[i]);
      }
    } catch (e) {
      setErr(String(e));
    }
  }

  async function pushScreen(next: {
    contrast: number;
    flip: number;
    sleep: number;
    clockStyle: number;
  }) {
    const cur = snapRef.current;
    if (!cur) return;
    const copy: Snapshot = structuredClone(cur);
    copy.meta.contrast = next.contrast;
    copy.meta.flip = next.flip;
    copy.meta.sleep = next.sleep;
    copy.meta.clockStyle = next.clockStyle;
    copy.meta.dirty = true;
    snapRef.current = copy;
    setSnap(copy);
    screenWait.current = next;
    if (screenBusy.current) return;
    screenBusy.current = true;
    try {
      while (screenWait.current) {
        const send = screenWait.current;
        screenWait.current = null;
        try {
          await api.setScreen(send);
        } catch (e) {
          setErr(String(e));
          break;
        }
      }
    } finally {
      screenBusy.current = false;
      if (screenWait.current) void pushScreen(screenWait.current);
    }
  }

  async function onFlashFile(file: File) {
    if (simulated) {
      setErr("Can't update firmware on the simulated LogicPad. Plug in a pad and select it first.");
      return;
    }
    if (!confirm("Update firmware? The pad will reboot. Do not unplug until it reconnects.")) {
      return;
    }
    const targetId = activePad?.simulated ? null : activePad?.id;
    await run("Firmware updated", async () => {
      setFlash({ phase: "start", done: 0, total: 1 });
      setStatus("Starting firmware update…");
      try {
        const buf = new Uint8Array(await file.arrayBuffer());
        await api.flashFirmware(Array.from(buf));
        setStatus("Firmware written. Reconnecting…");
        setLinked(false);
        setSnap(null);
        setBaseline(null);
        let linkedOk = false;
        if (targetId) {
          for (let i = 0; i < 25; i++) {
            try {
              await api.connectTo(targetId);
              linkedOk = true;
              break;
            } catch {
              await new Promise((r) => window.setTimeout(r, 250));
            }
          }
        }
        if (!linkedOk) await api.connect();
        const pad = await api.currentPad().catch(() => undefined);
        await afterLink(pad?.simulated ? "Using simulated LogicPad" : "Connected");
      } finally {
        setFlash(null);
      }
    });
  }

  const flashPct = flash && flash.total ? Math.round((flash.done / flash.total) * 100) : 0;
  const mem = snap ? memoryOf(snap) : null;
  const typeValue = typeof actPick === "number" ? typedDisplayAt(key, actPick) : "";
  const typeBytes = utf8Len(poolOn ? key.text : typeValue);
  const typeRoom = snap ? roomForText(snap, profile, sel) : TEXT_MAX;
  const typeOver = poolOn && typeBytes > typeRoom;
  const typeHint = poolOn
    ? typeOver
      ? `Needs ${typeBytes} B, ${typeRoom} B free on the pad. Shorten this or another key.`
      : `One step in the macro (you can add more). Then add Enter or a shortcut. Shared ${mem?.textMax ?? TEXT_MAX} B, ${TEXT_MAX} B max on this key.`
    : typeValue.length > ACT_SLOTS
      ? `Only the first ${ACT_SLOTS} characters fit until you update firmware.`
      : `This firmware stores one tap per character (${ACT_SLOTS} max on this key). Update firmware for longer text.`;

  function addAct(a: Action) {
    if (key.acts.length >= ACT_SLOTS) return;
    const acts = [...key.acts, a];
    setActPick(acts.length - 1);
    void pushKey({ ...key, acts });
  }

  function patchAct(i: number, next: Action) {
    const acts = key.acts.slice();
    acts[i] = next;
    void pushKey({ ...key, acts });
  }

  function addLaunch() {
    const { list, draft } = addLaunchDraft(launches, profile, sel, key.acts.length);
    setLaunches(list);
    setActPick({ kind: "launch", id: draft.id ?? "" });
  }

  function writeLaunch(next: LaunchEntry) {
    setLaunches((list) => upsertLaunch(list, next, key.acts.length));
  }

  function persistLaunch(next: LaunchEntry) {
    const entry = withLaunchId({ ...next, slot: next.slot ?? 0 });
    writeLaunch(entry);
    if (entry.path.trim() || (entry.id ?? "").trim()) void saveLaunch(entry);
  }

  function moveStep(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= steps.length) return;
    const a = steps[idx];
    const b = steps[j];
    const n = key.acts.length;
    if (a.kind === "launch" && b.kind === "launch") {
      let mover = a.launch;
      if ((a.launch.slot ?? 0) === (b.launch.slot ?? 0)) {
        mover = nudgeLaunchSlot(a.launch, dir, n);
      } else {
        mover = { ...a.launch, slot: b.launch.slot };
        const other = { ...b.launch, slot: a.launch.slot };
        setLaunches((list) => upsertLaunch(upsertLaunch(list, mover, n), other, n));
        if (mover.path.trim()) void saveLaunch(mover);
        if (other.path.trim()) void saveLaunch(other);
        setActPick({ kind: "launch", id: mover.id ?? "" });
        return;
      }
      setLaunches((list) => upsertLaunch(list, mover, n));
      if (mover.path.trim()) void saveLaunch(mover);
      setActPick({ kind: "launch", id: mover.id ?? "" });
      return;
    }
    if (a.kind === "launch") {
      const entry = nudgeLaunchSlot(a.launch, dir, n);
      setLaunches((list) => upsertLaunch(list, entry, n));
      if (entry.path.trim()) void saveLaunch(entry);
      setActPick({ kind: "launch", id: entry.id ?? "" });
      return;
    }
    if (b.kind === "launch") {
      const entry = nudgeLaunchSlot(b.launch, (dir === 1 ? -1 : 1) as -1 | 1, n);
      setLaunches((list) => upsertLaunch(list, entry, n));
      if (entry.path.trim()) void saveLaunch(entry);
      setActPick(a.i);
      return;
    }
    setActPick(dir === 1 ? a.i + 1 : a.i - 1);
    void pushKey({ ...key, acts: moveAct(key.acts, a.i, dir) });
  }

  function removeStep(step: Step) {
    if (step.kind === "launch") {
      const id = step.launch.id ?? "";
      setLaunches((list) => list.filter((l) => l.id !== id));
      if (id) void saveLaunch({ ...step.launch, path: "" });
      setActPick(null);
      return;
    }
    const next = removeAct(key, step.i);
    const list = onActRemoved(launches, profile, sel, step.i, next.acts.length);
    setLaunches(list);
    for (const l of launchesOf(list, profile, sel)) {
      const old = mine.find((x) => x.id === l.id);
      if (old && old.slot !== l.slot && l.path.trim()) void saveLaunch(l);
    }
    setActPick(null);
    void pushKey(next);
  }

  function pickHid(hid: number) {
    setHidPick(hid);
    addAct({ type: ACT.key, mods, code: hid | (sendMode << 8) });
  }

  const pickedAct = typeof actPick === "number" ? key.acts[actPick] : undefined;
  const full = key.acts.length >= ACT_SLOTS;

  return (
    <>
    <div className="app-shell">
      <nav className="nav" aria-label="LogicPad">
        <div className="nav-brand">
          <LogicPadMark className="nav-mark" size={28} />
          <div>
            <h1>LogicPad</h1>
            <p>v0.1.0</p>
          </div>
        </div>
        <div className="nav-tabs">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tab === item.id ? "on" : ""}
              onClick={() => setTab(item.id)}
            >
              <TabGlyph tab={item.id} />
              {item.label}
            </button>
          ))}
        </div>
        <div className="nav-foot">
          <p className={`nav-link ${linked ? (simulated ? "sim" : "ok") : ""}`}>
            <span className="nav-dot" aria-hidden="true" />
            {simulated ? "Virtual keypad" : linked ? "LogicPad connected" : "Disconnected"}
          </p>
          {simulated ? (
            <p className="nav-meta">Virtual keypad on this PC — Save as… then Import on a pad</p>
          ) : activePad && !activePad.simulated ? (
            <p className="nav-meta">{activePad.label}</p>
          ) : null}
          <p className="nav-meta">{status}</p>
          {fwVer && !simulated ? <p className="nav-meta">Firmware {fwVer}</p> : null}
        </div>
      </nav>
      <div className="stage">
        <header className="topbar">
          {tab === "switch" ? (
            <div className="sw-top">
              <h2>Auto-switch</h2>
              <label className="sw-toggle">
                <span>Enable</span>
                <input
                  type="checkbox"
                  checked={switchCfg.enabled}
                  disabled={busy}
                  onChange={(e) => void persistSwitch({ ...switchCfg, enabled: e.target.checked })}
                />
                <em>{switchCfg.enabled ? "On" : "Off"}</em>
              </label>
              {focusLabel ? (
                <p className="sw-now">
                  <span className="sw-dot" aria-hidden="true" />
                  {focusLabel.replace(" → ", " -> ")}
                </p>
              ) : (
                <p className="sw-now mute">No matching rule</p>
              )}
            </div>
          ) : (
            <p className="topbar-status">{hdr ? hdr.name || `P${profile + 1}` : "LogicPad"}</p>
          )}
          <div className="bar">
            <PadSwitch
              pads={padOptions}
              activeId={activePad?.id ?? "sim"}
              simulated={simulated}
              linked={linked}
              disabled={busy || Boolean(flash)}
              onSelect={(id) => void selectPad(id)}
            />
            <span className="bar-split" aria-hidden="true" />
            <div className="bar-actions">
              <button
                disabled={busy || !snap}
                onClick={() =>
                  run("Saved", async () => {
                    await api.save();
                    takePad(await api.loadPad());
                  })
                }
              >
                Save
              </button>
              <button type="button" disabled={!snap} onClick={() => setPackMode("export")}>
                Save as…
              </button>
              <button type="button" disabled={!snap || busy} onClick={() => void onImportPick()}>
                Import…
              </button>
              <details className="more">
                <summary>More</summary>
                <div className="more-list">
                  <button
                    type="button"
                    disabled={busy || !snap}
                    onClick={() =>
                      run("Reloaded", async () => {
                        takePad(await api.reload());
                      })
                    }
                  >
                    Reload
                  </button>
                  <button type="button" disabled={!snap} onClick={() => setPrintOpen(true)}>
                    Print
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={busy || !snap}
                    onClick={() => {
                      if (!confirm("Reset all profiles to empty factory keys?")) return;
                      run("Factory reset", async () => {
                        takePad(await api.factory());
                      });
                    }}
                  >
                    Factory
                  </button>
                  <button
                    type="button"
                    disabled={busy || simulated}
                    title={
                      simulated
                        ? "Can't update firmware on the simulated LogicPad"
                        : "Write LogicPad.bin to the selected pad"
                    }
                    onClick={() => fwInput.current?.click()}
                  >
                    {flash ? `Updating ${flashPct}%` : "Update firmware"}
                  </button>
                </div>
              </details>
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
            </div>
            <SyncBadge status={syncStatus({ linked, snap, baseline })} />
          </div>
        </header>
        {simulated && snap ? (
          <div className="sim-banner" role="status">
            Virtual keypad — on this PC, not USB. Use <strong>Save as…</strong> for a
            YAML file, switch to a USB LogicPad, then <strong>Import…</strong> to program it.
          </div>
        ) : null}
        {flash ? (
          <div className="flash">
            <div className="flash-track">
              <div className="flash-fill" style={{ width: `${flashPct}%` }} />
            </div>
          </div>
        ) : null}
        {err ? <div className="err">{err}</div> : null}

      <div className="stage-body">
      {tab === "switch" ? (
            <SwitchEditor
              key={activePad?.id ?? "none"}
              open
              cfg={switchCfg}
              profiles={snap?.profiles ?? []}
              keys={snap?.keys ?? []}
              busy={busy}
              enabled={switchCfg.enabled}
              onChange={(next) => void persistSwitch(next)}
              onStatus={setStatus}
              onLights={(nextHdr, leds) => {
                void pushHdr(nextHdr);
                const cur = snapRef.current;
                if (!leds || !cur) return;
                for (let i = 0; i < 9; i++) {
                  const k = cur.keys[nextHdr.index]?.[i];
                  if (k && k.led !== leds[i]) void pushKey({ ...k, led: leds[i] });
                }
              }}
              listWindows={() => api.listOpenWindows()}
              pickProgram={() => api.pickProgram()}
            />
      ) : !snap ? (
        <section className="hero">
          <p>
            {busy
              ? "Loading the pad…"
              : "Plug a LogicPad in over USB, or open the simulated pad to program keys and profiles on this PC."}
          </p>
          <button className="primary" disabled={busy} onClick={() => void selectPad("sim")}>
            {busy ? "Connecting…" : "Open simulated LogicPad"}
          </button>
          <button disabled={busy} onClick={() => void onConnect()}>
            {busy ? "Connecting…" : "Connect USB pad"}
          </button>
        </section>
      ) : (
        <>
          {tab === "keys" ? (
            <div className="pane-keys">
          <section className="pad">
            <div className="keys-head">
              <h2>Keys</h2>
              <ClearAllButton
                disabled={busy || !snap}
                profileName={hdr?.name || `P${profile + 1}`}
                onClear={() =>
                  run("Cleared keys", async () => {
                    for (const key of clearedKeys(profile)) {
                      await api.applyKey(key);
                      const tombs = tombstonesForKey(launchesRef.current, profile, key.index);
                      for (const t of tombs) await api.setLaunch(t);
                      launchesRef.current = removeKeyLaunches(
                        launchesRef.current,
                        profile,
                        key.index,
                      );
                    }
                    setLaunches(await api.getLaunches());
                    takePad(await api.loadPad());
                    setActPick(null);
                  })
                }
              />
            </div>
            <div className="keys-profiles">
              {snap.profiles.map((p) => (
                <button
                  key={p.index}
                  type="button"
                  className={p.index === profile ? "on" : ""}
                  disabled={busy}
                  onClick={() => void activateProfile(p.index)}
                >
                  {p.name || `P${p.index + 1}`}
                </button>
              ))}
              {snap.canMutateProfiles ? (
                <button
                  type="button"
                  className="keys-new-profile"
                  disabled={busy || !(snap.canAddProfiles ?? snap.profiles.length < 4)}
                  onClick={() => void onAddProfile()}
                >
                  New profile
                </button>
              ) : null}
            </div>
            <p className="hint">
              Click a key, then add a tap, chord, or typed text on the right.
            </p>
            {mem ? (
              <div className="mem">
                {mem.storeMax > 0 ? (
                  <MemBar label="Pad memory" used={mem.store} max={mem.storeMax} unit="B" />
                ) : null}
                <MemBar
                  label="Type text"
                  used={mem.text}
                  max={mem.textMax}
                  unit="B"
                  warn={
                    mem.poolEnabled
                      ? undefined
                      : "Update firmware to store longer strings in flash."
                  }
                />
                <p className="hint">
                  Drop a program onto a key to add a launch step, or drag one key onto another to
                  swap them. Profiles, macros, and type-text share the pad&apos;s flash slot.
                </p>
              </div>
            ) : null}
            <div
              className="grid"
              onContextMenu={(e) => {
                const t = preventGridMenu(e);
                setKeyMenu(t);
                if (t) setSel(t.index);
              }}
            >
              {Array.from({ length: 9 }, (_, i) => {
                const k = keys[i] ?? emptyKey(profile, i);
                const tlen = utf8Len(k.text);
                const fill = Math.max(
                  tlen / TEXT_MAX,
                  k.acts.length / ACT_SLOTS,
                );
                const cls = [
                  "key",
                  sel === i ? "on" : "",
                  dropHover === i ? "drop" : "",
                  dragKey === i ? "dragging" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <button
                    key={i}
                    data-key={i}
                    className={cls}
                    onClick={() => {
                      if (skipClick.current) {
                        skipClick.current = false;
                        return;
                      }
                      setSel(i);
                    }}
                    onPointerDown={(e) => onKeyPointerDown(i, e)}
                    onPointerMove={onKeyPointerMove}
                    onPointerUp={endKeyDrag}
                    onPointerCancel={endKeyDrag}
                  >
                    <span className="idx">{i + 1}</span>
                    <span className={k.label.length > 8 ? "lab long" : "lab"}>
                      {k.label || "—"}
                    </span>
                    <span className="tags">
                      {keyHasLaunch(launches, profile, i) ? <span className="run">app</span> : null}
                      {tlen ? <span className="run">text</span> : null}
                    </span>
                    {fill > 0 ? (
                      <span className="key-use">
                        <span style={{ width: `${Math.min(100, Math.round(fill * 100))}%` }} />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {dragKey != null && dragPos ? (
              <div
                className="key-ghost"
                style={{ left: dragPos.x, top: dragPos.y }}
              >
                {keys[dragKey]?.label || `Key ${dragKey + 1}`}
              </div>
            ) : null}
            {keyMenu ? (
              <KeyContextMenu
                open={keyMenu}
                keyData={keys[keyMenu.index] ?? emptyKey(profile, keyMenu.index)}
                launches={launches.filter(
                  (l) => l.profile === profile && l.key === keyMenu.index,
                )}
                profileKeys={keys}
                profileLaunches={launches.filter((l) => l.profile === profile)}
                onClose={() => setKeyMenu(null)}
                onClear={(index) => {
                  void pushKey(emptyKey(profile, index));
                  const tombs = tombstonesForKey(launchesRef.current, profile, index);
                  for (const t of tombs) void saveLaunch(t);
                  const next = removeKeyLaunches(launchesRef.current, profile, index);
                  launchesRef.current = next;
                  setLaunches(next);
                }}
                onApply={(index, nextKey, nextLaunches) => {
                  const cur = snapRef.current;
                  if (!cur) return;
                  const labeled = { ...nextKey, index };
                  const copy: Snapshot = structuredClone(cur);
                  copy.keys[nextKey.profile][index] = labeled;
                  copy.meta.dirty = true;
                  snapRef.current = copy;
                  setSnap(copy);
                  void api.applyKey(labeled).catch((e) => setErr(String(e)));
                  const tombs = tombstonesForKey(launchesRef.current, nextKey.profile, index);
                  for (const t of tombs) void api.setLaunch(t);
                  let list = removeKeyLaunches(launchesRef.current, nextKey.profile, index);
                  for (const l of nextLaunches.filter((x) => x.path.trim())) {
                    const entry = makeLaunch(
                      nextKey.profile,
                      index,
                      l.path,
                      l.args,
                      l.slot ?? 0,
                    );
                    list = upsertLaunch(list, entry, labeled.acts.length);
                    void api.setLaunch(entry);
                  }
                  launchesRef.current = list;
                  setLaunches(list);
                }}
              />
            ) : null}
          </section>

          <section className="edit" data-key={sel}>
            <h2>Key {sel + 1}</h2>
            <label>
              Label
              <input
                maxLength={titleMax}
                value={key.label}
                onChange={(e) => {
                  const next = { ...key, label: e.target.value };
                  const copy = structuredClone(snap);
                  copy.keys[profile][sel] = next;
                  setSnap(copy);
                  setErr("");
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
            <h3>Actions</h3>
            <p className="hint">
              Pad steps run top to bottom on the device. Launch opens on this PC when you press the
              key — keep LogicPad running (tray is enough).
            </p>
            <ul className="acts">
              {steps.length === 0 ? <li className="empty">No actions</li> : null}
              {steps.map((step, i) => {
                const selected =
                  step.kind === "launch"
                    ? typeof actPick === "object" &&
                      actPick?.kind === "launch" &&
                      actPick.id === step.launch.id
                    : actPick === step.i;
                const clip = (s: string) => {
                  const t = s.replace(/\s+/g, " ").trim();
                  return t.length <= 40 ? t : `${t.slice(0, 39).trimEnd()}…`;
                };
                const label =
                  step.kind === "launch"
                    ? step.launch.path
                      ? `Launch ${baseName(step.launch.path)}`
                      : "Launch program"
                    : step.a.type === ACT.text
                      ? (() => {
                          const t = clip(segmentOf(key, step.i));
                          return t ? `Type “${t}”` : "Type text";
                        })()
                      : fmtAct(step.a);
                return (
                  <li
                    key={
                      step.kind === "launch"
                        ? `launch-${step.launch.id}`
                        : `act-${step.i}-${step.a.type}-${step.a.code}`
                    }
                    className={selected ? "on" : ""}
                    onClick={() =>
                      setActPick(
                        step.kind === "launch"
                          ? { kind: "launch", id: step.launch.id ?? "" }
                          : step.i,
                      )
                    }
                  >
                    <span
                      className="act-name"
                      title={step.kind === "launch" ? step.launch.path : label}
                    >
                      {step.kind === "launch" ? <span className="run">pc</span> : null}
                      <span className="act-label">{label}</span>
                    </span>
                    <span className="act-tools">
                      <button
                        disabled={i === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          moveStep(i, -1);
                        }}
                      >
                        ↑
                      </button>
                      <button
                        disabled={i === steps.length - 1}
                        onClick={(e) => {
                          e.stopPropagation();
                          moveStep(i, 1);
                        }}
                      >
                        ↓
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeStep(step);
                        }}
                      >
                        ×
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
            {pickedLaunch ? (
              <div className="step-edit">
                <p className="hint">
                  Drop a program or shortcut onto the key, or browse. Shortcuts resolve to the real
                  executable.
                </p>
                <label>
                  Program
                  <input
                    value={pickedLaunch.path}
                    placeholder="C:\Path\app.exe"
                    onChange={(e) => writeLaunch({ ...pickedLaunch, path: e.target.value })}
                    onBlur={(e) => persistLaunch({ ...pickedLaunch, path: e.target.value })}
                  />
                </label>
                <div className="add">
                  <button
                    onClick={async () => {
                      const path = await api.pickProgram();
                      if (!path) return;
                      try {
                        const resolved = await api.resolveProgram(path);
                        persistLaunch({
                          ...pickedLaunch,
                          path: resolved.path,
                          args: resolved.args.trim() ? resolved.args : pickedLaunch.args,
                        });
                      } catch (e) {
                        setErr(String(e));
                      }
                    }}
                  >
                    Browse…
                  </button>
                </div>
                <label>
                  Arguments
                  <input
                    value={pickedLaunch.args}
                    placeholder="optional"
                    onChange={(e) => writeLaunch({ ...pickedLaunch, args: e.target.value })}
                    onBlur={(e) => persistLaunch({ ...pickedLaunch, args: e.target.value })}
                  />
                </label>
              </div>
            ) : null}
            {pickedAct?.type === ACT.text ? (
              <div className="step-edit">
                <p className={`hint ${typeOver ? "hot" : ""}`}>{typeHint}</p>
                <textarea
                  className={typeOver ? "over" : ""}
                  rows={4}
                  spellCheck={false}
                  placeholder="Typed as its own step in the list"
                  value={typeValue}
                  onChange={(e) => {
                    if (!snap || typeof actPick !== "number") return;
                    const next = setSegment(key, actPick, e.target.value, poolOn, typeRoom);
                    const copy = structuredClone(snap);
                    copy.keys[profile][sel] = next;
                    copy.meta.dirty = true;
                    setSnap(copy);
                    setErr("");
                  }}
                  onBlur={() => {
                    if (typeOver) return;
                    const k = snapRef.current?.keys[profile]?.[sel];
                    if (k) void pushKey(k);
                  }}
                />
                <p className="mem-lab tight">
                  <span>
                    This key {poolOn ? `${typeBytes} B` : `${key.acts.length} / ${ACT_SLOTS} slots`}
                  </span>
                  {poolOn ? <span>{typeRoom} B free for this key</span> : null}
                </p>
              </div>
            ) : null}
            {pickedAct?.type === ACT.delay ? (
              <div className="step-edit">
                <label>
                  Wait (ms)
                  <input
                    type="number"
                    min={0}
                    max={65535}
                    value={pickedAct.code}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (!Number.isFinite(n)) return;
                      patchAct(actPick as number, {
                        ...pickedAct,
                        code: Math.max(0, Math.min(65535, Math.round(n))),
                      });
                    }}
                  />
                </label>
              </div>
            ) : null}

            <h3>Add</h3>
            <div className="palette">
              <div className="pal-row">
                <span>Program</span>
                <div className="add">
                  <button onClick={() => addLaunch()}>
                    Launch
                  </button>
                </div>
              </div>
              <div className="pal-row">
                <span>Text</span>
                <div className="add">
                  <button
                    disabled={full}
                    title={
                      full
                        ? `This key already has ${ACT_SLOTS} pad steps.`
                        : "Add another string to type"
                    }
                    onClick={() => {
                      const next = addTextAct(key, poolOn);
                      setActPick(next.acts.length - 1);
                      void pushKey(next);
                    }}
                  >
                    Type text
                  </button>
                </div>
              </div>
              <div className="pal-row">
                <span>Wait</span>
                <div className="add">
                  <button disabled={full} onClick={() => addAct({ type: ACT.delay, mods: 0, code: 50 })}>
                    50 ms
                  </button>
                  <button disabled={full} onClick={() => addAct({ type: ACT.delay, mods: 0, code: 200 })}>
                    200 ms
                  </button>
                </div>
              </div>
              <div className="pal-row">
                <span>Mouse</span>
                <div className="add">
                  <button
                    disabled={full}
                    onClick={() => addAct({ type: ACT.mouseBtn, mods: 1, code: SEND.tap << 8 })}
                  >
                    Click
                  </button>
                  <button
                    disabled={full}
                    onClick={() => addAct({ type: ACT.mouseMove, mods: 0, code: 10 })}
                  >
                    Move
                  </button>
                  <button
                    disabled={full}
                    onClick={() => addAct({ type: ACT.wheel, mods: 0, code: 0xff })}
                  >
                    Wheel
                  </button>
                </div>
              </div>
              <div className="pal-row">
                <span>Media</span>
                <div className="add">
                  {MEDIA.map((m) => (
                    <button
                      key={m.usage}
                      disabled={full}
                      onClick={() => addAct({ type: ACT.consumer, mods: SEND.tap, code: m.usage })}
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <h3>Keyboard</h3>
            <p className="hint">
              Check Ctrl / Shift / Alt / Win, then click a key. Sys keys can also be added on their
              own (Alt + Tab).
            </p>
            <div className="send">
              {(
                [
                  [SEND.tap, "Tap"],
                  [SEND.down, "Down"],
                  [SEND.up, "Up"],
                ] as const
              ).map(([mode, name]) => (
                <button
                  key={name}
                  className={sendMode === mode ? "on" : ""}
                  onClick={() => setSendMode(mode)}
                >
                  {name}
                </button>
              ))}
            </div>
            <div className="mods">
              {(
                [
                  [1, "Ctrl"],
                  [2, "Shift"],
                  [4, "Alt"],
                  [8, "Win"],
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
            <h4>Sys</h4>
            <div className="letters specials">
              {HID_SPECIALS.map((h) => (
                <button
                  key={h.name}
                  onClick={() =>
                    addAct({
                      type: ACT.key,
                      mods: mods | h.mods,
                      code: h.hid | (sendMode << 8),
                    })
                  }
                >
                  {h.name}
                </button>
              ))}
            </div>
            <h4>Letters</h4>
            <HidPad keys={HID_ALPHA} selected={hidPick} onPick={pickHid} />
            <h4>Numbers</h4>
            <HidPad keys={HID_DIGIT} selected={hidPick} onPick={pickHid} />
            <h4>Navigation</h4>
            <HidPad keys={HID_NAV} selected={hidPick} onPick={pickHid} />
            <h4>Function</h4>
            <HidPad keys={HID_FN} selected={hidPick} onPick={pickHid} />
            <h4>Other</h4>
            <HidPad keys={HID_MORE} selected={hidPick} onPick={pickHid} />
          </section>
            </div>
          ) : null}

          {tab === "profiles" ? (
            <ProfilesPane
              snap={snap}
              hdr={hdr}
              keys={keys}
              bound={bound}
              busy={busy}
              simulated={simulated}
              memHint={`${snap.profiles.length} profile${snap.profiles.length === 1 ? "" : "s"} on the pad${mem?.storeMax ? ` · ${mem.store} / ${mem.storeMax} B used` : ""}.`}
              onActivate={(index) => void activateProfile(index)}
              onAdd={() => void onAddProfile()}
              onDuplicate={() => void onDuplicateProfile()}
              onReset={() => void onResetProfile()}
              onDelete={() => void onDeleteProfile()}
              onDraftName={(name) => {
                if (!hdr) return;
                const next = { ...hdr, name };
                const copy = structuredClone(snap);
                copy.profiles[hdr.index] = next;
                setSnap(copy);
              }}
              onHdr={(next) => void pushHdr(next)}
              onKeyLed={(key, led) => void pushKey({ ...key, led })}
              onFillLeds={(led) => void onFillLeds(led)}
              onCopyLights={(from) => void onCopyLights(from)}
              onScreen={(next) => void pushScreen(next)}
              onRemoveSwitch={(exe) => void onRemoveSwitchProgram(exe)}
              onOpenSwitch={() => setTab("switch")}
            />
          ) : null}
        </>
      )}
      </div>
      </div>
    </div>
    {printOpen && snap ? (
      <PrintOverlay
        snap={snap}
        launches={launches}
        allProfiles={printAll}
        onAllProfiles={setPrintAll}
        onClose={() => setPrintOpen(false)}
        onPrint={() => window.print()}
      />
    ) : null}
    {snap ? (
      <PackDialog
        mode={packMode}
        snap={snap}
        launches={launches}
        switchCfg={switchCfg}
        importDraft={importDraft}
        padLabel={activePad?.label ?? (simulated ? "Simulated LogicPad" : "this pad")}
        simulated={simulated}
        onClose={() => {
          setPackMode(null);
          setImportDraft(null);
        }}
        onExport={(opts) => void onExportPack(opts)}
        onImport={(opts) => void onImportPack(opts)}
      />
    ) : null}
    </>
  );
}
