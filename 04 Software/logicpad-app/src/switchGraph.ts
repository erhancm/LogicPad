import type { SwitchConfig, SwitchEdge, SwitchGraph, SwitchNode, SwitchRule } from "./types";

export function defaultGraph(): SwitchGraph {
  return {
    nodes: [{ kind: "restore", id: "else", x: 360, y: 200, priority: 9 }],
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
    nodes.push({ kind: "foreground", id: fid, x: 48, y, programs: [r.exe] });
    nodes.push({
      kind: "setProfile",
      id: pid,
      x: 340,
      y,
      profile: r.profile,
      priority: Math.min(i, 255),
    });
    edges.push({ id: `e${i}`, from: fid, to: pid });
  });
  nodes.push({
    kind: "restore",
    id: "else",
    x: 340,
    y: 40 + rules.length * 170,
    priority: 9,
  });
  return { nodes, edges };
}

export function ensureGraph(cfg: SwitchConfig): SwitchGraph {
  if (cfg.graph && cfg.graph.nodes.length) return cfg.graph;
  if (cfg.rules.length) return graphFromRules(cfg.rules);
  return defaultGraph();
}

export function flattenGraph(graph: SwitchGraph): SwitchRule[] {
  const ins = new Map<string, string[]>();
  for (const e of graph.edges) {
    const list = ins.get(e.to) ?? [];
    list.push(e.from);
    ins.set(e.to, list);
  }
  const actions = graph.nodes
    .filter((n) => n.kind === "setProfile")
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

export function withGraph(cfg: SwitchConfig, graph: SwitchGraph): SwitchConfig {
  return { ...cfg, graph, rules: flattenGraph(graph) };
}

let nid = 1;
export function newId(prefix: string): string {
  nid += 1;
  return `${prefix}${Date.now().toString(36)}${nid}`;
}
