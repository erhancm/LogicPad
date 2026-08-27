import type { Action, PadKey, ProfileHdr, Snapshot } from "./types";

export type SyncStatus = "synced" | "unsaved" | "offline";

export function cloneSnap(s: Snapshot): Snapshot {
  return structuredClone(s);
}

export function syncStatus(opts: {
  linked: boolean;
  snap: Snapshot | null;
  /** Last snapshot successfully loaded from the pad or written by Save/Reload/Factory. */
  baseline: Snapshot | null;
}): SyncStatus {
  const { linked, snap, baseline } = opts;
  if (!linked || !snap) return "offline";
  if (snap.meta.dirty || snapshotsDiffer(snap, baseline)) return "unsaved";
  return "synced";
}

/**
 * Editor vs last load/save. Ignores `meta.dirty` (that is its own unsaved signal)
 * and live fields that change without user edits (`inMenu`, `usb`, `active`).
 */
export function snapshotsDiffer(a: Snapshot | null, b: Snapshot | null): boolean {
  if (a == null || b == null) return a !== b;
  if (a.profiles.length !== b.profiles.length) return true;
  for (let i = 0; i < a.profiles.length; i++) {
    if (profileDiffers(a.profiles[i], b.profiles[i])) return true;
  }
  if (a.keys.length !== b.keys.length) return true;
  for (let p = 0; p < a.keys.length; p++) {
    const ka = a.keys[p] ?? [];
    const kb = b.keys[p] ?? [];
    if (ka.length !== kb.length) return true;
    for (let i = 0; i < ka.length; i++) {
      if (keyDiffers(ka[i], kb[i])) return true;
    }
  }
  return false;
}

function profileDiffers(a: ProfileHdr, b: ProfileHdr): boolean {
  return (
    a.index !== b.index ||
    a.name !== b.name ||
    a.lightMode !== b.lightMode ||
    a.bright !== b.bright ||
    a.dim !== b.dim
  );
}

function keyDiffers(a: PadKey, b: PadKey): boolean {
  if (a.profile !== b.profile || a.index !== b.index) return true;
  if (a.label !== b.label || a.led !== b.led || a.text !== b.text) return true;
  return actsDiffer(a.acts, b.acts);
}

function actsDiffer(a: Action[], b: Action[]): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.type !== y.type || x.mods !== y.mods || x.code !== y.code) return true;
  }
  return false;
}
