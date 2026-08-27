/**
 * LogicPad YAML setup pack — share or copy profiles between machines.
 *
 * ```yaml
 * logicpadPack: 1
 * exportedAt: 2026-08-25T16:30:00.000Z
 * profiles:
 *   - name: Work
 *     lightMode: 4
 *     bright: 8
 *     dim: 3
 *     keys:
 *       - index: 0
 *         label: Copy
 *         led: 2
 *         acts:
 *           - type: 1
 *             mods: 1
 *             code: 6
 *         text: ""
 *         launches:
 *           - path: C:\Program Files\App\app.exe
 *             args: ""
 *             slot: 0
 * autoSwitch:
 *   enabled: true
 *   rules:
 *     - exe: Code.exe
 *       profileName: Work   # prefer name over index when sharing
 *       profile: 0          # pack-relative index, or device slot if no profiles[]
 * ```
 *
 * Selectivity (`PackOptions`):
 * - `profileIndices` — which local profiles to export, or which local slots to
 *   apply onto (import). Default: every profile in the snapshot.
 * - `names` — profile names + key labels
 * - `actions` — key `acts` + typed `text`
 * - `leds` — per-key LED
 * - `lights` — profile lightMode / bright / dim
 * - `launches` — PC program launches (paths are machine-specific)
 * - `autoSwitch` — tray auto-switch rules
 *
 * `applyPack` merge:
 * - Map pack profiles onto selected existing slots: match non-empty names when
 *   `opts.names` is on, then fill remaining slots by order of `profileIndices`.
 * - Only overwrite fields whose option is on and present in the file.
 * - Never add or delete profiles; extra local profiles stay as they are.
 * - Auto-switch: resolve `profileName` against names after the merge; fall back
 *   to pack-relative `profile`. Skip rules whose profile is missing. Merge by
 *   exe (do not drop unrelated local rules).
 */

import { parse, stringify } from "yaml";
import { launchesOf } from "./launches";
import { flattenGraph, graphFromRules } from "./switchGraph";
import { LIGHT_MODES, type Action, type LaunchEntry, type PadKey, type Snapshot, type SwitchConfig } from "./types";

export const PACK_VERSION = 1;
const KEY_COUNT = 9;
const BRIGHT_MAX = 10;
const LED_MAX = 4;

export type PackOptions = {
  profileIndices: number[];
  names: boolean;
  actions: boolean;
  leds: boolean;
  lights: boolean;
  launches: boolean;
  autoSwitch: boolean;
};

export type PackSections = {
  names: boolean;
  actions: boolean;
  leds: boolean;
  lights: boolean;
  launches: boolean;
  autoSwitch: boolean;
  profiles: boolean;
};

export type PackAct = { type: number; mods: number; code: number };

export type PackLaunch = { path: string; args: string; slot: number };

export type PackKey = {
  index: number;
  label?: string;
  led?: number;
  acts?: PackAct[];
  text?: string;
  launches?: PackLaunch[];
};

export type PackProfile = {
  name?: string;
  lightMode?: number;
  bright?: number;
  dim?: number;
  keys?: PackKey[];
};

export type PackSwitchRule = {
  exe: string;
  profileName?: string;
  profile?: number;
};

export type PackAutoSwitch = {
  enabled: boolean;
  rules: PackSwitchRule[];
};

export type LogicPadPack = {
  logicpadPack: typeof PACK_VERSION;
  exportedAt: string;
  profiles?: PackProfile[];
  autoSwitch?: PackAutoSwitch;
};

export type ApplyResult = {
  snap: Snapshot;
  launches: LaunchEntry[];
  switchCfg: SwitchConfig;
};

type Mapping = { packIndex: number; destIndex: number };

export function defaultPackOptions(snap: Snapshot, pack?: LogicPadPack | null): PackOptions {
  const opts: PackOptions = {
    profileIndices: snap.profiles.map((p) => p.index),
    names: true,
    actions: true,
    leds: true,
    lights: true,
    launches: true,
    autoSwitch: true,
  };
  if (!pack) return opts;
  const present = sectionsInPack(pack);
  opts.names = present.names;
  opts.actions = present.actions;
  opts.leds = present.leds;
  opts.lights = present.lights;
  opts.launches = present.launches;
  opts.autoSwitch = present.autoSwitch;
  return opts;
}

