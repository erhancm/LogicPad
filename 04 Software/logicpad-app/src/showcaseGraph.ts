import { cardsToGraph, flattenGraph } from "./switchGraph";
import type { SwitchCard, SwitchConfig, SwitchGraph } from "./types";

/** Productivity demo — OR, AND+running, NOT, running-only, and IF/THEN/ELSE. */
export const SHOWCASE_SWITCH_CARDS: SwitchCard[] = [
  {
    id: "rule-meet",
    when: "focused",
    programs: ["Teams.exe", "Zoom.exe"],
    profile: 5,
    otherwise: "next",
  },
  {
    id: "rule-stream",
    when: "focused-and-running",
    programs: ["obs64.exe"],
    andRunning: ["Discord.exe"],
    profile: 6,
    otherwise: "next",
  },
  {
    id: "rule-browse",
    when: "focused",
    programs: ["chrome.exe", "msedge.exe", "firefox.exe"],
    profile: 1,
    otherwise: 0,
  },
  {
    id: "rule-cad",
    when: "focused",
    programs: ["FreeCAD.exe", "LibreCAD.exe", "fusion360.exe"],
    profile: 2,
    otherwise: "next",
  },
  {
    id: "rule-files",
    when: "focused",
    programs: ["explorer.exe"],
    profile: 3,
    otherwise: "next",
  },
  {
    id: "rule-dev",
    when: "focused",
    programs: ["Cursor.exe", "Code.exe"],
    profile: 4,
    otherwise: "next",
  },
  {
    id: "rule-office",
    when: "focused",
    programs: ["WINWORD.EXE", "EXCEL.EXE", "POWERPNT.EXE", "OUTLOOK.EXE"],
    profile: 0,
    otherwise: "next",
  },
  {
    id: "rule-not-teams",
    when: "not-focused",
    programs: ["Teams.exe"],
    profile: 0,
    otherwise: "next",
  },
  {
    id: "rule-media",
    when: "running",
    programs: ["Spotify.exe"],
    profile: 7,
    otherwise: "restore",
  },
];

export function showcaseSwitchGraph(): SwitchGraph {
  return cardsToGraph(SHOWCASE_SWITCH_CARDS);
}

export function showcaseSwitchConfig(): SwitchConfig {
  const graph = showcaseSwitchGraph();
  return {
    enabled: true,
    graph,
    rules: flattenGraph(graph),
  };
}
