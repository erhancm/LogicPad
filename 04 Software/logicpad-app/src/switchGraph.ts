import type {
  RuleWhen,
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

/** Minimum rendered height for a node, used by auto-layout to avoid overlap. */
export function nodeSize(n: SwitchNode): { w: number; h: number } {
  if (isGate(n)) {
    return { w: n.kind === "not" || n.kind === "if" ? 88 : 96, h: 68 };
  }
  if (n.kind === "foreground" || n.kind === "running") {
    // header(28) + padding(30) + chips(38 per prog + 6 gap) + min-height(48) + button(28)
    const chipH = Math.max(1, n.programs.length) * 38 + (Math.max(1, n.programs.length) - 1) * 6;
    const chips = Math.max(48, chipH);
    return { w: 252, h: 28 + 30 + chips + 28 };
  }
  if (n.kind === "restore") return { w: 236, h: 124 };
  if (n.kind === "setProfile" && n.lightsOnly) return { w: 248, h: 198 };
  return { w: 228, h: 176 };
}

export function snapToGrid(v: number, grid = SWITCH_GRID): number {
  return Math.round(v / grid) * grid;
}

/** Stack nodes into fixed condition / logic / action columns.
 *  Logic gates are placed at the average Y of their wired neighbors. */
export function autoLayoutGraph(graph: SwitchGraph): SwitchGraph {
  const V_GAP = 48;
  const MARGIN_Y = 56;
  const nodes = graph.nodes.map((n) => ({ ...n }));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Build neighbor lookups.
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const e of graph.edges) {
    (incoming.get(e.to) ?? (incoming.set(e.to, []), incoming.get(e.to)!)).push(e.from);
    (outgoing.get(e.from) ?? (outgoing.set(e.from, []), outgoing.get(e.from)!)).push(e.to);
  }

  // Pass 1: lay out conditions and actions sequentially.
  const nonGate: SwitchZone[] = ["conditions", "actions"];
  for (const zone of nonGate) {
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

  // Pass 2: place logic gates at the centroid of their wired neighbors.
  const gates = nodes.filter((n) => nodeZone(n) === "logic");
  for (const g of gates) {
    g.x = zoneX("logic");
    const nbrs = [...(incoming.get(g.id) ?? []), ...(outgoing.get(g.id) ?? [])];
    if (nbrs.length) {
      let sum = 0;
      let cnt = 0;
      for (const id of nbrs) {
        const nb = byId.get(id);
        if (!nb) continue;
        sum += nb.y + nodeSize(nb).h / 2;
        cnt++;
      }
      if (cnt) g.y = snapToGrid(sum / cnt - nodeSize(g).h / 2);
    }
  }

  // Pass 3: resolve overlaps within each zone.
  for (const zone of ["conditions", "logic", "actions"] as SwitchZone[]) {
    const inZone = nodes
      .filter((n) => nodeZone(n) === zone)
      .slice()
      .sort((a, b) => a.y - b.y || a.id.localeCompare(b.id));
    for (let i = 1; i < inZone.length; i++) {
      const prev = inZone[i - 1];
      const cur = inZone[i];
      const minY = prev.y + nodeSize(prev).h + V_GAP;
      if (cur.y < minY) cur.y = snapToGrid(minY);
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

export const RULE_WHEN_LABELS: Record<RuleWhen, string> = {
  focused: "Focused on",
  "not-focused": "Not focused on",
  running: "Running",
  "focused-and-running": "Focused on + running",
};

export function cardWhen(card: SwitchCard): RuleWhen {
  if (card.when) return card.when;
  if (card.match === "running") return "running";
  if (card.andRunning?.length) return "focused-and-running";
  return "focused";
}

/** Expand IF/THEN/ELSE rows into a flat card list for graph compile. */
export function expandRuleCards(cards: SwitchCard[]): SwitchCard[] {
  const out: SwitchCard[] = [];
  for (const c of cards) {
    out.push(c);
    if (typeof c.otherwise !== "number" || !c.programs.length) continue;
    const when = cardWhen(c);
    if (when !== "focused" && when !== "not-focused") continue;
    out.push({
      id: `${c.id}-else`,
      when: when === "focused" ? "not-focused" : "focused",
      programs: [...c.programs],
      andRunning: c.andRunning ? [...c.andRunning] : undefined,
      profile: c.otherwise,
      otherwise: "next",
    });
  }
  return out;
}

type CondMeta = {
  when: RuleWhen;
  programs: string[];
  andRunning?: string[];
};

function analyzeCondition(
  setId: string,
  graph: SwitchGraph,
  ins: Map<string, string[]>,
  used: Set<string>,
): CondMeta {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const sources = ins.get(setId) ?? [];

  const walk = (ids: string[]): CondMeta => {
    if (ids.length === 1) {
      const n = byId.get(ids[0]);
      if (!n) return { when: "focused", programs: [] };
      if (n.kind === "not") {
        used.add(n.id);
        const inner = walk(ins.get(n.id) ?? []);
        if (inner.when === "focused") return { ...inner, when: "not-focused" };
        if (inner.when === "not-focused") return { ...inner, when: "focused" };
        return inner;
      }
      if (n.kind === "and") {
        used.add(n.id);
        const parts = (ins.get(n.id) ?? []).map((s) => walk([s]));
        const fg = uniqExes(parts.flatMap((p) => (p.when === "focused" || p.when === "not-focused" ? p.programs : [])));
        const run = uniqExes(parts.flatMap((p) => (p.when === "running" ? p.programs : p.andRunning ?? [])));
        if (fg.length && run.length) {
          return { when: "focused-and-running", programs: fg, andRunning: run };
        }
        return { when: "focused", programs: uniqExes(parts.flatMap((p) => p.programs)) };
      }
      if (n.kind === "or" || n.kind === "if") {
        used.add(n.id);
        const parts = (ins.get(n.id) ?? []).map((s) => walk([s]));
        return {
          when: parts[0]?.when ?? "focused",
          programs: uniqExes(parts.flatMap((p) => p.programs)),
          andRunning: parts.find((p) => p.andRunning)?.andRunning,
        };
      }
      if (n.kind === "foreground") {
        used.add(n.id);
        return { when: "focused", programs: uniqExes(n.programs) };
      }
      if (n.kind === "running") {
        used.add(n.id);
        return { when: "running", programs: uniqExes(n.programs) };
      }
    }
    if (ids.length > 1) {
      const parts = ids.map((id) => walk([id]));
      return {
        when: parts[0]?.when ?? "focused",
        programs: uniqExes(parts.flatMap((p) => p.programs)),
      };
    }
    return { when: "focused", programs: [] };
  };

  return walk(sources);
}

function wireCondition(
  card: SwitchCard,
  pid: string,
  nodes: SwitchNode[],
  edges: SwitchEdge[],
): string {
  const when = cardWhen(card);
  const programs = uniqExes(card.programs);
  const extra = uniqExes(card.andRunning ?? []);

  if (when === "running") {
    const rid = `${pid}r`;
    nodes.push({ kind: "running", id: rid, x: 0, y: 0, programs });
    edges.push({ id: `${pid}e`, from: rid, to: pid });
    return rid;
  }

  if (when === "focused-and-running") {
    const fid = `${pid}f`;
    const rid = `${pid}r`;
    const aid = `${pid}a`;
    nodes.push({ kind: "foreground", id: fid, x: 0, y: 0, programs });
    nodes.push({ kind: "running", id: rid, x: 0, y: 0, programs: extra });
    nodes.push({ kind: "and", id: aid, x: 0, y: 0 });
    edges.push({ id: `${pid}e1`, from: fid, to: aid });
    edges.push({ id: `${pid}e2`, from: rid, to: aid });
    edges.push({ id: `${pid}e3`, from: aid, to: pid });
    return aid;
  }

  const fid = `${pid}f`;
  nodes.push({ kind: "foreground", id: fid, x: 0, y: 0, programs });

  if (when === "not-focused") {
    const nid = `${pid}n`;
    nodes.push({ kind: "not", id: nid, x: 0, y: 0 });
    edges.push({ id: `${pid}en1`, from: fid, to: nid });
    edges.push({ id: `${pid}en2`, from: nid, to: pid });
    return nid;
  }

  edges.push({ id: `${pid}e`, from: fid, to: pid });
  return fid;
}

export function graphIsEmpty(graph: SwitchGraph): boolean {
  return !graph.nodes.some((n) => n.kind === "setProfile" && !n.lightsOnly);
}

/** True when the graph has hand-wired logic not produced by the rule builder. */
export function graphHasCustomLogic(graph: SwitchGraph): boolean {
  if (graph.nodes.some((n) => n.kind === "setProfile" && n.lightsOnly)) return true;
  const allowed = new Set(["foreground", "running", "setProfile", "restore", "and", "or", "not"]);
  return graph.nodes.some((n) => !allowed.has(n.kind));
}

export function listRuleCards(graph: SwitchGraph): SwitchCard[] {
  return graphToCards(graph).filter((c) => c.programs.length > 0 && c.id !== "draft");
}

export function addRuleCard(graph: SwitchGraph, card: Omit<SwitchCard, "id">): SwitchGraph {
  const cards = listRuleCards(graph);
  const newCard: SwitchCard = { ...card, id: newId("rule") };
  return autoLayoutGraph(cardsToGraph([...cards, newCard]));
}

export function addSimpleRule(
  graph: SwitchGraph,
  exe: string,
  profile: number,
  when: RuleWhen = "focused",
): SwitchGraph {
  const base = exe.replace(/^.*[\\/]/, "").trim();
  if (!base) return graph;
  return addRuleCard(graph, { when, programs: [base], profile, otherwise: "next" });
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

export function updateRuleCard(graph: SwitchGraph, cardId: string, patch: Partial<SwitchCard>): SwitchGraph {
  const cards = listRuleCards(graph).map((c) => (c.id === cardId ? { ...c, ...patch, id: c.id } : c));
  return autoLayoutGraph(cardsToGraph(cards));
}

export function ruleCardSummary(card: SwitchCard, profileName: (i: number) => string): string {
  const when = RULE_WHEN_LABELS[cardWhen(card)];
  const apps =
    card.programs.length > 1
      ? `${stemName(card.programs[0])} or ${card.programs.length - 1} more`
      : stemName(card.programs[0] || "app");
  const run =
    card.andRunning?.length && cardWhen(card) === "focused-and-running"
      ? ` + ${stemName(card.andRunning[0])} running`
      : "";
  const then = profileName(card.profile);
  const otherwise =
    typeof card.otherwise === "number"
      ? ` else ${profileName(card.otherwise)}`
      : card.otherwise === "restore"
        ? " else restore"
        : "";
  return `If ${when.toLowerCase()} ${apps}${run} → ${then}${otherwise}`;
}

export function ruleCardLabel(card: SwitchCard): string {
  const app = card.programs[0]?.replace(/\.exe$/i, "").replace(/^.*[\\/]/, "") || "App";
  if (cardWhen(card) === "focused-and-running") {
    const extra = card.andRunning?.[0]?.replace(/\.exe$/i, "").replace(/^.*[\\/]/, "") || "app";
    return `${app} + ${extra}`;
  }
  if (cardWhen(card) === "not-focused") return `NOT ${app}`;
  if (cardWhen(card) === "running") return `${app} (running)`;
  if (card.programs.length > 1) return `${app} +${card.programs.length - 1}`;
  return app;
}

export function ruleCardKind(card: SwitchCard): "simple" | "advanced" {
  const when = cardWhen(card);
  if (when !== "focused" || card.programs.length !== 1) return "advanced";
  if (card.otherwise != null && card.otherwise !== "next") return "advanced";
  return "simple";
}

export function stemName(path: string): string {
  return path.replace(/^.*[\\/]/, "").replace(/\.exe$/i, "");
}

export function emptyCard(profile: number): SwitchCard {
  return {
    id: newId("if"),
    when: "focused",
    programs: [],
    profile,
    otherwise: "next",
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
    if (node.id.endsWith("-else")) continue;
    const cond = analyzeCondition(node.id, graph, ins, used);
    cards.push({
      id: node.id,
      when: cond.when,
      programs: cond.programs,
      andRunning: cond.andRunning,
      profile: node.profile,
      otherwise: "next",
      lightMode: node.lightMode,
      bright: node.bright,
      dim: node.dim,
      leds: node.leds,
    });
    const elseNode = sets.find((n) => n.id === `${node.id}-else`);
    if (elseNode && elseNode.kind === "setProfile") {
      cards[cards.length - 1].otherwise = elseNode.profile;
    }
  }
  for (const n of graph.nodes) {
    if (n.kind !== "foreground" && n.kind !== "running") continue;
    if (used.has(n.id)) continue;
    cards.push({
      id: n.id,
      when: n.kind === "running" ? "running" : "focused",
      programs: uniqExes(n.programs),
      profile: defaultProfile,
      otherwise: "next",
    });
  }
  if (cards.length === 0) cards.push({ ...emptyCard(defaultProfile), id: "draft" });
  return cards;
}

export function cardsToGraph(cards: SwitchCard[]): SwitchGraph {
  const nodes: SwitchNode[] = [];
  const edges: SwitchEdge[] = [];
  const expanded = expandRuleCards(cards.filter((c) => c.programs.length > 0 && c.id !== "draft"));
  expanded.forEach((card, i) => {
    const pid = card.id;
    wireCondition(card, pid, nodes, edges);
    nodes.push({
      kind: "setProfile",
      id: pid,
      x: 0,
      y: 0,
      profile: card.profile,
      priority: Math.min(i, 255),
      lightMode: card.lightMode,
      bright: card.bright,
      dim: card.dim,
      leds: card.leds,
    });
  });
  const restoreElse = cards.some((c) => c.otherwise === "restore") || expanded.length === 0;
  nodes.push({
    kind: "restore",
    id: "else",
    x: 0,
    y: 0,
    priority: 255,
  });
  if (!restoreElse && expanded.length > 0) {
    // keep restore node for fall-through; eval uses unwired restore as else
  }
  return autoLayoutGraph({ nodes, edges });
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
