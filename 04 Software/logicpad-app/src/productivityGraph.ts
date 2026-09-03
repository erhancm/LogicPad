import { autoLayoutGraph, cardsToGraph, flattenGraph } from "./switchGraph";
import type { SwitchCard, SwitchConfig, SwitchGraph } from "./types";

const MEDIA_PROFILE = 6;

/** Productivity auto-switch — Office, Files, Browse, CAD, Outlook, Teams, else Media. */
export const PRODUCTIVITY_SWITCH_CARDS: SwitchCard[] = [
  {
    id: "rule-teams",
    when: "focused",
    programs: ["Teams.exe"],
    profile: 5,
    otherwise: "next",
  },
  {
    id: "rule-outlook",
    when: "focused",
    programs: ["OUTLOOK.EXE"],
    profile: 4,
    otherwise: "next",
  },
  {
    id: "rule-cad",
    when: "focused",
    programs: ["SLDWORKS.exe"],
    profile: 3,
    otherwise: "next",
  },
  {
    id: "rule-browse",
    when: "focused",
    programs: ["chrome.exe", "msedge.exe"],
    profile: 2,
    otherwise: "next",
  },
  {
    id: "rule-files",
    when: "focused",
    programs: ["explorer.exe"],
    profile: 1,
    otherwise: "next",
  },
  {
    id: "rule-office",
    when: "focused",
    programs: ["WINWORD.EXE", "EXCEL.EXE", "POWERPNT.EXE", "ONENOTE.EXE"],
    profile: 0,
    otherwise: "next",
  },
];

export function productivitySwitchGraph(): SwitchGraph {
  const base = cardsToGraph(PRODUCTIVITY_SWITCH_CARDS);
  const nodes = base.nodes.filter((n) => n.kind !== "restore");
  const edges = [...base.edges];
  const mediaPriority = PRODUCTIVITY_SWITCH_CARDS.length;

  nodes.push(
    { kind: "true", id: "rule-media-true", x: 0, y: 0 },
    {
      kind: "setProfile",
      id: "rule-media",
      x: 0,
      y: 0,
      profile: MEDIA_PROFILE,
      priority: mediaPriority,
    },
  );
  edges.push({ id: "rule-mediae", from: "rule-media-true", to: "rule-media" });

  return autoLayoutGraph({ nodes, edges });
}

export function productivitySwitchConfig(): SwitchConfig {
  const graph = productivitySwitchGraph();
  return {
    enabled: true,
    graph,
    rules: flattenGraph(graph),
  };
}