export function sectionsInPack(pack: LogicPadPack): PackSections {
  const profiles = pack.profiles ?? [];
  const keys = profiles.flatMap((p) => p.keys ?? []);
  return {
    profiles: profiles.length > 0,
    names: profiles.some((p) => "name" in p) || keys.some((k) => "label" in k),
    actions: keys.some((k) => "acts" in k || "text" in k),
    leds: keys.some((k) => "led" in k),
    lights: profiles.some((p) => "lightMode" in p || "bright" in p || "dim" in p),
    launches: keys.some((k) => "launches" in k),
    autoSwitch: pack.autoSwitch != null,
  };
}

export function suggestedFileName(pack: LogicPadPack): string {
  const n = pack.profiles?.find((p) => p.name?.trim())?.name?.trim();
  const slug = (n || "LogicPad").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "LogicPad";
  return `${slug}.yaml`;
}

export function buildPack(
  snap: Snapshot,
  launches: LaunchEntry[],
  switchCfg: SwitchConfig,
  opts: PackOptions,
): LogicPadPack {
  const want = uniqueIndices(opts.profileIndices).filter((i) => snap.profiles.some((p) => p.index === i));
  const packIndexByOrig = new Map(want.map((orig, i) => [orig, i] as const));
  const includeProfiles =
    want.length > 0 && (opts.names || opts.actions || opts.leds || opts.lights || opts.launches);

  const profiles: PackProfile[] = [];
  if (includeProfiles) {
    for (const idx of want) {
      const hdr = snap.profiles.find((p) => p.index === idx);
      if (!hdr) continue;
      const row = snap.keys[idx] ?? [];
      const out: PackProfile = {};
      if (opts.names) out.name = hdr.name ?? "";
      if (opts.lights) {
        out.lightMode = hdr.lightMode;
        out.bright = hdr.bright;
        out.dim = hdr.dim;
      }
      if (opts.names || opts.actions || opts.leds || opts.launches) {
        out.keys = Array.from({ length: KEY_COUNT }, (_, index) => {
          const key = row[index] ?? emptyKey(idx, index);
          const k: PackKey = { index };
          if (opts.names) k.label = key.label ?? "";
          if (opts.leds) k.led = key.led ?? 0;
          if (opts.actions) {
            k.acts = key.acts.map((a) => ({ type: a.type, mods: a.mods, code: a.code }));
            k.text = key.text ?? "";
          }
          if (opts.launches) {
            k.launches = launchesOf(launches, idx, index)
              .filter((l) => l.path.trim())
              .map((l) => ({ path: l.path, args: l.args ?? "", slot: l.slot ?? 0 }));
          }
          return k;
        });
      }
      profiles.push(out);
    }
  }

  const pack: LogicPadPack = {
    logicpadPack: PACK_VERSION,
    exportedAt: new Date().toISOString(),
  };
  if (profiles.length) pack.profiles = profiles;
  if (opts.autoSwitch) {
    const src = switchCfg.graph ? flattenGraph(switchCfg.graph) : switchCfg.rules;
    const rules: PackSwitchRule[] = [];
    for (const r of src) {
      if (want.length && !packIndexByOrig.has(r.profile)) continue;
      const hdr = snap.profiles.find((p) => p.index === r.profile);
      const rule: PackSwitchRule = { exe: r.exe };
      const name = hdr?.name.trim();
      if (name) rule.profileName = name;
      if (profiles.length) {
        const pi = packIndexByOrig.get(r.profile);
        if (pi === undefined) continue;
        rule.profile = pi;
      } else {
        rule.profile = r.profile;
      }
      rules.push(rule);
    }
    pack.autoSwitch = { enabled: switchCfg.enabled, rules };
  }
  return pack;
}

export function packToYaml(pack: LogicPadPack): string {
  const body = stringify(pack, { indent: 2, lineWidth: 0 });
  return `# LogicPad setup pack (logicpadPack: ${PACK_VERSION})\n${body}`;
}

