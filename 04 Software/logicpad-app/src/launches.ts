import type { LaunchEntry } from "./types";

/**
 * App.tsx step list — replace the local `buildSteps(acts, showLaunch, slot)` with:
 *
 *   import { buildSteps, type Step } from "./steps";
 *   import { launchesOf, addLaunchDraft, removeLaunch, upsertLaunch, clampSlot } from "./launches";
 *
 *   const mine = launchesOf(launches, profile, sel); // include drafts in `launches`
 *   const steps = buildSteps(key.acts, mine);
 *
 * Launches are NOT pad actions: they do not consume ACT_SLOTS (12). Insert each at
 * clamp(slot, acts.length). Several launches may share a slot; order is slot, then id.
 *
 * Persist via existing `api.setLaunch(entry)`:
 *   - upserts by `id` (generate with `newLaunchId()` if missing)
 *   - empty `path` deletes THAT id only — loop ids to clear a key (Clear all / swap)
 */

let idSeq = 0;

export function newLaunchId(): string {
  idSeq += 1;
  const t = Date.now().toString(16).padStart(12, "0");
  const n = idSeq.toString(16).padStart(4, "0");
  return `l${t}-${n}`;
}

export function clampSlot(slot: number, nActs: number): number {
  return Math.max(0, Math.min(nActs, slot));
}

export function compareLaunches(a: LaunchEntry, b: LaunchEntry): number {
  const sa = a.slot ?? 0;
  const sb = b.slot ?? 0;
  if (sa !== sb) return sa - sb;
  return (a.id ?? "").localeCompare(b.id ?? "");
}

/** Every launch on this pad key, including empty-path drafts, slot then id. */
export function launchesOf(list: LaunchEntry[], profile: number, key: number): LaunchEntry[] {
  return list.filter((l) => l.profile === profile && l.key === key).sort(compareLaunches);
}

export function keyHasLaunch(list: LaunchEntry[], profile: number, key: number): boolean {
  return launchesOf(list, profile, key).some((l) => l.path.trim());
}

export function withLaunchId(entry: LaunchEntry): LaunchEntry {
  const id = entry.id?.trim();
  return id ? entry : { ...entry, id: newLaunchId() };
}

export function addLaunchDraft(
  list: LaunchEntry[],
  profile: number,
  key: number,
  nActs: number,
): { list: LaunchEntry[]; draft: LaunchEntry } {
  const draft: LaunchEntry = {
    id: newLaunchId(),
    profile,
    key,
    path: "",
    args: "",
    slot: clampSlot(nActs, nActs),
  };
  return { list: [...list, draft], draft };
}

export function removeLaunch(list: LaunchEntry[], id: string): LaunchEntry[] {
  return list.filter((l) => l.id !== id);
}

/** Drop every launch on one pad key (local state). Persist via tombstonesForKey + setLaunch. */
export function removeKeyLaunches(list: LaunchEntry[], profile: number, key: number): LaunchEntry[] {
  return list.filter((l) => !(l.profile === profile && l.key === key));
}

/** Empty-path copies to persist-delete each launch on a key (`api.setLaunch`). */
export function tombstonesForKey(
  list: LaunchEntry[],
  profile: number,
  key: number,
): LaunchEntry[] {
  return launchesOf(list, profile, key)
    .filter((l) => (l.id ?? "").trim())
    .map((l) => ({ ...l, path: "" }));
}

export function upsertLaunch(list: LaunchEntry[], entry: LaunchEntry, nActs: number): LaunchEntry[] {
  const next: LaunchEntry = {
    ...entry,
    id: entry.id?.trim() || newLaunchId(),
    slot: clampSlot(entry.slot ?? 0, nActs),
  };
  const i = list.findIndex((l) => l.id === next.id);
  if (i < 0) return [...list, next];
  const copy = list.slice();
  copy[i] = next;
  return copy;
}

/** Empty path removes that id; otherwise upsert. Matches LaunchStore.set. */
export function writeLaunchList(list: LaunchEntry[], entry: LaunchEntry, nActs: number): LaunchEntry[] {
  const next = withLaunchId({ ...entry, slot: clampSlot(entry.slot ?? 0, nActs) });
  const id = next.id ?? "";
  if (!next.path.trim()) return removeLaunch(list, id);
  return upsertLaunch(list, next, nActs);
}

export function nudgeLaunchSlot(entry: LaunchEntry, dir: -1 | 1, nActs: number): LaunchEntry {
  return { ...entry, slot: clampSlot((entry.slot ?? 0) + dir, nActs) };
}

/** After deleting pad action `actIndex`, pull later launches left and clamp. */
export function onActRemoved(
  list: LaunchEntry[],
  profile: number,
  key: number,
  actIndex: number,
  nActsAfter: number,
): LaunchEntry[] {
  return list.map((l) => {
    if (l.profile !== profile || l.key !== key) return l;
    const slot = l.slot ?? 0;
    const next = actIndex < slot ? slot - 1 : slot;
    return { ...l, slot: clampSlot(next, nActsAfter) };
  });
}

export function remapKeyLaunches(
  list: LaunchEntry[],
  profile: number,
  from: number,
  to: number,
): LaunchEntry[] {
  if (from === to) return list;
  return list.map((l) => {
    if (l.profile !== profile) return l;
    if (l.key === from) return { ...l, key: to };
    if (l.key === to) return { ...l, key: from };
    return l;
  });
}

export function makeLaunch(
  profile: number,
  key: number,
  path: string,
  args: string,
  slot: number,
  id?: string,
): LaunchEntry {
  return {
    id: id?.trim() || newLaunchId(),
    profile,
    key,
    path,
    args,
    slot,
  };
}
