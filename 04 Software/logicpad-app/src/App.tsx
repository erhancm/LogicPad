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
  LIGHT_MODES,
  MEDIA,
  SEND,
  type Action,
  type HidKey,
  type LaunchEntry,
  type PadKey,
  type ProfileHdr,
  type Snapshot,
  type SwitchConfig,
  type SwitchFocus,
} from "./types";
import { PrintOverlay } from "./PrintSheet";
import { ClearAllButton, clearedKeys } from "./ClearAllButton";
import {
  KeyContextMenu,
  preventGridMenu,
  type KeyMenuTarget,
} from "./KeyContextMenu";
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
  nudgeLaunchSlot,
  onActRemoved,
  remapKeyLaunches,
  removeKeyLaunches,
  tombstonesForKey,
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
  uniqueTitle,
  utf8Len,
  withTextStep,
} from "./text";

const LED_HEX = ["#2a2e38", "#e8e4d8", "#c04040", "#40a060", "#3a7ec0"];

function emptyKey(profile: number, index: number): PadKey {
  return { profile, index, label: "", led: 0, acts: [], text: "" };
}

type AppTab = "keys" | "profiles" | "switch" | "lights";

const TABS: { id: AppTab; label: string }[] = [
  { id: "keys", label: "Keys" },
  { id: "profiles", label: "Profiles" },
  { id: "switch", label: "Auto-switch" },
  { id: "lights", label: "Lights" },
];

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
  if (tab === "switch") {
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
  return (
    <svg {...common} aria-hidden="true">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5 v2 M8 12.5 v2 M1.5 8 h2 M12.5 8 h2 M3.2 3.2 l1.4 1.4 M11.4 11.4 l1.4 1.4 M3.2 12.8 l1.4 -1.4 M11.4 4.6 l1.4 -1.4" />
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

  function takePad(next: Snapshot) {
    setSnap(next);
    setBaseline(cloneSnap(next));
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true);
    setErr("");
    try {
      await fn();
      setStatus(label);
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

  async function onConnect() {
    await run("Connected", async () => {
      await api.connect();
      try {
        await syncPadTime();
      } catch {
        /* old firmware / app without SET_TIME */
      }
      takePad(await api.loadPad());
      setLinked(true);
    });
  }

  useEffect(() => {
    void onConnect();
    void api.getLaunches().then(setLaunches).catch(() => undefined);
    void api.getSwitchRules().then(setSwitchCfg).catch(() => undefined);
    // Connect once on launch; retry with the button if the pad was unplugged.
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
          if (Array.isArray(ver) && ver.length >= 2) setFwVer(`${ver[0]}.${ver[1]}`);
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
          setLinked(false);
          setFwVer(null);
          setStatus("Pad disconnected");
        });
    }, 2000);
    return () => window.clearInterval(id);
  }, [linked, busy, flash]);

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
        setStatus(`Saved ${path}`);
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
    const result = applyPack(snap, launches, switchCfg, importDraft, opts);
    await run("Imported", async () => {
      const dests = new Set(opts.profileIndices);
      if (opts.names || opts.lights) {
        for (const hdr of result.snap.profiles) {
          if (dests.has(hdr.index)) await api.applyProfile(hdr);
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
    });
    setPackMode(null);
    setImportDraft(null);
  }

  const bound = switchCfg.rules.filter((r) => r.profile === profile);
  const focusLabel = focusNow?.exe
    ? focusNow.profile != null
      ? `Now: ${focusNow.exe} → ${snap?.profiles[focusNow.profile]?.name || `P${focusNow.profile + 1}`}`
      : `Now: ${focusNow.exe}`
    : null;

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

  async function onFlashFile(file: File) {
    if (!confirm("Update firmware? The pad will reboot. Do not unplug until it reconnects.")) {
      return;
    }
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
        await api.connect();
        try {
          await syncPadTime();
        } catch {
          /* old firmware / app without SET_TIME */
        }
        takePad(await api.loadPad());
        setLinked(true);
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
          <span className="nav-mark" aria-hidden="true">
            L
          </span>
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
          <p className={`nav-link ${linked ? "ok" : ""}`}>
            <span className="nav-dot" aria-hidden="true" />
            {linked ? "LogicPad connected" : "Disconnected"}
          </p>
          <p className="nav-meta">{status}</p>
          {fwVer ? <p className="nav-meta">Firmware {fwVer}</p> : null}
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
                <p className="sw-now mute">Now: no matching window</p>
              )}
            </div>
          ) : (
            <p className="topbar-status">{hdr ? hdr.name || `P${profile + 1}` : "LogicPad"}</p>
          )}
          <div className="bar">
            {tab !== "switch" ? (
            <button
              disabled={busy || linked}
              title={linked ? "Already connected" : "Connect to LogicPad"}
              onClick={onConnect}
            >
              {linked ? "Connected" : "Connect"}
            </button>
            ) : null}
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
                <button type="button" disabled={!snap} onClick={() => setPackMode("export")}>
                  Save as…
                </button>
                <button type="button" disabled={!snap || busy} onClick={() => void onImportPick()}>
                  Import…
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
                <button type="button" disabled={busy} onClick={() => fwInput.current?.click()}>
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
            <SyncBadge status={syncStatus({ linked, snap, baseline })} />
          </div>
        </header>
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
              open
              cfg={switchCfg}
              profiles={snap?.profiles ?? []}
              keys={snap?.keys ?? []}
              busy={busy}
              onChange={(next) => void persistSwitch(next)}
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
          <p>Plug the pad in over USB, then connect. The editor loads profiles and keys from the device.</p>
          <button className="primary" disabled={busy} onClick={onConnect}>
            {busy ? "Connecting…" : "Connect to LogicPad"}
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
            <section className="pane">
              <h2>Profiles</h2>
              <p className="hint">
                {snap.profiles.length} profile{snap.profiles.length === 1 ? "" : "s"} on the pad
                {mem?.storeMax ? ` · ${mem.store} / ${mem.storeMax} B used` : ""}.
              </p>
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
              {snap.canMutateProfiles ? (
                <div className="add">
                  <button
                    disabled={busy || !(snap.canAddProfiles ?? snap.profiles.length < 4)}
                    onClick={() => void onAddProfile()}
                  >
                    New profile
                  </button>
                  <button
                    className="danger"
                    disabled={busy || snap.profiles.length <= 1}
                    onClick={() => void onDeleteProfile()}
                  >
                    Delete
                  </button>
                </div>
              ) : (
                <p className="hint">Update firmware to add or delete profiles.</p>
              )}
              {hdr ? (
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
              ) : null}
              <h3>This profile in Auto-switch</h3>
              {bound.length ? (
                <ul className="switch-list">
                  {bound.map((r) => (
                    <li key={r.exe}>
                      <span title={r.exe}>{r.exe}</span>
                      <button type="button" disabled={busy} onClick={() => void onRemoveSwitchProgram(r.exe)}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="hint">No programs for this profile in the graph.</p>
              )}
              <div className="add">
                <button type="button" onClick={() => setTab("switch")}>
                  Open Auto-switch
                </button>
              </div>
            </section>
          ) : null}

          {tab === "lights" ? (
            <section className="pane">
              <h2>Lights</h2>
              <p className="hint">Lighting for {hdr?.name || `P${profile + 1}`}. Per-key LEDs also live on each key.</p>
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
                        setSnap(next);
                        setSel(0);
                      })
                    }
                  >
                    {p.name || `P${p.index + 1}`}
                  </button>
                ))}
              </div>
              {hdr ? (
                <>
                  <label>
                    Mode
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
                      onChange={(e) => void pushHdr({ ...hdr, bright: Number(e.target.value) })}
                    />
                  </label>
                  <label>
                    Dim {hdr.dim}
                    <input
                      type="range"
                      min={0}
                      max={10}
                      value={hdr.dim}
                      onChange={(e) => void pushHdr({ ...hdr, dim: Number(e.target.value) })}
                    />
                  </label>
                </>
              ) : null}
              <h3>Key LEDs</h3>
              <div className="light-grid">
                {Array.from({ length: 9 }, (_, i) => {
                  const k = keys[i] ?? emptyKey(profile, i);
                  return (
                    <button
                      key={i}
                      type="button"
                      className="sw-led light-cell"
                      style={{ background: LED_HEX[k.led] ?? LED_HEX[0] }}
                      title={`${k.label || `Key ${i + 1}`} — ${LEDS[k.led] ?? "Off"}`}
                      onClick={() => void pushKey({ ...k, led: (k.led + 1) % LEDS.length })}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>
            </section>
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
