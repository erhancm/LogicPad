import type { Action, LaunchEntry } from "./types";
import { clampSlot } from "./launches";

export type Step =
  | { kind: "launch"; launch: LaunchEntry }
  | { kind: "act"; i: number; a: Action };

/**
 * Combined playback/editor list: every pad action plus every launch.
 * Each launch is inserted at clamp(slot, acts.length). Same-slot launches
 * order by id. Launches do not use ACT_SLOTS.
 */
export function buildSteps(acts: Action[], launches: LaunchEntry[]): Step[] {
  const n = acts.length;
  const sorted = launches.slice().sort((a, b) => {
    const sa = clampSlot(a.slot ?? 0, n);
    const sb = clampSlot(b.slot ?? 0, n);
    if (sa !== sb) return sa - sb;
    return (a.id ?? "").localeCompare(b.id ?? "");
  });
  const out: Step[] = [];
  let j = 0;
  for (let i = 0; i <= n; i++) {
    while (j < sorted.length && clampSlot(sorted[j].slot ?? 0, n) === i) {
      out.push({ kind: "launch", launch: sorted[j] });
      j++;
    }
    if (i < n) out.push({ kind: "act", i, a: acts[i] });
  }
  return out;
}
