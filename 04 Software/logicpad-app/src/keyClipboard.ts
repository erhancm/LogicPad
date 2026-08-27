import type { LaunchEntry, PadKey } from "./types";

/** In-memory pad-key clipboard. Not the OS clipboard. */
export type KeyClip = {
  key: PadKey;
  launches: LaunchEntry[];
  /** When true, paste keeps the destination label and LED. */
  actionsOnly: boolean;
};

let clip: KeyClip | null = null;

export function emptyPadKey(profile: number, index: number): PadKey {
  return { profile, index, label: "", led: 0, acts: [], text: "" };
}

export function launchesFor(
  list: LaunchEntry[],
  profile: number,
  index: number,
): LaunchEntry[] {
  return list.filter(
    (l) => l.profile === profile && l.key === index && l.path.trim() !== "",
  );
}

/** Empty = no label, no acts, no text, no launch. LED is ignored. */
export function isKeyEmpty(key: PadKey, launches: LaunchEntry[]): boolean {
  if (key.label.trim() !== "") return false;
  if (key.acts.length > 0) return false;
  if ((key.text ?? "") !== "") return false;
  return launchesFor(launches, key.profile, key.index).length === 0;
}

export function get(): KeyClip | null {
  return clip ? structuredClone(clip) : null;
}

export function set(next: KeyClip | null): void {
  clip = next ? structuredClone(next) : null;
}

export function has(): boolean {
  return clip !== null;
}

export function copyKey(key: PadKey, launches: LaunchEntry[]): void {
  set({
    key,
    launches: launchesFor(launches, key.profile, key.index),
    actionsOnly: false,
  });
}

export function copyActions(key: PadKey, launches: LaunchEntry[]): void {
  set({
    key,
    launches: launchesFor(launches, key.profile, key.index),
    actionsOnly: true,
  });
}

export function pasteOnto(
  dest: PadKey,
  data: KeyClip,
): { key: PadKey; launches: LaunchEntry[] } {
  const launches = data.launches.map((l) => ({
    ...structuredClone(l),
    profile: dest.profile,
    key: dest.index,
  }));
  if (data.actionsOnly) {
    return {
      key: {
        ...dest,
        acts: structuredClone(data.key.acts),
        text: data.key.text,
      },
      launches,
    };
  }
  return {
    key: {
      ...structuredClone(data.key),
      profile: dest.profile,
      index: dest.index,
    },
    launches,
  };
}

function keyAt(keys: PadKey[], profile: number, index: number): PadKey {
  const hit = keys.find((k) => k.index === index);
  if (hit) return hit;
  const slot = keys[index];
  if (slot && slot.index === index) return slot;
  return emptyPadKey(profile, index);
}

/** Full copy of `source` remapped onto every empty key in the same profile. */
export function duplicateEmptyTargets(
  source: PadKey,
  sourceLaunches: LaunchEntry[],
  profileKeys: PadKey[],
  profileLaunches: LaunchEntry[],
): { index: number; key: PadKey; launches: LaunchEntry[] }[] {
  const srcLaunches = launchesFor(sourceLaunches, source.profile, source.index);
  const out: { index: number; key: PadKey; launches: LaunchEntry[] }[] = [];
  for (let i = 0; i < 9; i++) {
    if (i === source.index) continue;
    const dest = keyAt(profileKeys, source.profile, i);
    if (!isKeyEmpty(dest, profileLaunches)) continue;
    out.push({
      index: i,
      key: { ...structuredClone(source), profile: source.profile, index: i },
      launches: srcLaunches.map((l) => ({
        ...structuredClone(l),
        profile: source.profile,
        key: i,
      })),
    });
  }
  return out;
}
