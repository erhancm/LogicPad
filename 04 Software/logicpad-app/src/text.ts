import { ACT, SEND, type Action, type PadKey, type Snapshot } from "./types";

export const TEXT_POOL = 1200;
export const TEXT_MAX = 240;
export const ACT_SLOTS = 12;
export const TITLE_MAX = 12;
export const LABEL_HID = 6;

type HidCh = { hid: number; mods: number; ch: string };

const PUNCT: [string, number, number][] = [
  ["!", 0x1e, 2],
  ["@", 0x1f, 2],
  ["#", 0x20, 2],
  ["$", 0x21, 2],
  ["%", 0x22, 2],
  ["^", 0x23, 2],
  ["&", 0x24, 2],
  ["*", 0x25, 2],
  ["(", 0x26, 2],
  [")", 0x27, 2],
  ["-", 0x2d, 0],
  ["_", 0x2d, 2],
  ["=", 0x2e, 0],
  ["+", 0x2e, 2],
  ["[", 0x2f, 0],
  ["{", 0x2f, 2],
  ["]", 0x30, 0],
  ["}", 0x30, 2],
  ["\\", 0x31, 0],
  ["|", 0x31, 2],
  [";", 0x33, 0],
  [":", 0x33, 2],
  ["'", 0x34, 0],
  ['"', 0x34, 2],
  ["`", 0x35, 0],
  ["~", 0x35, 2],
  [",", 0x36, 0],
  ["<", 0x36, 2],
  [".", 0x37, 0],
  [">", 0x37, 2],
  ["/", 0x38, 0],
  ["?", 0x38, 2],
];

function asciiHid(c: string): { hid: number; mods: number } | null {
  if (c.length !== 1) return null;
  const code = c.charCodeAt(0);
  if (code >= 97 && code <= 122) return { hid: 0x04 + (code - 97), mods: 0 };
  if (code >= 65 && code <= 90) return { hid: 0x04 + (code - 65), mods: 2 };
  if (code >= 49 && code <= 57) return { hid: 0x1e + (code - 49), mods: 0 };
  if (c === "0") return { hid: 0x27, mods: 0 };
  if (c === "\n") return { hid: 0x28, mods: 0 };
  if (c === "\b") return { hid: 0x2a, mods: 0 };
  if (c === "\t") return { hid: 0x2b, mods: 0 };
  if (c === " ") return { hid: 0x2c, mods: 0 };
  const p = PUNCT.find(([ch]) => ch === c);
  if (p) return { hid: p[1], mods: p[2] };
  return null;
}

const HID_TO_CH: HidCh[] = (() => {
  const out: HidCh[] = [];
  for (let i = 0; i < 26; i++) {
    out.push({ hid: 0x04 + i, mods: 0, ch: String.fromCharCode(97 + i) });
    out.push({ hid: 0x04 + i, mods: 2, ch: String.fromCharCode(65 + i) });
  }
  for (let i = 0; i < 9; i++) {
    out.push({ hid: 0x1e + i, mods: 0, ch: String.fromCharCode(49 + i) });
  }
  out.push({ hid: 0x27, mods: 0, ch: "0" });
  out.push({ hid: 0x28, mods: 0, ch: "\n" });
  out.push({ hid: 0x2a, mods: 0, ch: "\b" });
  out.push({ hid: 0x2b, mods: 0, ch: "\t" });
  out.push({ hid: 0x2c, mods: 0, ch: " " });
  for (const [ch, hid, mods] of PUNCT) {
    out.push({ hid, mods, ch });
  }
  return out;
})();

