import type {
  SwitchCard,
  SwitchConfig,
  SwitchEdge,
  SwitchGraph,
  SwitchNode,
  SwitchRule,
} from "./types";

export const SWITCH_GRID = 22;

export type SwitchZone = "conditions" | "logic" | "actions";

export const ZONE_LAYOUT: Record<SwitchZone, { x: number; w: number; label: string }> = {
  conditions: { x: 48, w: 280, label: "Conditions" },
  logic: { x: 368, w: 120, label: "Logic gates" },
  actions: { x: 528, w: 280, label: "Actions" },
};

export const CANVAS_W = 860;
export const CANVAS_H = 2200;

export function nodeZone(n: SwitchNode): SwitchZone {
  if (n.kind === "foreground" || n.kind === "running") return "conditions";
  if (n.kind === "setProfile" || n.kind === "restore") return "actions";
  return "logic";
}

export function zoneX(zone: SwitchZone): number {
  return ZONE_LAYOUT[zone].x;
}

export function snapNodeToZone(n: SwitchNode): SwitchNode {
  return { ...n, x: zoneX(nodeZone(n)) };
}

export function isGate(n: SwitchNode): boolean {
  return (
    n.kind === "and" ||
    n.kind === "or" ||
    n.kind === "not" ||
    n.kind === "xor" ||
    n.kind === "if" ||
    n.kind === "else" ||
    n.kind === "true" ||
    n.kind === "false"
  );
}

export function nodeSize(n: SwitchNode): { w: number; h: number } {
  if (isGate(n)) {
    return { w: n.kind === "not" || n.kind === "if" ? 88 : 96, h: 68 };
  }
  if (n.kind === "foreground" || n.kind === "running") return { w: 252, h: 154 };
  if (n.kind === "restore") return { w: 236, h: 124 };
  if (n.kind === "setProfile" && n.lightsOnly) return { w: 248, h: 198 };
  return { w: 228, h: 176 };
}

export function snapToGrid(v: number, grid = SWITCH_GRID): number {
  return Math.round(v / grid) * grid;
}

/** Stack nodes into fixed condition / logic / action columns. */
export function autoLayoutGraph(graph: SwitchGraph): SwitchGraph {
  const V_GAP = 40;
  const MARGIN_Y = 56;
  const zones: SwitchZone[] = ["conditions", "logic", "actions"];
  const nodes = graph.nodes.map((n) => ({ ...n }));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  for (const zone of zones) {
    const inZone = nodes
      .filter((n) => nodeZone(n) === zone)
      .slice()
      .sort((a, b) => a.y - b.y || a.id.localeCompare(b.id));
    let y = MARGIN_Y;
    for (const src of inZone) {
      const n = byId.get(src.id);
      if (!n) continue;
      n.x = zoneX(zone);
      n.y = snapToGrid(y);
      y += nodeSize(n).h + V_GAP;
    }
  }

  return { ...graph, nodes };
}

export function defaultGraph(): SwitchGraph {
  return {
    nodes: [{ kind: "restore", id: "else", x: zoneX("actions"), y: 200, priority: 255 }],
    edges: [],
  };
}

export function graphFromRules(rules: SwitchRule[]): SwitchGraph {
  const nodes: SwitchNode[] = [];
  const edges: SwitchEdge[] = [];
  rules.forEach((r, i) => {
    const y = 40 + i * 170;
    const fid = `fg${i}`;
    const pid = `sp${i}`;
    nodes.push({ kind: "foreground", id: fid, x: zoneX("conditions"), y, programs: [r.exe] });
    nodes.push({
      kind: "setProfile",
      id: pid,
      x: zoneX("actions"),
      y,
      profile: r.profile,
      priority: Math.min(i, 255),
    });
    edges.push({ id: `e${i}`, from: fid, to: pid });
  });
  nodes.push({
    kind: "restore",
    id: "else",
    x: zoneX("actions"),
    y: 40 + rules.length * 170,
    priority: 255,
  });
  return { nodes, edges };
}

export function ensureGraph(cfg: SwitchConfig): SwitchGraph {
  if (cfg.graph && cfg.graph.nodes.length) return cfg.graph;
  if (cfg.rules.length) return graphFromRules(cfg.rules);
  return defaultGraph();
}

