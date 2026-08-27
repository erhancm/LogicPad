import { useEffect, useMemo, useRef, useState, type PointerEvent as PE } from "react";
import { LEDS, LIGHT_MODES, type PadKey, type ProfileHdr, type SwitchConfig, type SwitchEdge, type SwitchGraph, type SwitchNode } from "./types";
import { ensureGraph, newId, withGraph } from "./switchGraph";
import { RunningPicker, type OpenWindow } from "./RunningPicker";
import "./SwitchEditor.css";

const LED_HEX = ["#2a2e38", "#e8e4d8", "#c04040", "#40a060", "#3a7ec0"];

function nodeSize(n: SwitchNode): { w: number; h: number } {
  if (n.kind === "and" || n.kind === "or") return { w: 76, h: 76 };
  if (n.kind === "foreground" || n.kind === "running") return { w: 252, h: 154 };
  if (n.kind === "restore") return { w: 236, h: 124 };
  if (n.kind === "setProfile" && n.lightsOnly) return { w: 248, h: 198 };
  return { w: 228, h: 176 };
}

function wirePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(56, Math.abs(x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function isLights(n: SwitchNode): boolean {
  return n.kind === "setProfile" && !!n.lightsOnly;
}

function hasOut(n: SwitchNode): boolean {
  return n.kind !== "restore" && !isLights(n);
}

function hasIn(n: SwitchNode): boolean {
  return n.kind !== "foreground" && n.kind !== "running";
}

function isOp(n: SwitchNode): boolean {
  return n.kind === "and" || n.kind === "or";
}

function isCond(n: SwitchNode): boolean {
  return n.kind === "foreground" || n.kind === "running" || isOp(n);
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

function brightLabel(v: number): string {
  if (v <= 0) return "Off";
  if (v >= 8) return "Bright";
  if (v >= 4) return "Medium";
  return "Dim";
}

function neighborMap(graph: SwitchGraph): Map<string, string[]> {
  const m = new Map<string, string[]>();
  const add = (a: string, b: string) => {
    const list = m.get(a) ?? [];
    list.push(b);
    m.set(a, list);
  };
  for (const e of graph.edges) {
    add(e.from, e.to);
    add(e.to, e.from);
  }
  return m;
}

function flood(start: string, graph: SwitchGraph, keep: (n: SwitchNode) => boolean): string[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const nbr = neighborMap(graph);
  const out: string[] = [];
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    const node = byId.get(id);
    if (!node || !keep(node)) continue;
    seen.add(id);
    out.push(id);
    for (const n of nbr.get(id) ?? []) stack.push(n);
  }
  return out;
}

function badgeMap(graph: SwitchGraph): Map<string, number> {
  const badges = new Map<string, number>();
  let n = 1;
  const conds = graph.nodes
    .filter(isCond)
    .slice()
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const seen = new Set<string>();
  for (const node of conds) {
    if (seen.has(node.id)) continue;
    const group = flood(node.id, graph, isCond);
    for (const id of group) {
      seen.add(id);
      badges.set(id, n);
    }
    n += 1;
  }
  const sets = graph.nodes
    .filter((node): node is Extract<SwitchNode, { kind: "setProfile" }> => node.kind === "setProfile" && !node.lightsOnly)
    .slice()
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  for (const node of sets) {
    const group = flood(node.id, graph, (x) => x.kind === "setProfile");
    for (const id of group) badges.set(id, n);
    n += 1;
  }
  const restores = graph.nodes
    .filter((node): node is Extract<SwitchNode, { kind: "restore" }> => node.kind === "restore")
    .slice()
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  for (const node of restores) {
    badges.set(node.id, n);
    n += 1;
  }
  return badges;
}

function portCount(node: SwitchNode, graph: SwitchGraph, side: "in" | "out"): number {
  if (side === "in" && !hasIn(node)) return 0;
  if (side === "out" && !hasOut(node)) return 0;
  const n =
    side === "in"
      ? graph.edges.filter((e) => e.to === node.id).length
      : graph.edges.filter((e) => e.from === node.id).length;
  if (isOp(node)) return Math.max(2, n);
  if (side === "out" && (node.kind === "foreground" || node.kind === "running")) {
    return Math.max(node.programs.length >= 2 ? 2 : 1, n);
  }
  return Math.max(1, n);
}

function portPos(node: SwitchNode, graph: SwitchGraph, side: "in" | "out", index: number): { x: number; y: number } {
  const { w, h } = nodeSize(node);
  const count = Math.max(1, portCount(node, graph, side));
  const i = Math.min(Math.max(index, 0), count - 1);
  const y = count <= 1 ? node.y + h / 2 : node.y + (h * (i + 1)) / (count + 1);
  return { x: node.x + (side === "in" ? 0 : w), y };
}

function edgePorts(graph: SwitchGraph, edge: SwitchEdge): { a: { x: number; y: number }; b: { x: number; y: number } } | null {
  const from = graph.nodes.find((n) => n.id === edge.from);
  const to = graph.nodes.find((n) => n.id === edge.to);
  if (!from || !to) return null;
  const outs = graph.edges.filter((e) => e.from === from.id).sort((x, y) => {
    const ta = graph.nodes.find((n) => n.id === x.to);
    const tb = graph.nodes.find((n) => n.id === y.to);
    return (ta?.y ?? 0) - (tb?.y ?? 0) || x.id.localeCompare(y.id);
  });
  const ins = graph.edges.filter((e) => e.to === to.id).sort((x, y) => {
    const fa = graph.nodes.find((n) => n.id === x.from);
    const fb = graph.nodes.find((n) => n.id === y.from);
    return (fa?.y ?? 0) - (fb?.y ?? 0) || x.id.localeCompare(y.id);
  });
  const oi = Math.max(0, outs.findIndex((e) => e.id === edge.id));
  const ii = Math.max(0, ins.findIndex((e) => e.id === edge.id));
  return {
    a: portPos(from, graph, "out", oi),
    b: portPos(to, graph, "in", ii),
  };
}

type LightsCb = (hdr: ProfileHdr, leds: number[] | undefined) => void;

const ADD_KINDS: { kind: SwitchNode["kind"]; label: string; lightsOnly?: boolean }[] = [
  { kind: "foreground", label: "Foreground is" },
  { kind: "running", label: "Running is" },
  { kind: "and", label: "AND" },
  { kind: "or", label: "OR" },
  { kind: "setProfile", label: "Set profile" },
  { kind: "setProfile", label: "Set lights", lightsOnly: true },
  { kind: "restore", label: "Restore previous profile" },
];

export function SwitchEditor(props: {
  open: boolean;
  cfg: SwitchConfig;
  profiles: ProfileHdr[];
  keys: PadKey[][];
  busy?: boolean;
  onChange: (cfg: SwitchConfig) => void;
  onLights: LightsCb;
  listWindows: () => Promise<OpenWindow[]>;
  pickProgram: () => Promise<string | null>;
}) {
  const { open, cfg, profiles, keys, busy, onChange, onLights, listWindows, pickProgram } = props;
  const [graph, setGraph] = useState(() => ensureGraph(cfg));
  const [pan, setPan] = useState({ x: 36, y: 28 });
  const [sel, setSel] = useState<string | null>(null);
  const [linkFrom, setLinkFrom] = useState<{ id: string; port: number } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [pickNode, setPickNode] = useState<string | null>(null);
  const [windows, setWindows] = useState<OpenWindow[]>([]);
  const [winLoad, setWinLoad] = useState(false);
  const [winErr, setWinErr] = useState("");
  const [looks, setLooks] = useState<Record<string, ChipLook>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const panning = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef(graph);
  graphRef.current = graph;

  const badges = useMemo(() => badgeMap(graph), [graph]);

  useEffect(() => {
    if (open) {
      setGraph(ensureGraph(cfg));
      setSel(null);
      setLinkFrom(null);
      setAddOpen(false);
      setMenu(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (pickNode) setPickNode(null);
        else if (linkFrom) setLinkFrom(null);
        else if (addOpen) setAddOpen(false);
        else if (menu) setMenu(null);
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
  }, [open, sel, pickNode, linkFrom, addOpen, menu, graph]);

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

  function toWorld(e: PE<HTMLElement>): { x: number; y: number } {
    const r = canvasRef.current?.getBoundingClientRect();
    return {
      x: e.clientX - (r?.left ?? 0) - pan.x,
      y: e.clientY - (r?.top ?? 0) - pan.y,
    };
  }

  function addNode(kind: SwitchNode["kind"], lightsOnly = false) {
    setAddOpen(false);
    setMenu(null);
    const id = newId(lightsOnly ? "lt" : kind.slice(0, 2));
    const x = 90 - pan.x + (graph.nodes.length % 6) * 16;
    const y = 70 - pan.y + (graph.nodes.length % 5) * 18;
    const pri =
      Math.max(
        0,
        ...graph.nodes.map((n) => (n.kind === "setProfile" || n.kind === "restore" ? n.priority : -1)),
      ) + 1;
    const selected = graph.nodes.find((n) => n.id === sel);
    const fromProfile =
      selected?.kind === "setProfile" ? selected.profile : (profiles[0]?.index ?? 0);
    let node: SwitchNode;
    if (kind === "foreground") node = { kind, id, x, y, programs: [] };
    else if (kind === "running") node = { kind, id, x, y, programs: [] };
    else if (kind === "and" || kind === "or") node = { kind, id, x, y };
    else if (kind === "restore") node = { kind, id, x, y, priority: Math.min(pri, 255), restoreLights: true };
    else {
      const hdr = profiles.find((p) => p.index === fromProfile) ?? profiles[0];
      node = {
        kind: "setProfile",
        id,
        x,
        y,
        profile: hdr?.index ?? 0,
        priority: Math.min(pri, 255),
        lightsOnly,
        lightMode: hdr?.lightMode,
        bright: hdr?.bright,
        dim: hdr?.dim,
        leds: keys[hdr?.index ?? 0]?.map((k) => k.led),
      };
    }
    const edges = [...graph.edges];
    if (selected && hasOut(selected) && hasIn(node)) {
      edges.push({ id: newId("e"), from: selected.id, to: id });
    }
    commit({ nodes: [...graph.nodes, node], edges });
    setSel(id);
  }

  function removeNode(id: string) {
    setMenu(null);
    commit({
      nodes: graph.nodes.filter((n) => n.id !== id),
      edges: graph.edges.filter((e) => e.from !== id && e.to !== id),
    });
    if (sel === id) setSel(null);
  }

  function tryLink(from: string, to: string) {
    setLinkFrom(null);
    setCursor(null);
    if (from === to) return;
    const a = graph.nodes.find((n) => n.id === from);
    const b = graph.nodes.find((n) => n.id === to);
    if (!a || !b || !hasOut(a) || !hasIn(b)) return;
    if (graph.edges.some((e) => e.from === from && e.to === to)) return;
    commit({ ...graph, edges: [...graph.edges, { id: newId("e"), from, to }] });
  }

  function onPort(e: PE<HTMLButtonElement>, id: string, side: "in" | "out", port: number) {
    e.stopPropagation();
    e.preventDefault();
    if (side === "out") {
      setLinkFrom({ id, port });
      setCursor(toWorld(e));
      return;
    }
    if (linkFrom) tryLink(linkFrom.id, id);
  }

  function onNodeDown(e: PE<HTMLDivElement>, id: string) {
    if ((e.target as HTMLElement).closest("button, input, select, .sw-port, .sw-chip, .sw-menu, .sw-plist")) return;
    e.stopPropagation();
    setSel(id);
    setMenu(null);
    const n = graph.nodes.find((x) => x.id === id);
    if (!n) return;
    drag.current = { id, dx: e.clientX - n.x, dy: e.clientY - n.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onMove(e: PE<HTMLDivElement>) {
    if (linkFrom) setCursor(toWorld(e));
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

  function onUp(e: PE<HTMLDivElement>) {
    if (linkFrom) {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const port = el?.closest(".sw-port.in") as HTMLElement | null;
      const to = port?.dataset.node;
      if (to) tryLink(linkFrom.id, to);
      else {
        setLinkFrom(null);
        setCursor(null);
      }
    }
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
      setLooks((prev) => {
        const next = { ...prev };
        for (const w of list) {
          const key = exeKey(w.exe || w.path);
          if (key) next[key] = lookFromWindow(w);
        }
        return next;
      });
    } catch (err) {
      setWinErr(String(err));
    } finally {
      setWinLoad(false);
    }
  }

  async function openPicker(id: string) {
    setPickNode(id);
    setMenu(null);
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

  function nodeTitle(n: SwitchNode): string {
    if (n.kind === "foreground") return "Foreground is";
    if (n.kind === "running") return "Running is";
    if (n.kind === "and") return "AND";
    if (n.kind === "or") return "OR";
    if (n.kind === "restore") return "Restore previous profile";
    if (n.kind === "setProfile" && n.lightsOnly) return "Set lights";
    return "Set profile";
  }

  const linkSrc = linkFrom ? graph.nodes.find((n) => n.id === linkFrom.id) : undefined;
  const rubber =
    linkSrc && cursor
      ? wirePath(
          portPos(linkSrc, graph, "out", linkFrom!.port).x,
          portPos(linkSrc, graph, "out", linkFrom!.port).y,
          cursor.x,
          cursor.y,
        )
      : null;

  return (
    <div className="sw-pane">
      <div className="sw-tools">
        <div className={`sw-add ${addOpen ? "open" : ""}`}>
          <button type="button" className="sw-tool" onClick={() => setAddOpen((v) => !v)}>
            + Add node
          </button>
          {addOpen ? (
            <div className="sw-add-menu">
              {ADD_KINDS.map((k) => (
                <button key={k.label} type="button" onClick={() => addNode(k.kind, k.lightsOnly)}>
                  {k.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button type="button" className="sw-tool" onClick={() => addNode("foreground")}>
          Foreground is
        </button>
        <button type="button" className="sw-tool" onClick={() => addNode("running")}>
          Running is
        </button>
        <button type="button" className="sw-tool" onClick={() => addNode("and")}>
          AND
        </button>
        <button type="button" className="sw-tool" onClick={() => addNode("or")}>
          OR
        </button>
        <button type="button" className="sw-tool" onClick={() => addNode("setProfile")}>
          Set profile
        </button>
        <button type="button" className="sw-tool" onClick={() => addNode("setProfile", true)}>
          Set lights
        </button>
        {linkFrom ? <span className="hint">Drop on a yellow input</span> : null}
      </div>
      <div
        ref={canvasRef}
        className="sw-canvas"
        onPointerDown={(e) => {
          const t = e.target as HTMLElement;
          if (t !== e.currentTarget && !t.classList.contains("sw-wires")) return;
          setSel(null);
          setLinkFrom(null);
          setCursor(null);
          setAddOpen(false);
          setMenu(null);
          panning.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div className="sw-world" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
          <svg className="sw-wires" width="3200" height="2200">
            {graph.edges.map((e) => {
              const ports = edgePorts(graph, e);
              if (!ports) return null;
              return (
                <path
                  key={e.id}
                  d={wirePath(ports.a.x, ports.a.y, ports.b.x, ports.b.y)}
                  className="sw-wire"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    commit({ ...graph, edges: graph.edges.filter((x) => x.id !== e.id) });
                  }}
                />
              );
            })}
            {rubber ? <path d={rubber} className="sw-wire ghost" /> : null}
          </svg>
          {graph.nodes.map((n) => {
            const ins = portCount(n, graph, "in");
            const outs = portCount(n, graph, "out");
            const badge = badges.get(n.id);
            return (
              <div
                key={n.id}
                className={`sw-node sw-${n.kind}${isLights(n) ? " sw-lights-node" : ""}${sel === n.id ? " on" : ""}`}
                style={{ left: n.x, top: n.y, width: nodeSize(n).w, height: isOp(n) ? nodeSize(n).h : undefined }}
                onPointerDown={(e) => onNodeDown(e, n.id)}
              >
                {badge != null ? <span className="sw-badge">{badge}</span> : null}
                {Array.from({ length: ins }, (_, i) => (
                  <button
                    key={`in${i}`}
                    type="button"
                    className="sw-port in"
                    data-node={n.id}
                    style={{ top: portPos(n, graph, "in", i).y - n.y }}
                    title="Input"
                    onPointerDown={(e) => onPort(e, n.id, "in", i)}
                  />
                ))}
                {Array.from({ length: outs }, (_, i) => (
                  <button
                    key={`out${i}`}
                    type="button"
                    className="sw-port out"
                    data-node={n.id}
                    style={{ top: portPos(n, graph, "out", i).y - n.y }}
                    title="Output — drag to connect"
                    onPointerDown={(e) => onPort(e, n.id, "out", i)}
                  />
                ))}
                <header>
                  {isOp(n) ? <span className="sw-op">{nodeTitle(n)}</span> : <span>{nodeTitle(n)}</span>}
                  <div className={`sw-menu ${menu === n.id ? "open" : ""}`}>
                    <button
                      type="button"
                      className="sw-dots"
                      aria-label="Node menu"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenu((cur) => (cur === n.id ? null : n.id));
                      }}
                    >
                      ⋮
                    </button>
                    {menu === n.id ? (
                      <div className="sw-menu-list">
                        <button type="button" onClick={() => removeNode(n.id)}>
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </div>
                </header>
                {n.kind === "foreground" || n.kind === "running" ? (
                  <>
                    <div className="sw-chips" onClick={() => n.programs.length === 0 && void openPicker(n.id)}>
                      {n.programs.length === 0 ? <span className="hint">Select a window</span> : null}
                      {n.programs.map((p) => {
                        const look = looks[exeKey(p)];
                        return (
                          <div key={p} className="sw-chip">
                            <span className="sw-chip-thumb">
                              {look?.img ? <img src={look.img} alt="" /> : <span>{stemName(p).slice(0, 2)}</span>}
                            </span>
                            <span className="sw-chip-meta">
                              <strong>{look?.title || stemName(p)}</strong>
                              <em>{p}</em>
                            </span>
                            <button
                              type="button"
                              className="sw-chip-x"
                              onClick={() =>
                                patchNode(n.id, (cur) =>
                                  cur.kind === "foreground" || cur.kind === "running"
                                    ? { ...cur, programs: cur.programs.filter((x) => x !== p) }
                                    : cur,
                                )
                              }
                              aria-label={`Remove ${p}`}
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    <button type="button" className="sw-add-win" disabled={busy} onClick={() => void openPicker(n.id)}>
                      + Window
                    </button>
                  </>
                ) : null}
                {n.kind === "restore" ? (
                  <>
                    <label>
                      Restore
                      <select value="previous" disabled>
                        <option value="previous">Previous profile</option>
                      </select>
                    </label>
                    <label className="sw-check">
                      <input
                        type="checkbox"
                        checked={n.restoreLights !== false}
                        onChange={(e) =>
                          patchNode(n.id, (cur) =>
                            cur.kind === "restore" ? { ...cur, restoreLights: e.target.checked } : cur,
                          )
                        }
                      />
                      Also restore lights
                    </label>
                  </>
                ) : null}
                {n.kind === "setProfile" && !n.lightsOnly ? (
                  <>
                    <label>
                      Profile
                      <select
                        value={n.profile}
                        onChange={(e) => {
                          const profile = Number(e.target.value);
                          const p = profiles.find((x) => x.index === profile);
                          patchNode(n.id, (cur) =>
                            cur.kind === "setProfile"
                              ? {
                                  ...cur,
                                  profile,
                                  lightMode: p?.lightMode,
                                  bright: p?.bright,
                                  dim: p?.dim,
                                  leds: keys[profile]?.map((k) => k.led),
                                }
                              : cur,
                          );
                        }}
                      >
                        {(profiles.length ? profiles : [{ index: 0, name: "P1", lightMode: 0, bright: 6, dim: 2 }]).map(
                          (p) => (
                            <option key={p.index} value={p.index}>
                              {p.name || `P${p.index + 1}`}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    <div className="sw-plist">
                      {profiles
                        .filter((p) => p.index !== n.profile)
                        .map((p) => (
                          <button
                            key={p.index}
                            type="button"
                            onClick={() =>
                              patchNode(n.id, (cur) =>
                                cur.kind === "setProfile"
                                  ? {
                                      ...cur,
                                      profile: p.index,
                                      lightMode: p.lightMode,
                                      bright: p.bright,
                                      dim: p.dim,
                                      leds: keys[p.index]?.map((k) => k.led),
                                    }
                                  : cur,
                              )
                            }
                          >
                            {p.name || `P${p.index + 1}`}
                          </button>
                        ))}
                    </div>
                  </>
                ) : null}
                {n.kind === "setProfile" && n.lightsOnly ? (
                  <div className="sw-lights">
                    <label>
                      Mode
                      <select
                        value={n.lightMode ?? profiles.find((p) => p.index === n.profile)?.lightMode ?? 1}
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
                        value={n.bright ?? profiles.find((p) => p.index === n.profile)?.bright ?? 8}
                        onChange={(e) => {
                          const bright = Number(e.target.value);
                          const next = { ...n, bright };
                          patchNode(n.id, () => next);
                          applyLights(next);
                        }}
                      >
                        {Array.from({ length: 11 }, (_, i) => (
                          <option key={i} value={i}>
                            {brightLabel(i)}
                            {i > 0 ? ` (${i})` : ""}
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
                            title={LEDS[led] ?? "Off"}
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
                ) : null}
              </div>
            );
          })}
        </div>
        <RunningPicker
          dock
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
    </div>
  );
}
