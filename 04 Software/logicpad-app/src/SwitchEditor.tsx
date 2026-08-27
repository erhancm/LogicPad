import { useEffect, useRef, useState, type PointerEvent as PE } from "react";
import { LEDS, LIGHT_MODES, type PadKey, type ProfileHdr, type SwitchConfig, type SwitchGraph, type SwitchNode } from "./types";
import { ensureGraph, newId, withGraph } from "./switchGraph";
import { RunningPicker, type OpenWindow } from "./RunningPicker";
import "./SwitchEditor.css";

const LED_HEX = ["#2a2e38", "#e8e4d8", "#c04040", "#40a060", "#3a7ec0"];

const NODE_SIZE: Record<SwitchNode["kind"], { w: number; h: number }> = {
  foreground: { w: 236, h: 132 },
  running: { w: 236, h: 132 },
  and: { w: 112, h: 56 },
  or: { w: 112, h: 56 },
  setProfile: { w: 248, h: 248 },
  restore: { w: 228, h: 108 },
};

function wirePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(48, Math.abs(x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function portPos(node: SwitchNode, side: "in" | "out"): { x: number; y: number } {
  const { w, h } = NODE_SIZE[node.kind];
  return {
    x: node.x + (side === "in" ? 0 : w),
    y: node.y + h / 2,
  };
}

function hasOut(n: SwitchNode): boolean {
  return n.kind !== "setProfile" && n.kind !== "restore";
}

function hasIn(n: SwitchNode): boolean {
  return n.kind !== "foreground" && n.kind !== "running";
}

function exeKey(exe: string): string {
  return exe.replace(/^.*[\\/]/, "").toLowerCase();
}

function stemName(exe: string): string {
  return exe.replace(/^.*[\\/]/, "").replace(/\.exe$/i, "");
}

type ChipLook = { title: string; img?: string };

function bmpSrc(b64?: string): string | undefined {
  return b64 ? `data:image/bmp;base64,${b64}` : undefined;
}

function lookFromWindow(w: OpenWindow): ChipLook {
  return {
    title: w.title || stemName(w.exe || w.path),
    img: bmpSrc(w.thumbBmp) ?? bmpSrc(w.iconBmp),
  };
}

type LightsCb = (hdr: ProfileHdr, leds: number[] | undefined) => void;

const ADD_KINDS: { kind: SwitchNode["kind"]; label: string }[] = [
  { kind: "foreground", label: "Foreground is" },
  { kind: "running", label: "Running is" },
  { kind: "and", label: "AND" },
  { kind: "or", label: "OR" },
  { kind: "setProfile", label: "Set profile" },
  { kind: "restore", label: "Restore previous" },
];

export function SwitchEditor(props: {
  open: boolean;
  cfg: SwitchConfig;
  profiles: ProfileHdr[];
  keys: PadKey[][];
  focusLabel?: string | null;
  busy?: boolean;
  onChange: (cfg: SwitchConfig) => void;
  onLights: LightsCb;
  listWindows: () => Promise<OpenWindow[]>;
  pickProgram: () => Promise<string | null>;
}) {
  const { open, cfg, profiles, keys, focusLabel, busy, onChange, onLights, listWindows, pickProgram } = props;
  const [graph, setGraph] = useState(() => ensureGraph(cfg));
  const [pan, setPan] = useState({ x: 32, y: 28 });
  const [sel, setSel] = useState<string | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [pickNode, setPickNode] = useState<string | null>(null);
  const [windows, setWindows] = useState<OpenWindow[]>([]);
  const [winLoad, setWinLoad] = useState(false);
  const [winErr, setWinErr] = useState("");
  const [looks, setLooks] = useState<Record<string, ChipLook>>({});
  const [addOpen, setAddOpen] = useState(false);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const panning = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const graphRef = useRef(graph);
  graphRef.current = graph;

  useEffect(() => {
    if (open) {
      setGraph(ensureGraph(cfg));
      setSel(null);
      setLinkFrom(null);
      setAddOpen(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (pickNode) setPickNode(null);
        else if (linkFrom) setLinkFrom(null);
        else if (addOpen) setAddOpen(false);
        else setSel(null);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && sel && !pickNode) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
        removeNode(sel);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, sel, pickNode, linkFrom, addOpen, graph]);

  if (!open) return null;

  function commit(next: SwitchGraph, persist = true) {
    setGraph(next);
    graphRef.current = next;
    if (persist) onChange(withGraph(cfg, next));
  }

  function patchNode(id: string, fn: (n: SwitchNode) => SwitchNode) {
    commit({
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === id ? fn(n) : n)),
    });
  }

  function rememberLooks(list: OpenWindow[]) {
    setLooks((prev) => {
      const next = { ...prev };
      for (const w of list) {
        const key = exeKey(w.exe || w.path);
        if (!key) continue;
        next[key] = lookFromWindow(w);
      }
      return next;
    });
  }

  function addNode(kind: SwitchNode["kind"]) {
    setAddOpen(false);
    const id = newId(kind.slice(0, 2));
    const x = 80 - pan.x + graph.nodes.length * 12;
    const y = 80 - pan.y + graph.nodes.length * 16;
    const pri =
      Math.max(0, ...graph.nodes.map((n) => (n.kind === "setProfile" || n.kind === "restore" ? n.priority : -1))) + 1;
    let node: SwitchNode;
    if (kind === "foreground") node = { kind, id, x, y, programs: [] };
    else if (kind === "running") node = { kind, id, x, y, programs: [] };
    else if (kind === "and" || kind === "or") node = { kind, id, x, y };
    else if (kind === "restore") node = { kind, id, x, y, priority: Math.min(pri, 255) };
    else {
      node = {
        kind: "setProfile",
        id,
        x,
        y,
        profile: profiles[0]?.index ?? 0,
        priority: Math.min(pri, 255),
        lightMode: profiles[0]?.lightMode,
        bright: profiles[0]?.bright,
        dim: profiles[0]?.dim,
      };
    }
    commit({ ...graph, nodes: [...graph.nodes, node] });
    setSel(id);
  }

  function removeNode(id: string) {
    commit({
      nodes: graph.nodes.filter((n) => n.id !== id),
      edges: graph.edges.filter((e) => e.from !== id && e.to !== id),
    });
    if (sel === id) setSel(null);
  }

  function tryLink(from: string, to: string) {
    setLinkFrom(null);
    if (from === to) return;
    const a = graph.nodes.find((n) => n.id === from);
    const b = graph.nodes.find((n) => n.id === to);
    if (!a || !b || !hasOut(a) || !hasIn(b)) return;
    if (graph.edges.some((e) => e.from === from && e.to === to)) return;
    commit({ ...graph, edges: [...graph.edges, { id: newId("e"), from, to }] });
  }

  function onPort(id: string, side: "in" | "out") {
    if (side === "out") {
      setLinkFrom(id);
      return;
    }
    if (linkFrom) tryLink(linkFrom, id);
  }

  function onNodeDown(e: PE<HTMLDivElement>, id: string) {
    if ((e.target as HTMLElement).closest("button, input, select, .sw-port, .sw-chip, .sw-menu")) return;
    e.stopPropagation();
    setSel(id);
    const n = graph.nodes.find((x) => x.id === id);
    if (!n) return;
    drag.current = { id, dx: e.clientX - n.x, dy: e.clientY - n.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onMove(e: PE<HTMLDivElement>) {
    if (panning.current) {
      setPan({
        x: panning.current.px + (e.clientX - panning.current.x),
        y: panning.current.py + (e.clientY - panning.current.y),
      });
      return;
    }
    const d = drag.current;
    if (!d) return;
    commit(
      {
        ...graphRef.current,
        nodes: graphRef.current.nodes.map((n) =>
          n.id === d.id ? { ...n, x: e.clientX - d.dx, y: e.clientY - d.dy } : n,
        ),
      },
      false,
    );
  }

  function onUp() {
    if (drag.current) onChange(withGraph(cfg, graphRef.current));
    drag.current = null;
    panning.current = null;
  }

  async function refreshWindows() {
    setWinLoad(true);
    setWinErr("");
    try {
      const list = await listWindows();
      setWindows(list);
      rememberLooks(list);
    } catch (e) {
      setWinErr(String(e));
    } finally {
      setWinLoad(false);
    }
  }

  async function openPicker(id: string) {
    setPickNode(id);
    await refreshWindows();
  }

  function addExe(id: string, exe: string, look?: ChipLook) {
    const base = exe.replace(/^.*[\\/]/, "");
    if (!base) return;
    if (look) setLooks((prev) => ({ ...prev, [exeKey(base)]: look }));
    patchNode(id, (n) => {
      if (n.kind !== "foreground" && n.kind !== "running") return n;
      const programs = n.programs.some((p) => p.toLowerCase() === base.toLowerCase())
        ? n.programs
        : [...n.programs, base];
      return { ...n, programs };
    });
  }

  function applyLights(n: Extract<SwitchNode, { kind: "setProfile" }>) {
    const hdr = profiles.find((p) => p.index === n.profile);
    if (!hdr) return;
    onLights(
      {
        ...hdr,
        lightMode: n.lightMode ?? hdr.lightMode,
        bright: n.bright ?? hdr.bright,
        dim: n.dim ?? hdr.dim,
      },
      n.leds,
    );
  }

  function nodeTitle(kind: SwitchNode["kind"]): string {
    if (kind === "foreground") return "Foreground is";
    if (kind === "running") return "Running is";
    if (kind === "and") return "AND";
    if (kind === "or") return "OR";
    if (kind === "restore") return "Restore";
    return "Set profile";
  }

  return (
    <div className="sw-pane">
      <div className="sw-head">
        <h2 id="sw-title">Auto-switch</h2>
        <label className="sw-toggle">
          <input
            type="checkbox"
            checked={cfg.enabled}
            disabled={busy}
            onChange={(e) => onChange({ ...withGraph(cfg, graph), enabled: e.target.checked })}
          />
          <span>Enable</span>
          <em>{cfg.enabled ? "On" : "Off"}</em>
        </label>
        {focusLabel ? (
          <p className="sw-now">
            <span className="sw-dot" aria-hidden="true" />
            {focusLabel}
          </p>
        ) : (
          <p className="sw-now mute">Wire conditions to a profile. Lower priority number wins.</p>
        )}
      </div>
      <div className="sw-tools">
        <div className={`sw-add ${addOpen ? "open" : ""}`}>
          <button type="button" className="sw-add-btn" onClick={() => setAddOpen((v) => !v)}>
            + Add node
          </button>
          {addOpen ? (
            <div className="sw-add-menu">
              {ADD_KINDS.map((k) => (
                <button key={k.kind} type="button" onClick={() => addNode(k.kind)}>
                  {k.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button type="button" onClick={() => addNode("foreground")}>
          Foreground is
        </button>
        <button type="button" onClick={() => addNode("running")}>
          Running is
        </button>
        <button type="button" onClick={() => addNode("and")}>
          AND
        </button>
        <button type="button" onClick={() => addNode("or")}>
          OR
        </button>
        <button type="button" onClick={() => addNode("setProfile")}>
          Set profile
        </button>
        <button type="button" onClick={() => addNode("setProfile")}>
          Set lights
        </button>
        <button type="button" onClick={() => addNode("restore")}>
          Restore
        </button>
        {linkFrom ? <span className="hint">Click an input port to connect</span> : null}
      </div>
      <div
        className="sw-canvas"
        onPointerDown={(e) => {
          if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains("sw-wires")) return;
          setSel(null);
          setLinkFrom(null);
          setAddOpen(false);
          panning.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div className="sw-world" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
          <svg className="sw-wires" width="2200" height="1600">
            {graph.edges.map((e) => {
              const a = graph.nodes.find((n) => n.id === e.from);
              const b = graph.nodes.find((n) => n.id === e.to);
              if (!a || !b) return null;
              const p1 = portPos(a, "out");
              const p2 = portPos(b, "in");
              return (
                <path
                  key={e.id}
                  d={wirePath(p1.x, p1.y, p2.x, p2.y)}
                  className="sw-wire"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    commit({ ...graph, edges: graph.edges.filter((x) => x.id !== e.id) });
                  }}
                />
              );
            })}
          </svg>
          {graph.nodes.map((n) => (
            <div
              key={n.id}
              className={`sw-node sw-${n.kind}${sel === n.id ? " on" : ""}`}
              style={{ left: n.x, top: n.y, width: NODE_SIZE[n.kind].w }}
              onPointerDown={(e) => onNodeDown(e, n.id)}
            >
              {n.kind === "setProfile" || n.kind === "restore" ? (
                <input
                  className="sw-pri"
                  type="number"
                  min={0}
                  max={255}
                  title="Priority — lower runs first"
                  value={n.priority}
                  onChange={(e) =>
                    patchNode(n.id, (cur) =>
                      cur.kind === "setProfile" || cur.kind === "restore"
                        ? { ...cur, priority: Math.max(0, Math.min(255, Number(e.target.value) || 0)) }
                        : cur,
                    )
                  }
                />
              ) : null}
              {hasIn(n) ? (
                <button type="button" className="sw-port in" title="Input" onClick={() => onPort(n.id, "in")} />
              ) : null}
              {hasOut(n) ? (
                <button type="button" className="sw-port out" title="Output" onClick={() => onPort(n.id, "out")} />
              ) : null}
              <header>
                <span>{nodeTitle(n.kind)}</span>
                <div className="sw-menu">
                  <button type="button" className="sw-x" onClick={() => removeNode(n.id)} aria-label="Delete node">
                    ⋮
                  </button>
                </div>
              </header>
              {n.kind === "foreground" || n.kind === "running" ? (
                <>
                  <div className="sw-chips">
                    {n.programs.length === 0 ? <span className="hint">No programs</span> : null}
                    {n.programs.map((p) => {
                      const look = looks[exeKey(p)];
                      return (
                        <button
                          key={p}
                          type="button"
                          className="sw-chip"
                          onClick={() =>
                            patchNode(n.id, (cur) =>
                              cur.kind === "foreground" || cur.kind === "running"
                                ? { ...cur, programs: cur.programs.filter((x) => x !== p) }
                                : cur,
                            )
                          }
                          title="Remove"
                        >
                          <span className="sw-chip-thumb">
                            {look?.img ? (
                              <img src={look.img} alt="" />
                            ) : (
                              <span>{stemName(p).slice(0, 2)}</span>
                            )}
                          </span>
                          <span className="sw-chip-meta">
                            <strong>{look?.title || stemName(p)}</strong>
                            <em>{p}</em>
                          </span>
                          <span className="sw-chip-x">×</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="sw-row">
                    <button type="button" disabled={busy} onClick={() => void openPicker(n.id)}>
                      Select window
                    </button>
                  </div>
                </>
              ) : null}
              {n.kind === "and" || n.kind === "or" ? <p className="sw-op">{n.kind.toUpperCase()}</p> : null}
              {n.kind === "restore" ? (
                <>
                  <label>
                    Restore
                    <select value="previous" disabled>
                      <option value="previous">Previous profile</option>
                    </select>
                  </label>
                  <label className="sw-check" title="The restored profile keeps its own lights">
                    <input type="checkbox" checked readOnly />
                    Also restore lights
                  </label>
                </>
              ) : null}
              {n.kind === "setProfile" ? (
                <>
                  <label>
                    Profile
                    <select
                      value={n.profile}
                      onChange={(e) => {
                        const profile = Number(e.target.value);
                        const hdr = profiles.find((p) => p.index === profile);
                        patchNode(n.id, (cur) =>
                          cur.kind === "setProfile"
                            ? {
                                ...cur,
                                profile,
                                lightMode: hdr?.lightMode,
                                bright: hdr?.bright,
                                dim: hdr?.dim,
                                leds: keys[profile]?.map((k) => k.led),
                              }
                            : cur,
                        );
                      }}
                    >
                      {profiles.map((p) => (
                        <option key={p.index} value={p.index}>
                          {p.name || `P${p.index + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="sw-lights">
                    <span className="sw-lights-lab">Set lights</span>
                    <label>
                      Mode
                      <select
                        value={n.lightMode ?? profiles.find((p) => p.index === n.profile)?.lightMode ?? 0}
                        onChange={(e) => {
                          const lightMode = Number(e.target.value);
                          const next = { ...n, lightMode };
                          patchNode(n.id, () => next);
                          applyLights(next);
                        }}
                      >
                        {LIGHT_MODES.map((name, i) => (
                          <option key={name} value={i}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Brightness
                      <select
                        value={n.bright ?? profiles.find((p) => p.index === n.profile)?.bright ?? 0}
                        onChange={(e) => {
                          const bright = Number(e.target.value);
                          const next = { ...n, bright };
                          patchNode(n.id, () => next);
                          applyLights(next);
                        }}
                      >
                        {Array.from({ length: 11 }, (_, i) => (
                          <option key={i} value={i}>
                            {i === 0 ? "Off" : i >= 8 ? `Bright ${i}` : i >= 4 ? `Medium ${i}` : `Dim ${i}`}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="sw-leds" title="Per-key LED">
                      {Array.from({ length: 9 }, (_, i) => {
                        const led = n.leds?.[i] ?? keys[n.profile]?.[i]?.led ?? 0;
                        return (
                          <button
                            key={i}
                            type="button"
                            className="sw-led"
                            style={{ background: LED_HEX[led] ?? LED_HEX[0] }}
                            title={`${LEDS[led] ?? "Off"} — click to cycle`}
                            onClick={() => {
                              const leds = Array.from(
                                { length: 9 },
                                (_, j) => n.leds?.[j] ?? keys[n.profile]?.[j]?.led ?? 0,
                              );
                              leds[i] = (led + 1) % LEDS.length;
                              const next = { ...n, leds };
                              patchNode(n.id, () => next);
                              applyLights(next);
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      <RunningPicker
        open={pickNode != null}
        windows={windows}
        loading={winLoad}
        error={winErr || undefined}
        onClose={() => setPickNode(null)}
        onPick={(w) => {
          if (pickNode) addExe(pickNode, w.exe || w.path, lookFromWindow(w));
          setPickNode(null);
        }}
        onRefresh={() => void refreshWindows()}
        onBrowse={() =>
          void pickProgram().then((path) => {
            if (path && pickNode) addExe(pickNode, path);
            setPickNode(null);
          })
        }
      />
    </div>
  );
}