export function yamlToPack(text: string): LogicPadPack {
  const raw = text.replace(/^\uFEFF/, "").trim();
  if (!raw) throw new Error("File is empty.");
  let doc: unknown;
  try {
    doc = parse(raw);
  } catch (e) {
    throw new Error(`Invalid YAML: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("Not a LogicPad YAML file (logicpadPack: 1).");
  }
  const o = doc as Record<string, unknown>;
  if (Number(o.logicpadPack) !== PACK_VERSION) {
    throw new Error("Not a LogicPad YAML file (logicpadPack: 1).");
  }
  const pack: LogicPadPack = {
    logicpadPack: PACK_VERSION,
    exportedAt: typeof o.exportedAt === "string" ? o.exportedAt : "",
  };
  if (o.profiles != null) {
    if (!Array.isArray(o.profiles)) throw new Error("profiles must be a list.");
    pack.profiles = o.profiles.map(parseProfile);
  }
  if (o.autoSwitch != null) {
    pack.autoSwitch = parseAutoSwitch(o.autoSwitch);
  }
  if (!pack.profiles?.length && !pack.autoSwitch) {
    throw new Error("File has no profiles or auto-switch rules.");
  }
  return pack;
}

export function applyPack(
  snap: Snapshot,
  launches: LaunchEntry[],
  switchCfg: SwitchConfig,
  pack: LogicPadPack,
  opts: PackOptions,
): ApplyResult {
  const nextSnap: Snapshot = structuredClone(snap);
  let nextLaunches: LaunchEntry[] = structuredClone(launches);
  const nextSwitch: SwitchConfig = structuredClone(switchCfg);
  const mappings = mapPackProfiles(nextSnap, pack, opts);

  for (const { packIndex, destIndex } of mappings) {
    const src = pack.profiles?.[packIndex];
    const hdr = nextSnap.profiles.find((p) => p.index === destIndex);
    if (!src || !hdr) continue;
    if (opts.names && src.name !== undefined) hdr.name = String(src.name);
    if (opts.lights) {
      if (src.lightMode !== undefined) hdr.lightMode = clamp(src.lightMode, 0, LIGHT_MODES.length - 1);
      if (src.bright !== undefined) hdr.bright = clamp(src.bright, 0, BRIGHT_MAX);
      if (src.dim !== undefined) hdr.dim = clamp(src.dim, 0, BRIGHT_MAX);
    }
    ensureKeyRow(nextSnap, destIndex);
    for (const pk of src.keys ?? []) {
      if (pk.index < 0 || pk.index >= KEY_COUNT) continue;
      const key = nextSnap.keys[destIndex][pk.index];
      if (!key) continue;
      if (opts.names && pk.label !== undefined) key.label = String(pk.label);
      if (opts.leds && pk.led !== undefined) key.led = clamp(pk.led, 0, LED_MAX);
      if (opts.actions) {
        if (pk.acts !== undefined) key.acts = pk.acts.map((a) => ({ type: a.type, mods: a.mods, code: a.code }));
        if (pk.text !== undefined) key.text = String(pk.text);
      }
      if (opts.launches && pk.launches !== undefined) {
        nextLaunches = nextLaunches.filter((l) => !(l.profile === destIndex && l.key === pk.index));
        for (const L of pk.launches) {
          if (!L.path.trim()) continue;
          nextLaunches.push({
            profile: destIndex,
            key: pk.index,
            path: L.path,
            args: L.args ?? "",
            slot: L.slot ?? 0,
          });
        }
      }
    }
  }

  if (opts.autoSwitch && pack.autoSwitch) {
    nextSwitch.enabled = Boolean(pack.autoSwitch.enabled);
    for (const rule of pack.autoSwitch.rules) {
      const dest = resolveRuleProfile(rule, nextSnap, mappings);
      if (dest === null) continue;
      const exe = rule.exe.trim();
      if (!exe) continue;
      const i = nextSwitch.rules.findIndex((r) => r.exe.toLowerCase() === exe.toLowerCase());
      if (i >= 0) nextSwitch.rules[i] = { exe: nextSwitch.rules[i].exe, profile: dest };
      else nextSwitch.rules.push({ exe, profile: dest });
    }
    nextSwitch.graph = graphFromRules(nextSwitch.rules);
  }

  return { snap: nextSnap, launches: nextLaunches, switchCfg: nextSwitch };
}

function mapPackProfiles(snap: Snapshot, pack: LogicPadPack, opts: PackOptions): Mapping[] {
  const src = pack.profiles ?? [];
  const dests = uniqueIndices(opts.profileIndices).filter((i) => snap.profiles.some((p) => p.index === i));
  const usedDest = new Set<number>();
  const usedPack = new Set<number>();
  const mappings: Mapping[] = [];

  if (opts.names) {
    src.forEach((pp, packIndex) => {
      const n = pp.name?.trim();
      if (!n) return;
      const dest = dests.find((d) => !usedDest.has(d) && profileName(snap, d).trim() === n);
      if (dest === undefined) return;
      mappings.push({ packIndex, destIndex: dest });
      usedDest.add(dest);
      usedPack.add(packIndex);
    });
  }

  src.forEach((_pp, packIndex) => {
    if (usedPack.has(packIndex)) return;
    const dest = dests.find((d) => !usedDest.has(d));
    if (dest === undefined) return;
    mappings.push({ packIndex, destIndex: dest });
    usedDest.add(dest);
    usedPack.add(packIndex);
  });

  return mappings;
}

function resolveRuleProfile(rule: PackSwitchRule, snap: Snapshot, mappings: Mapping[]): number | null {
  const name = rule.profileName?.trim();
  if (name) {
    const hit = snap.profiles.find((p) => p.name.trim() === name);
    if (hit) return hit.index;
  }
  if (rule.profile == null || !Number.isInteger(rule.profile)) return null;
  if (mappings.length) {
    return mappings.find((m) => m.packIndex === rule.profile)?.destIndex ?? null;
  }
  return snap.profiles.some((p) => p.index === rule.profile) ? rule.profile : null;
}

function parseProfile(raw: unknown): PackProfile {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const p: PackProfile = {};
  if ("name" in o) p.name = o.name == null ? "" : String(o.name);
  const lightMode = asInt(o.lightMode);
  const bright = asInt(o.bright);
  const dim = asInt(o.dim);
  if (lightMode !== undefined) p.lightMode = lightMode;
  if (bright !== undefined) p.bright = bright;
  if (dim !== undefined) p.dim = dim;
  if (o.keys != null) {
    if (!Array.isArray(o.keys)) throw new Error("profile keys must be a list.");
    p.keys = o.keys.map(parseKey).filter((k): k is PackKey => k != null);
  }
  return p;
}

function parseKey(raw: unknown): PackKey | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const index = asInt(o.index);
  if (index === undefined || index < 0 || index >= KEY_COUNT) return null;
  const k: PackKey = { index };
  if ("label" in o) k.label = o.label == null ? "" : String(o.label);
  const led = asInt(o.led);
  if (led !== undefined) k.led = led;
  if ("text" in o) k.text = o.text == null ? "" : String(o.text);
  if (o.acts != null) {
    if (!Array.isArray(o.acts)) throw new Error(`key ${index} acts must be a list.`);
    k.acts = o.acts.map(parseAct).filter((a): a is Action => a != null);
  }
  if (o.launches != null) {
    if (!Array.isArray(o.launches)) throw new Error(`key ${index} launches must be a list.`);
    k.launches = o.launches.map(parseLaunch).filter((L): L is PackLaunch => L != null);
  }
  return k;
}

function parseAct(raw: unknown): Action | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const type = asInt(o.type);
  if (type === undefined) return null;
  return { type, mods: asInt(o.mods) ?? 0, code: asInt(o.code) ?? 0 };
}

function parseLaunch(raw: unknown): PackLaunch | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const path = o.path == null ? "" : String(o.path);
  if (!path.trim()) return null;
  return { path, args: o.args == null ? "" : String(o.args), slot: asInt(o.slot) ?? 0 };
}

function parseAutoSwitch(raw: unknown): PackAutoSwitch {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("autoSwitch must be a mapping.");
  }
  const o = raw as Record<string, unknown>;
  const rulesIn = o.rules == null ? [] : o.rules;
  if (!Array.isArray(rulesIn)) throw new Error("autoSwitch.rules must be a list.");
  const rules: PackSwitchRule[] = [];
  for (const r of rulesIn) {
    if (!r || typeof r !== "object" || Array.isArray(r)) continue;
    const row = r as Record<string, unknown>;
    const exe = row.exe == null ? "" : String(row.exe).trim();
    if (!exe) continue;
    const rule: PackSwitchRule = { exe };
    if ("profileName" in row && row.profileName != null) rule.profileName = String(row.profileName);
    const profile = asInt(row.profile);
    if (profile !== undefined) rule.profile = profile;
    rules.push(rule);
  }
  return { enabled: Boolean(o.enabled), rules };
}

function emptyKey(profile: number, index: number): PadKey {
  return { profile, index, label: "", led: 0, acts: [], text: "" };
}

function ensureKeyRow(snap: Snapshot, destIndex: number) {
  while (snap.keys.length <= destIndex) snap.keys.push([]);
  const row = snap.keys[destIndex];
  for (let i = 0; i < KEY_COUNT; i++) {
    const k = row[i];
    if (!k) row[i] = emptyKey(destIndex, i);
    else k.profile = destIndex;
  }
}

function profileName(snap: Snapshot, index: number): string {
  return snap.profiles.find((p) => p.index === index)?.name ?? "";
}

function uniqueIndices(list: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const n of list) {
    if (!Number.isInteger(n) || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function asInt(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Math.trunc(Number(v));
  return undefined;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
