import { useEffect, useMemo, useRef, useState, type PointerEvent as PE } from "react";
import { listen } from "@tauri-apps/api/event";
import { LEDS, LIGHT_MODES, type PadKey, type ProfileHdr, type SwitchConfig, type SwitchEdge, type SwitchGraph, type SwitchNode } from "./types";
import { cssLedId } from "./leds";
import { autoLayoutGraph, CANVAS_H, CANVAS_W, ensureGraph, isGate, newId, nodeSize, nodeZone, snapNodeToZone, snapToGrid, withGraph, ZONE_LAYOUT, type SwitchZone } from "./switchGraph";
import { GateIcon, GateSymbol, logicGateInfo, LOGIC_GATE_INFO, type LogicGateKind } from "./GateSymbol";
import { RunningPicker, type OpenWindow } from "./RunningPicker";
import { SwitchRulesList } from "./SwitchRulesList";
import { api } from "./api";
import "./SwitchEditor.css";

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2.5;

function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

function wirePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(56, Math.abs(x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function isLights(n: SwitchNode): boolean {
  return n.kind === "setProfile" && !!n.lightsOnly;
}

function hasOut(n: SwitchNode): boolean {
  return n.kind !== "restore" && !isLights(n) && n.kind !== "setProfile";
}

function hasIn(n: SwitchNode): boolean {
  return (
    n.kind !== "foreground" &&
    n.kind !== "running" &&
    n.kind !== "true" &&
    n.kind !== "false"
  );
}

function isOp(n: SwitchNode): boolean {
  return isGate(n);
}

const LOGIC_KINDS = Object.keys(LOGIC_GATE_INFO) as LogicGateKind[];

function isCond(n: SwitchNode): boolean {
  return n.kind === "foreground" || n.kind === "running" || isOp(n);
}

function exeKey(exe: string): string {
  return exe.replace(/^.*[\\/]/, "").toLowerCase();
}

function stemName(exe: string): string {
  return exe.replace(/^.*[\\/]/, "").replace(/\.exe$/i, "");
}

type ChipLook = { title: string; img?: string; live?: boolean; hwnd?: string };

function bmpSrc(b64?: string): string | undefined {
  return b64 ? `data:image/bmp;base64,${b64}` : undefined;
}

function jpegSrc(b64?: string): string | undefined {
  return b64 ? `data:image/jpeg;base64,${b64}` : undefined;
}

function lookFromWindow(w: OpenWindow): ChipLook {
  return {
    title: w.title || stemName(w.exe || w.path),
    img: bmpSrc(w.iconBmp),
    live: false,
    hwnd: w.hwnd,
  };
}

function mergeLook(prev: Record<string, ChipLook>, w: OpenWindow): void {
  const key = exeKey(w.exe || w.path);
  if (!key) return;
  const look = lookFromWindow(w);
  const cur = prev[key];
  if (!cur || look.hwnd) prev[key] = { ...look, img: look.img ?? cur?.img };
}

function previewTargets(list: OpenWindow[], picker: boolean, graph: SwitchGraph): string[] {
  const chips: string[] = [];
  const seen = new Set<string>();
  for (const n of graph.nodes) {
    if (n.kind !== "foreground" && n.kind !== "running") continue;
    for (const p of n.programs) {
      const hwnd = list.find((w) => exeKey(w.exe || w.path) === exeKey(p))?.hwnd;
      if (hwnd && seen.add(hwnd)) chips.push(hwnd);
    }
  }
  if (!picker) return chips;
  const rest = list.map((w) => w.hwnd).filter((h): h is string => !!h && !seen.has(h));
  return [...chips, ...rest];
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
  if (isOp(node)) return Math.max(1, n);
  if (side === "out" && (node.kind === "foreground" || node.kind === "running")) {
    return Math.max(1, n);
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

type AddItem = { kind: SwitchNode["kind"]; label: string; hint?: string; lightsOnly?: boolean };
type AddSection = { title: string; items: AddItem[] };

const ALL_GATES: LogicGateKind[] = ["and", "or", "not", "xor", "else", "true", "false"];

const ADD_SECTIONS: AddSection[] = [
  {
    title: "Conditions",
    items: [
      { kind: "foreground", label: "Foreground is", hint: "Active window matches" },
      { kind: "running", label: "Running is", hint: "Process open anywhere" },
    ],
  },
  {
    title: "Logic gates",
    items: ALL_GATES.map((kind) => {
      const info = LOGIC_GATE_INFO[kind];
      return { kind, label: info.menuLabel, hint: info.hint };
    }),
  },
  {
    title: "Actions",
    items: [
      { kind: "setProfile", label: "Set profile" },
      { kind: "restore", label: "Restore previous profile" },
    ],
  },
];

function nextYInZone(graph: SwitchGraph, zone: ReturnType<typeof nodeZone>): number {
  const inZone = graph.nodes.filter((n) => nodeZone(n) === zone);
  if (!inZone.length) return 56;
  const bottom = Math.max(...inZone.map((n) => n.y + nodeSize(n).h));
  return snapToGrid(bottom + 24);
}

export function SwitchEditor(props: {
  open: boolean;
  cfg: SwitchConfig;
  profiles: ProfileHdr[];
  keys: PadKey[][];
  busy?: boolean;
  enabled?: boolean;
  onChange: (cfg: SwitchConfig) => void;
  onStatus?: (msg: string) => void;
  onLights: LightsCb;
  listWindows: () => Promise<OpenWindow[]>;
  pickProgram: () => Promise<string | null>;
}) {
  const { open, cfg, profiles, keys, busy, enabled = cfg.enabled, onChange, onStatus, onLights, listWindows, pickProgram } = props;
  const [graph, setGraph] = useState(() => ensureGraph(cfg));
  const [rulesCompact, setRulesCompact] = useState(true);
  const [layoutTick, setLayoutTick] = useState(0);
  const [panTick, setPanTick] = useState(0);
  const [ruleHighlight, setRuleHighlight] = useState<string | null>(null);
  const [pan, setPan] = useState({ x: 36, y: 28 });
  const [zoom, setZoom] = useState(1);
  const [sel, setSel] = useState<string | null>(null);
  const [linkFrom, setLinkFrom] = useState<{ id: string; port: number } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [pickNode, setPickNode] = useState<string | null>(null);
  const [windows, setWindows] = useState<OpenWindow[]>([]);
  const [winLoad, setWinLoad] = useState(false);
  const [winErr, setWinErr] = useState("");
  const [looks, setLooks] = useState<Record<string, ChipLook>>({});
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [addOpen, setAddOpen] = useState<"conditions" | "logic" | "actions" | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const drag = useRef<{ id: string; ox: number; oy: number } | null>(null);
  const panning = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const viewRef = useRef({ pan, zoom });
  viewRef.current = { pan, zoom };
  const canvasRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef(graph);
  graphRef.current = graph;

  const badges = useMemo(() => badgeMap(graph), [graph]);
  const programKey = graph.nodes
    .filter((n): n is Extract<SwitchNode, { kind: "foreground" | "running" }> => n.kind === "foreground" || n.kind === "running")
    .flatMap((n) => n.programs)
    .join("|");

  useEffect(() => {
    if (!open) return;
    const g = ensureGraph(cfg);
    const next = { ...g, nodes: g.nodes.map((n) => snapNodeToZone(n)) };
    setGraph(next);
    graphRef.current = next;
  }, [cfg, open]);

  useEffect(() => {
    if (!open) return;
    setSel(null);
    setRuleHighlight(null);
    setLinkFrom(null);
    setAddOpen(null);
    setMenu(null);
  }, [open]);

  useEffect(() => {
    if (!open) {
      void api.stopWindowPreviews().catch(() => undefined);
      return;
    }
    let gone = false;
    let unlisten: (() => void) | undefined;
    void listen<{ hwnd: string; jpeg: string }>("window-preview", (e) => {
      const hwnd = e.payload?.hwnd;
      const jpeg = e.payload?.jpeg;
      if (!hwnd || !jpeg) return;
      setPreviews((prev) => (prev[hwnd] === jpeg ? prev : { ...prev, [hwnd]: jpeg }));
    })
      .then((fn) => {
        if (gone) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      gone = true;
      unlisten?.();
      void api.stopWindowPreviews().catch(() => undefined);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancel = false;
    void listWindows()
      .then((list) => {
        if (cancel) return;
        setWindows(list);
        setLooks((prev) => {
          const next = { ...prev };
          for (const w of list) mergeLook(next, w);
          return next;
        });
        void api.watchWindowPreviews(previewTargets(list, pickNode != null, graphRef.current));
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [open, pickNode, programKey]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!open || !el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const { pan: p, zoom: z } = viewRef.current;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const nz = clampZoom(z * factor);
      const wx = (sx - p.x) / z;
      const wy = (sy - p.y) / z;
      setPan({ x: sx - wx * nz, y: sy - wy * nz });
      setZoom(nz);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [open]);

  // Post-render overlap fix: measure actual DOM heights and only push nodes apart where they overlap.
  useEffect(() => {
    if (layoutTick === 0) return;
    requestAnimationFrame(() => {
      const el = canvasRef.current;
      if (!el) return;
      const nodeEls = el.querySelectorAll<HTMLElement>(".sw-node");
      if (!nodeEls.length) return;

      const GAP = 48;
      const measured = new Map<string, number>();

      for (const nodeEl of nodeEls) {
        const id = nodeEl.dataset.nodeId;
        if (id) measured.set(id, nodeEl.offsetHeight);
      }

      let changed = false;
      const nextNodes = graphRef.current.nodes.map((n) => ({ ...n }));

      for (const zone of ["conditions", "logic", "actions"] as SwitchZone[]) {
        const inZone = nextNodes
          .filter((n) => nodeZone(n) === zone)
          .slice()
          .sort((a, b) => a.y - b.y || a.id.localeCompare(b.id));
        for (let i = 1; i < inZone.length; i++) {
          const prev = inZone[i - 1];
          const cur = inZone[i];
          const prevH = measured.get(prev.id) ?? nodeSize(prev).h;
          const minY = prev.y + prevH + GAP;
          if (cur.y < minY) {
            cur.y = snapToGrid(minY);
            changed = true;
          }
        }
      }

      if (changed) commit({ ...graphRef.current, nodes: nextNodes });
    });
  }, [layoutTick]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (pickNode) setPickNode(null);
        else if (linkFrom) setLinkFrom(null);
        else if (addOpen) setAddOpen(null);
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

  function toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const r = canvasRef.current?.getBoundingClientRect();
    const { pan: p, zoom: z } = viewRef.current;
    return {
      x: (clientX - (r?.left ?? 0) - p.x) / z,
      y: (clientY - (r?.top ?? 0) - p.y) / z,
    };
  }

  function zoomBy(factor: number, anchor?: { x: number; y: number }) {
    const el = canvasRef.current;
    const rect = el?.getBoundingClientRect();
    const sx = anchor?.x ?? (rect ? rect.width / 2 : 0);
    const sy = anchor?.y ?? (rect ? rect.height / 2 : 0);
    const { pan: p, zoom: z } = viewRef.current;
    const nz = clampZoom(z * factor);
    const wx = (sx - p.x) / z;
    const wy = (sy - p.y) / z;
    setPan({ x: sx - wx * nz, y: sy - wy * nz });
    setZoom(nz);
  }

  function resetView() {
    setPan({ x: 36, y: 28 });
    setZoom(1);
  }

  function addNode(kind: SwitchNode["kind"], lightsOnly = false) {
    setAddOpen(null);
    setMenu(null);
    const id = newId(lightsOnly ? "lt" : kind.slice(0, 2));
    const pri =
      Math.max(
        0,
        ...graph.nodes.map((n) => (n.kind === "setProfile" || n.kind === "restore" ? n.priority : -1)),
      ) + 1;
    const selected = graph.nodes.find((n) => n.id === sel);
    const fromProfile =
      selected?.kind === "setProfile" ? selected.profile : (profiles[0]?.index ?? 0);
    let node: SwitchNode;
    if (kind === "foreground") node = { kind, id, x: 0, y: 0, programs: [] };
    else if (kind === "running") node = { kind, id, x: 0, y: 0, programs: [] };
    else if (
      kind === "and" ||
      kind === "or" ||
      kind === "not" ||
      kind === "xor" ||
      kind === "if" ||
      kind === "else" ||
      kind === "true" ||
      kind === "false"
    ) {
      node = { kind, id, x: 0, y: 0 };
    }
    else if (kind === "restore") node = { kind, id, x: 0, y: 0, priority: Math.min(pri, 255), restoreLights: true };
    else {
      const hdr = profiles.find((p) => p.index === fromProfile) ?? profiles[0];
      node = {
        kind: "setProfile",
        id,
        x: 0,
        y: 0,
        profile: hdr?.index ?? 0,
        priority: Math.min(pri, 255),
        lightsOnly,
        lightMode: hdr?.lightMode,
        bright: hdr?.bright,
        dim: hdr?.dim,
        leds: keys[hdr?.index ?? 0]?.map((k) => k.led),
      };
    }
    const zone = nodeZone(node);
    node = snapNodeToZone({ ...node, y: nextYInZone(graph, zone) });
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
      setCursor(toWorld(e.clientX, e.clientY));
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
    const world = toWorld(e.clientX, e.clientY);
    drag.current = { id, ox: world.x - n.x, oy: world.y - n.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  // Canvas panning uses native window listeners to survive React re-renders during drag.
  useEffect(() => {
    if (!panning.current) return;
    const startX = panning.current.x;
    const startY = panning.current.y;
    const basePx = panning.current.px;
    const basePy = panning.current.py;
    const onWinMove = (ev: PointerEvent) => {
      setPan({ x: basePx + (ev.clientX - startX), y: basePy + (ev.clientY - startY) });
    };
    const onWinUp = () => {
      panning.current = null;
      window.removeEventListener("pointermove", onWinMove);
      window.removeEventListener("pointerup", onWinUp);
    };
    window.addEventListener("pointermove", onWinMove);
    window.addEventListener("pointerup", onWinUp);
    return () => {
      window.removeEventListener("pointermove", onWinMove);
      window.removeEventListener("pointerup", onWinUp);
    };
  }, [panTick]);

  function onMove(e: PE<HTMLDivElement>) {
    if (linkFrom) setCursor(toWorld(e.clientX, e.clientY));
    const d = drag.current;
    if (!d) return;
    const world = toWorld(e.clientX, e.clientY);
    commit(
      {
        ...graphRef.current,
        nodes: graphRef.current.nodes.map((n) =>
          n.id === d.id ? { ...n, x: world.x - d.ox, y: world.y - d.oy } : n,
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
    if (drag.current) {
      const snapped = {
        ...graphRef.current,
        nodes: graphRef.current.nodes.map((n) =>
          n.id === drag.current!.id ? snapNodeToZone({ ...n, y: snapToGrid(n.y) }) : n,
        ),
      };
      commit(snapped);
    }
    drag.current = null;
  }

  async function refreshWindows() {
    setWinLoad(true);
    setWinErr("");
    try {
      const list = await listWindows();
      setWindows(list);
      setLooks((prev) => {
        const next = { ...prev };
        for (const w of list) mergeLook(next, w);
        return next;
      });
      void api.watchWindowPreviews(previewTargets(list, true, graphRef.current));
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

  function convertLogic(id: string, kind: SwitchNode["kind"]) {
    patchNode(id, (n) => {
      if (!isOp(n)) return n;
      return snapNodeToZone({ kind, id: n.id, x: n.x, y: n.y } as SwitchNode);
    });
    setMenu(null);
  }

  function nodeTitle(n: SwitchNode): string {
    if (n.kind === "foreground") return "Foreground is";
    if (n.kind === "running") return "Running is";
    if (isOp(n)) return logicGateInfo(n.kind).title;
    if (n.kind === "restore") return "Restore previous profile";
    if (n.kind === "setProfile" && n.lightsOnly) return "Set lights";
    return "Set profile";
  }

  const toolbarSections = ADD_SECTIONS.map((s) => ({
    id: s.title.toLowerCase().includes("condition")
      ? ("conditions" as const)
      : s.title.toLowerCase().includes("more")
        ? ("logic" as const)
        : s.title.toLowerCase().includes("logic")
          ? ("logic" as const)
          : ("actions" as const),
    ...s,
  }));

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

  function highlightRule(setProfileId: string | null) {
    setRuleHighlight(setProfileId);
    if (!setProfileId) return;
    const node = graph.nodes.find((n) => n.id === setProfileId);
    if (!node) return;
    setSel(setProfileId);
    const el = canvasRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = node.x + nodeSize(node).w / 2;
    const cy = node.y + nodeSize(node).h / 2;
    const z = viewRef.current.zoom;
    setPan({ x: rect.width / 2 - cx * z, y: rect.height / 2 - cy * z });
  }

  function onRulesChange(next: SwitchConfig) {
    const g = ensureGraph(next);
    setGraph({ ...g, nodes: g.nodes.map((n) => snapNodeToZone(n)) });
    graphRef.current = g;
    onChange(next);
  }

  return (
    <div className="sw-pane">
      <SwitchRulesList
        cfg={cfg}
        graph={graph}
        profiles={profiles}
        busy={busy}
        enabled={enabled}
        highlightId={ruleHighlight}
        rulesCompact={rulesCompact}
        onRulesCompact={setRulesCompact}
        onChange={onRulesChange}
        onHighlight={highlightRule}
        onStatus={onStatus}
        listWindows={listWindows}
        pickProgram={pickProgram}
      />
      <div className="sw-graph-wrap">
      <div className="sw-tools">
        {toolbarSections.map((section) => (
          <div key={section.id} className={`sw-add sw-add-${section.id} ${addOpen === section.id ? "open" : ""}`}>
            <button
              type="button"
              className={`sw-tool sw-tool-${section.id}`}
              onClick={() => setAddOpen((cur) => (cur === section.id ? null : section.id))}
            >
              + {section.title}
            </button>
            {addOpen === section.id ? (
              <div className="sw-add-menu">
                {section.items.map((k) => (
                  <button
                    key={`${section.id}-${k.label}`}
                    type="button"
                    title={k.hint}
                    onClick={() => addNode(k.kind, k.lightsOnly)}
                  >
                    {section.id === "logic" && isGate({ kind: k.kind, id: "", x: 0, y: 0 } as SwitchNode) ? (
                      <GateIcon kind={k.kind} size={26} />
                    ) : null}
                    <span>
                      <strong>{k.label}</strong>
                      {k.hint ? <em>{k.hint}</em> : null}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))}

        <span className="sw-tools-gap" />
        <div className="sw-zoom">
          <button type="button" className="sw-tool sw-zoom-btn" title="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
            −
          </button>
          <button type="button" className="sw-tool sw-zoom-label" title="Reset view" onClick={resetView}>
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" className="sw-tool sw-zoom-btn" title="Zoom in" onClick={() => zoomBy(1.2)}>
            +
          </button>
        </div>
        <button
          type="button"
          className="sw-tool"
          title="Arrange nodes into condition / logic / action columns"
          onClick={() => { commit(autoLayoutGraph(graph)); setLayoutTick((t) => t + 1); }}
        >
          Auto layout
        </button>
        <span className="hint sw-canvas-hint">Drag empty area to pan · Scroll to zoom</span>
      </div>
      <div
        ref={canvasRef}
        className="sw-canvas"
        onPointerDown={(e) => {
          const t = e.target as HTMLElement;
          if (t.closest(".sw-node, .sw-port, button, input, select, .sw-chip, .sw-menu")) return;
          setSel(null);
          setLinkFrom(null);
          setCursor(null);
          setAddOpen(null);
          setMenu(null);
          panning.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
          setPanTick((t) => t + 1);
        }}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div
          className="sw-world"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        >
          <div className="sw-zones" aria-hidden>
            {(Object.keys(ZONE_LAYOUT) as Array<keyof typeof ZONE_LAYOUT>).map((key) => (
              <div
                key={key}
                className={`sw-zone sw-zone-${key}`}
                style={{ left: ZONE_LAYOUT[key].x - 12, width: ZONE_LAYOUT[key].w + 24, height: CANVAS_H }}
              >
                <span className="sw-zone-label">{ZONE_LAYOUT[key].label}</span>
              </div>
            ))}
          </div>
          <svg className="sw-wires" width={CANVAS_W} height={CANVAS_H}>
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
                className={`sw-node sw-${n.kind}${isLights(n) ? " sw-lights-node" : ""}${isOp(n) ? " sw-gate sw-logic" : ""}${n.kind === "foreground" || n.kind === "running" ? " sw-cond" : ""}${n.kind === "setProfile" || n.kind === "restore" ? " sw-action" : ""}${sel === n.id ? " on" : ""}`}
                data-node-id={n.id}
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
                  {isOp(n) ? (
                    <span className="sw-op" title={logicGateInfo(n.kind).hint}>
                      <GateSymbol kind={n.kind} />
                      <small>{nodeTitle(n)}</small>
                    </span>
                  ) : (
                    <span>{nodeTitle(n)}</span>
                  )}
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
                        {isOp(n)
                          ? LOGIC_KINDS.filter((k) => k !== n.kind).map((k) => (
                              <button key={k} type="button" onClick={() => convertLogic(n.id, k)}>
                                {logicGateInfo(k).menuLabel}
                              </button>
                            ))
                          : null}
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
                        const hwnd = look?.hwnd;
                        const jpeg = hwnd ? previews[hwnd] : undefined;
                        const img = jpegSrc(jpeg) ?? look?.img;
                        const live = Boolean(jpeg);
                        return (
                          <div key={p} className="sw-chip">
                            <span className={live ? "sw-chip-thumb" : "sw-chip-thumb icon"}>
                              {img ? <img src={img} alt="" /> : <span>{stemName(p).slice(0, 2)}</span>}
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
                  <label>
                    Restore
                    <select value="previous" disabled>
                      <option value="previous">Previous profile</option>
                    </select>
                  </label>
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
                            style={{ background: cssLedId(led) }}
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
          windows={windows.map((w) => ({ ...w, thumbJpeg: w.hwnd ? previews[w.hwnd] : undefined }))}
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
    </div>
  );
}
