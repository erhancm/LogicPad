import { ACT, SEND, type Action, type PadKey, type Snapshot } from "./types";

export const TEXT_POOL = 1200;
export const TEXT_MAX = 240;
export const ACT_SLOTS = 12;
export const PROFILE_MAX = 4;

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

export function typedDisplay(key: PadKey): string {
  if (key.text) return key.text;
  return actsToText(key.acts) ?? "";
}

export function hasTextAct(acts: Action[]): boolean {
  return acts.some((a) => a.type === ACT.text);
}

export function withTextStep(key: PadKey, poolOn: boolean): PadKey {
  if (!poolOn) return key;
  const has = hasTextAct(key.acts);
  if (key.text && !has && key.acts.length < ACT_SLOTS) {
    return { ...key, acts: [...key.acts, { type: ACT.text, mods: 0, code: 0 }] };
  }
  return key;
}

export function applyTypedText(key: PadKey, raw: string, poolEnabled: boolean): PadKey {
  const str = raw.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  if (poolEnabled) {
    const text = utf8Truncate(str, TEXT_MAX);
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
  acts: number;
  actMax: number;
  poolEnabled: boolean;
} {
  const poolEnabled = snap.textPool?.enabled ?? false;
  let text = 0;
  let acts = 0;
  for (const row of snap.keys) {
    for (const k of row) {
      if (poolEnabled) text += utf8Len(k.text ?? "");
      acts += k.acts.length;
    }
  }
  return {
    text,
    textMax: snap.textPool?.max ?? TEXT_POOL,
    acts,
    actMax: (snap.keys.length || PROFILE_MAX) * 9 * ACT_SLOTS,
    poolEnabled,
  };
}

export function roomForText(snap: Snapshot, profile: number, index: number): number {
  const mem = memoryOf(snap);
  const cur = utf8Len(snap.keys[profile]?.[index]?.text ?? "");
  return Math.max(0, mem.textMax - (mem.text - cur));
}

export function stemName(path: string): string {
  const p = path.replaceAll("\\", "/");
  const base = p.slice(p.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return (dot > 0 ? base.slice(0, dot) : base).slice(0, 6);
}