export function flattenGraph(graph: SwitchGraph): SwitchRule[] {
  const ins = incoming(graph);
  const actions = graph.nodes
    .filter((n): n is Extract<SwitchNode, { kind: "setProfile" }> => n.kind === "setProfile" && !n.lightsOnly)
    .slice()
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const out: SwitchRule[] = [];
  const seen = new Set<string>();
  for (const node of actions) {
    if (node.kind !== "setProfile") continue;
    const acc: string[] = [];
    collect(node.id, graph, ins, acc, new Set());
    for (const exe of acc) {
      const key = `${exe.toLowerCase()}|${node.profile}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ exe, profile: node.profile });
    }
  }
  return out;
}

function incoming(graph: SwitchGraph): Map<string, string[]> {
  const ins = new Map<string, string[]>();
  for (const e of graph.edges) {
    const list = ins.get(e.to) ?? [];
    list.push(e.from);
    ins.set(e.to, list);
  }
  return ins;
}

function collect(
  id: string,
  graph: SwitchGraph,
  ins: Map<string, string[]>,
  acc: string[],
  visiting: Set<string>,
) {
  if (visiting.has(id)) return;
  visiting.add(id);
  const node = graph.nodes.find((n) => n.id === id);
  if (!node) return;
  if (node.kind === "foreground" || node.kind === "running") {
    acc.push(...node.programs);
    return;
  }
  for (const src of ins.get(id) ?? []) collect(src, graph, ins, acc, visiting);
}

function uniqExes(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const exe = raw.replace(/^.*[\\/]/, "").trim();
    if (!exe) continue;
    const key = exe.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(exe);
  }
  return out;
}

function collectKinds(
  id: string,
  graph: SwitchGraph,
  ins: Map<string, string[]>,
  used: Set<string>,
): { foreground: string[]; running: string[]; sawFg: boolean; sawRun: boolean } {
  const foreground: string[] = [];
  const running: string[] = [];
  let sawFg = false;
  let sawRun = false;
  const visit = (nid: string) => {
    const node = graph.nodes.find((n) => n.id === nid);
    if (!node) return;
    if (node.kind === "foreground") {
      used.add(node.id);
      sawFg = true;
      foreground.push(...node.programs);
      return;
    }
    if (node.kind === "running") {
      used.add(node.id);
      sawRun = true;
      running.push(...node.programs);
      return;
    }
    if (
      node.kind === "and" ||
      node.kind === "or" ||
      node.kind === "not" ||
      node.kind === "xor" ||
      node.kind === "if" ||
      node.kind === "else" ||
      node.kind === "true" ||
      node.kind === "false"
    ) {
      used.add(node.id);
      for (const src of ins.get(node.id) ?? []) visit(src);
    }
  };
  for (const src of ins.get(id) ?? []) visit(src);
  return { foreground: uniqExes(foreground), running: uniqExes(running), sawFg, sawRun };
}

export function graphIsEmpty(graph: SwitchGraph): boolean {
  return !graph.nodes.some((n) => n.kind === "setProfile" && !n.lightsOnly);
}

/** True when the graph uses logic beyond simple foreground/running → profile chains. */
export function graphHasCustomLogic(graph: SwitchGraph): boolean {
  if (graph.nodes.some((n) => n.kind === "setProfile" && n.lightsOnly)) return true;
  const allowed = new Set(["foreground", "running", "setProfile", "restore", "and"]);
  return graph.nodes.some((n) => !allowed.has(n.kind));
}

export function listRuleCards(graph: SwitchGraph): SwitchCard[] {
  return graphToCards(graph).filter((c) => c.programs.length > 0 && c.id !== "draft");
}

export function addSimpleRule(
  graph: SwitchGraph,
  exe: string,
  profile: number,
  match: "foreground" | "running" = "foreground",
): SwitchGraph {
  const base = exe.replace(/^.*[\\/]/, "").trim();
  if (!base) return graph;
  const cards = listRuleCards(graph);
  const newCard: SwitchCard = {
    id: newId("rule"),
    match,
    programs: [base],
    profile,
  };
  return autoLayoutGraph(cardsToGraph([...cards, newCard]));
}

export function removeRuleCard(graph: SwitchGraph, cardId: string): SwitchGraph {
  const cards = listRuleCards(graph).filter((c) => c.id !== cardId);
  return autoLayoutGraph(cardsToGraph(cards));
}

export function reorderRuleCards(graph: SwitchGraph, fromIndex: number, toIndex: number): SwitchGraph {
  const cards = listRuleCards(graph);
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= cards.length || toIndex >= cards.length) {
    return graph;
  }
  const next = cards.slice();
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return autoLayoutGraph(cardsToGraph(next));
}

export function updateRuleCard(
  graph: SwitchGraph,
  cardId: string,
  patch: Partial<Pick<SwitchCard, "profile" | "match" | "programs">>,
): SwitchGraph {
  const cards = listRuleCards(graph).map((c) => (c.id === cardId ? { ...c, ...patch } : c));
  return autoLayoutGraph(cardsToGraph(cards));
}

export function ruleCardLabel(card: SwitchCard): string {
  const app = card.programs[0]?.replace(/\.exe$/i, "").replace(/^.*[\\/]/, "") || "App";
  if (card.andRunning?.length) {
    const extra = card.andRunning[0]?.replace(/\.exe$/i, "").replace(/^.*[\\/]/, "") || "app";
    return `${app} (+ ${extra} running)`;
  }
  if (card.match === "running") return `${app} (running)`;
  return app;
}

export function ruleCardKind(card: SwitchCard): "simple" | "advanced" {
  if (card.andRunning?.length) return "advanced";
  return "simple";
}

export function stemName(path: string): string {
  return path.replace(/^.*[\\/]/, "").replace(/\.exe$/i, "");
}

export function emptyCard(profile: number): SwitchCard {
  return {
    id: newId("if"),
    match: "foreground",
    programs: [],
    profile,
  };
}

export function graphToCards(graph: SwitchGraph, defaultProfile = 0): SwitchCard[] {
  const ins = incoming(graph);
  const used = new Set<string>();
  const cards: SwitchCard[] = [];
  const sets = graph.nodes
    .filter((n): n is Extract<SwitchNode, { kind: "setProfile" }> => n.kind === "setProfile" && !n.lightsOnly)
    .slice()
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  for (const node of sets) {
    if (node.kind !== "setProfile") continue;
    const cond = collectKinds(node.id, graph, ins, used);
    const runningOnly = cond.sawRun && !cond.sawFg;
    cards.push({
      id: node.id,
      match: runningOnly ? "running" : "foreground",
      programs: runningOnly ? cond.running : cond.foreground,
      andRunning: !runningOnly && cond.sawRun ? cond.running : undefined,
      profile: node.profile,
      lightMode: node.lightMode,
      bright: node.bright,
      dim: node.dim,
      leds: node.leds,
    });
  }
  for (const n of graph.nodes) {
    if (n.kind !== "foreground" && n.kind !== "running") continue;
    if (used.has(n.id)) continue;
    cards.push({
      id: n.id,
      match: n.kind === "running" ? "running" : "foreground",
      programs: uniqExes(n.programs),
      profile: defaultProfile,
    });
  }
  if (cards.length === 0) cards.push({ ...emptyCard(defaultProfile), id: "draft" });
  return cards;
}

export function cardsToGraph(cards: SwitchCard[]): SwitchGraph {
  const nodes: SwitchNode[] = [];
  const edges: SwitchEdge[] = [];
  cards.forEach((card, i) => {
    const y = 40 + i * 190;
    const pid = card.id;
    const extra = uniqExes(card.andRunning ?? []);
    const programs = uniqExes(card.programs);
    const useAnd = card.match === "foreground" && card.andRunning != null;
    if (card.match === "running") {
      const rid = `${pid}r`;
      nodes.push({ kind: "running", id: rid, x: zoneX("conditions"), y, programs });
      edges.push({ id: `${pid}e`, from: rid, to: pid });
    } else if (useAnd) {
      const fid = `${pid}f`;
      const rid = `${pid}r`;
      const aid = `${pid}a`;
      nodes.push({ kind: "foreground", id: fid, x: zoneX("conditions"), y, programs });
      nodes.push({ kind: "running", id: rid, x: zoneX("conditions"), y: y + 70, programs: extra });
      nodes.push({ kind: "and", id: aid, x: zoneX("logic"), y: y + 24 });
      edges.push({ id: `${pid}e1`, from: fid, to: aid });
      edges.push({ id: `${pid}e2`, from: rid, to: aid });
      edges.push({ id: `${pid}e3`, from: aid, to: pid });
    } else {
      const fid = `${pid}f`;
      nodes.push({ kind: "foreground", id: fid, x: zoneX("conditions"), y, programs });
      edges.push({ id: `${pid}e`, from: fid, to: pid });
    }
    nodes.push({
      kind: "setProfile",
      id: pid,
      x: zoneX("actions"),
      y,
      profile: card.profile,
      priority: Math.min(i, 255),
      lightMode: card.lightMode,
      bright: card.bright,
      dim: card.dim,
      leds: card.leds,
    });
  });
  nodes.push({
    kind: "restore",
    id: "else",
    x: zoneX("actions"),
    y: 40 + cards.length * 190,
    priority: 255,
  });
  return { nodes, edges };
}

export function withGraph(cfg: SwitchConfig, graph: SwitchGraph): SwitchConfig {
  return { ...cfg, graph, rules: flattenGraph(graph) };
}

export function withCards(cfg: SwitchConfig, cards: SwitchCard[]): SwitchConfig {
  return withGraph(cfg, cardsToGraph(cards));
}

export function exeStem(path: string): string {
  return path
    .replace(/^.*[\\/]/, "")
    .replace(/\.exe$/i, "")
    .toLowerCase();
}

export function cardMatchesFocus(card: SwitchCard, focusExe: string | null | undefined): boolean {
  if (!focusExe || card.programs.length === 0) return false;
  const fg = exeStem(focusExe);
  return card.programs.some((p) => exeStem(p) === fg);
}

let nid = 1;
export function newId(prefix: string): string {
  nid += 1;
  return `${prefix}${Date.now().toString(36)}${nid}`;
}