export function utf8Len(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function utf8Truncate(s: string, max: number): string {
  const b = new TextEncoder().encode(s);
  if (b.length <= max) return s;
  let n = max;
  while (n > 0 && (b[n] & 0xc0) === 0x80) n--;
  return new TextDecoder().decode(b.slice(0, n));
}

export function textToActions(s: string, max: number): { acts: Action[]; leftover: string } {
  const acts: Action[] = [];
  let i = 0;
  const chars = [...s.replaceAll("\r\n", "\n").replaceAll("\r", "\n")];
  while (i < chars.length && acts.length < max) {
    const h = asciiHid(chars[i]);
    if (h) {
      acts.push({ type: ACT.key, mods: h.mods, code: h.hid | (SEND.tap << 8) });
    }
    i++;
  }
  return { acts, leftover: chars.slice(i).join("") };
}

export function actsToText(acts: Action[]): string | null {
  if (acts.length === 0) return "";
  let out = "";
  for (const a of acts) {
    if (a.type !== ACT.key) return null;
    const send = a.code >> 8;
    if (send !== SEND.tap) return null;
    const hid = a.code & 0xff;
    const ch = HID_TO_CH.find((h) => h.hid === hid && h.mods === a.mods);
    if (!ch) return null;
    out += ch.ch;
  }
  return out;
}

function nl(s: string): string {
  return s.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function decodeSlice(blob: string, off: number, len: number): string {
  const b = new TextEncoder().encode(blob ?? "");
  if (off >= b.length || len <= 0) return "";
  const end = Math.min(b.length, off + len);
  return new TextDecoder().decode(b.slice(off, end));
}

export function textActIndices(acts: Action[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < acts.length; i++) {
    if (acts[i].type === ACT.text) out.push(i);
  }
  return out;
}

export function hasTextAct(acts: Action[]): boolean {
  return acts.some((a) => a.type === ACT.text);
}

/**
 * Bytes [code, code+mods) of key.text. mods==0 is "to end of blob" when this is
 * the only text act (OLED / old saves: mods=0,code=0 types everything). With
 * several text acts, mods==0 is an empty slice (packed at blob end).
 */
export function segmentOf(key: PadKey, actIndex: number): string {
  const a = key.acts[actIndex];
  if (!a || a.type !== ACT.text) return "";
  const blob = key.text ?? "";
  const blobN = utf8Len(blob);
  const off = a.code & 0xffff;
  if (a.mods > 0) return decodeSlice(blob, off, a.mods);
  const nText = textActIndices(key.acts).length;
  if (nText <= 1) return decodeSlice(blob, off, Math.max(0, blobN - off));
  return "";
}

/** Whole blob, or tap-decoded text when the pool is off. */
export function typedDisplay(key: PadKey): string {
  if (key.text) return key.text;
  return actsToText(key.acts) ?? "";
}

/** Per-step string for the Type text editor. Prefer this over typedDisplay. */
export function typedDisplayAt(key: PadKey, actIndex: number): string {
  const a = key.acts[actIndex];
  if (!a) return "";
  if (a.type === ACT.text) return segmentOf(key, actIndex);
  return "";
}

function packFromParts(key: PadKey, parts: string[], room: number): PadKey {
  const idxs = textActIndices(key.acts);
  const cap = Math.min(TEXT_MAX, Math.max(0, room));
  const packed: string[] = [];
  let used = 0;
  const n = Math.min(idxs.length, parts.length);
  for (let i = 0; i < n; i++) {
    const avail = Math.max(0, cap - used);
    const t = utf8Truncate(parts[i] ?? "", avail);
    packed.push(t);
    used += utf8Len(t);
  }
  while (packed.length < idxs.length) packed.push("");
  const blob = packed.join("");
  const blobLen = utf8Len(blob);
  const acts = key.acts.slice();
  let off = 0;
  for (let i = 0; i < idxs.length; i++) {
    const len = utf8Len(packed[i] ?? "");
    if (len === 0) {
      acts[idxs[i]] = { type: ACT.text, mods: 0, code: blobLen };
    } else {
      acts[idxs[i]] = { type: ACT.text, mods: Math.min(255, len), code: off };
      off += len;
    }
  }
  return { ...key, acts, text: blob };
}

export function withTextStep(key: PadKey, poolOn: boolean): PadKey {
  if (!poolOn) return key;
  if (hasTextAct(key.acts)) return key;
  if (!(key.text ?? "") || key.acts.length >= ACT_SLOTS) return key;
  const n = utf8Len(key.text ?? "");
  return {
    ...key,
    acts: [...key.acts, { type: ACT.text, mods: n > 0 && n <= 255 ? n : 0, code: 0 }],
  };
}

export function setSegment(
  key: PadKey,
  actIndex: number,
  raw: string,
  poolEnabled: boolean,
  room = TEXT_MAX,
): PadKey {
  const str = nl(raw);
  const a = key.acts[actIndex];
  if (!a || a.type !== ACT.text) return key;
  if (!poolEnabled) {
    const others = key.acts.length - 1;
    const maxTaps = Math.max(0, ACT_SLOTS - others);
    const { acts: taps } = textToActions(str, maxTaps);
    const acts = [...key.acts.slice(0, actIndex), ...taps, ...key.acts.slice(actIndex + 1)];
    return { ...key, acts: acts.slice(0, ACT_SLOTS), text: str };
  }
  const idxs = textActIndices(key.acts);
  const others = idxs
    .filter((i) => i !== actIndex)
    .reduce((n, i) => n + utf8Len(segmentOf(key, i)), 0);
  const cap = Math.min(TEXT_MAX, room);
  const thisPart = utf8Truncate(str, Math.max(0, cap - others));
  const parts = idxs.map((i) => (i === actIndex ? thisPart : segmentOf(key, i)));
  return packFromParts(key, parts, room);
}

export function addTextAct(key: PadKey, poolEnabled: boolean): PadKey {
  if (key.acts.length >= ACT_SLOTS) return key;
  if (!poolEnabled) {
    return { ...key, acts: [...key.acts, { type: ACT.text, mods: 0, code: 0 }] };
  }
  const parts = textActIndices(key.acts).map((i) => segmentOf(key, i));
  parts.push("");
  const acts = [...key.acts, { type: ACT.text, mods: 0, code: 0 }];
  return packFromParts({ ...key, acts }, parts, TEXT_MAX);
}

export function removeAct(key: PadKey, index: number): PadKey {
  if (index < 0 || index >= key.acts.length) return key;
  const a = key.acts[index];
  const acts = key.acts.filter((_, i) => i !== index);
  if (a.type !== ACT.text) return { ...key, acts };
  const parts = textActIndices(key.acts)
    .filter((i) => i !== index)
    .map((i) => segmentOf(key, i));
  if (parts.length === 0) return { ...key, acts, text: "" };
  return packFromParts({ ...key, acts }, parts, TEXT_MAX);
}

export function applyTypedText(
  key: PadKey,
  raw: string,
  poolEnabled: boolean,
  room = TEXT_MAX,
): PadKey {
  const str = nl(raw);
  const idxs = textActIndices(key.acts);
  if (idxs.length >= 1) return setSegment(key, idxs[0], str, poolEnabled, room);
  if (poolEnabled) {
    const text = utf8Truncate(str, Math.min(TEXT_MAX, room));
    return withTextStep({ ...key, text }, true);
  }
  const { acts } = textToActions(str, ACT_SLOTS);
  return { ...key, acts, text: str };
}

export function moveAct(acts: Action[], index: number, dir: -1 | 1): Action[] {
  const j = index + dir;
  if (index < 0 || j < 0 || index >= acts.length || j >= acts.length) return acts;
  const next = acts.slice();
  const tmp = next[index];
  next[index] = next[j];
  next[j] = tmp;
  return next;
}

export function memoryOf(snap: Snapshot): {
  text: number;
  textMax: number;
  store: number;
  storeMax: number;
  poolEnabled: boolean;
} {
  const poolEnabled = snap.textPool?.enabled ?? false;
  let text = 0;
  for (const row of snap.keys) {
    for (const k of row) {
      if (poolEnabled) text += utf8Len(k.text ?? "");
    }
  }
  const storeMax = snap.meta.storeCap ?? 0;
  const store = snap.meta.storeUsed ?? 0;
  return {
    text,
    textMax: snap.textPool?.max ?? TEXT_POOL,
    store,
    storeMax,
    poolEnabled,
  };
}

export function roomForText(snap: Snapshot, profile: number, index: number): number {
  const mem = memoryOf(snap);
  const cur = utf8Len(snap.keys[profile]?.[index]?.text ?? "");
  return Math.max(0, mem.textMax - (mem.text - cur));
}

export function stemName(path: string, max = TITLE_MAX): string {
  const p = path.replaceAll("\\", "/");
  const base = p.slice(p.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return (dot > 0 ? base.slice(0, dot) : base).slice(0, max);
}

export function macrosEqual(a: PadKey, b: PadKey): boolean {
  if (a.acts.length !== b.acts.length) return false;
  if ((a.text ?? "") !== (b.text ?? "")) return false;
  return a.acts.every(
    (act, i) =>
      act.type === b.acts[i].type && act.mods === b.acts[i].mods && act.code === b.acts[i].code,
  );
}

/** Index of another key in the same profile with this title and a different macro, or null. */
export function titleConflict(row: PadKey[], next: PadKey): number | null {
  const t = next.label.trim();
  if (!t) return null;
  for (const k of row) {
    if (k.index === next.index) continue;
    if (k.label.trim() !== t) continue;
    if (!macrosEqual(k, next)) return k.index;
  }
  return null;
}

export function uniqueTitle(row: PadKey[], index: number, wanted: string, max = TITLE_MAX): string {
  const base = wanted.trim().slice(0, max);
  if (!base) return "";
  const at = row[index] ?? {
    profile: 0,
    index,
    label: "",
    led: 0,
    acts: [],
    text: "",
  };
  const draft = { ...at, index, label: base };
  if (titleConflict(row, draft) == null) return base;
  for (let n = 2; n <= 9; n++) {
    const suffix = String(n);
    const cut = base.slice(0, Math.max(1, max - suffix.length)) + suffix;
    if (titleConflict(row, { ...draft, label: cut }) == null) return cut;
  }
  return base;
}

/** Unique 12-character profile name among `existing` (other slots). */
export function uniqueProfileName(existing: string[], wanted: string, max = TITLE_MAX): string {
  const taken = new Set(existing.map((n) => n.trim().toLowerCase()).filter(Boolean));
  const seed = wanted.trim().slice(0, max);
  if (!seed) return "";
  if (!taken.has(seed.toLowerCase())) return seed;
  for (let n = 2; n <= 99; n++) {
    const suffix = ` ${n}`;
    const cut = seed.slice(0, Math.max(1, max - suffix.length)) + suffix;
    if (!taken.has(cut.toLowerCase())) return cut;
  }
  return seed;
}
