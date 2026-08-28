import { cardsToGraph } from "./switchGraph";
import type { SwitchCard, SwitchConfig, SwitchGraph } from "./types";

/** Advertising demo: multi-app OR rules, AND running gate, running-only match, else restore. */
export const SHOWCASE_SWITCH_CARDS: SwitchCard[] = [
  {
    id: "rule-create",
    match: "foreground",
    programs: ["Cursor.exe", "Code.exe", "Figma.exe"],
    profile: 0,
  },
  {
    id: "rule-stream",
    match: "foreground",
    programs: ["obs64.exe"],
    andRunning: ["Discord.exe"],
    profile: 1,
  },
  {
    id: "rule-meet",
    match: "foreground",
    programs: ["Teams.exe", "Zoom.exe"],
    profile: 2,
  },
  {
    id: "rule-browse",
    match: "foreground",
    programs: ["chrome.exe", "msedge.exe", "firefox.exe"],
    profile: 3,
  },
  {
    id: "rule-play",
    match: "running",
    programs: ["Spotify.exe"],
    profile: 4,
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
    rules: [
      { exe: "Cursor.exe", profile: 0 },
      { exe: "Code.exe", profile: 0 },
      { exe: "Figma.exe", profile: 0 },
      { exe: "obs64.exe", profile: 1 },
      { exe: "Teams.exe", profile: 2 },
      { exe: "Zoom.exe", profile: 2 },
      { exe: "chrome.exe", profile: 3 },
      { exe: "msedge.exe", profile: 3 },
      { exe: "firefox.exe", profile: 3 },
      { exe: "Spotify.exe", profile: 4 },
    ],
  };
}
