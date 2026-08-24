export const ACT = {
  none: 0,
  key: 1,
  delay: 2,
  mouseBtn: 3,
  mouseMove: 4,
  wheel: 5,
  consumer: 6,
  release: 7,
  text: 8,
} as const;

export const SEND = { tap: 0, down: 1, up: 2 } as const;

export const LEDS = ["Off", "White", "Red", "Green", "Blue"] as const;

export const LIGHT_MODES = [
  "Off",
  "Solid",
  "React",
  "Breathe",
  "Wave",
  "Ring",
  "Ripple",
  "Rain",
  "Heart",
  "Cross",
  "Twinkle",
  "Full White",
  "Full Red",
  "Full Green",
  "Full Blue",
] as const;

export type Action = { type: number; mods: number; code: number };

export type PadKey = {
  profile: number;
  index: number;
  label: string;
  led: number;
  acts: Action[];
  text: string;
};

export type ProfileHdr = {
  index: number;
  name: string;
  lightMode: number;
  bright: number;
  dim: number;
};

export type Meta = {
  active: number;
  dirty: boolean;
  contrast: number;
  flip: number;
  sleep: number;
  inMenu: boolean;
  usb: boolean;
  nProfiles?: number;
};

export type Snapshot = {
  meta: Meta;
  profiles: ProfileHdr[];
  keys: PadKey[][];
  textPool?: { enabled: boolean; used: number; max: number };
  canMutateProfiles?: boolean;
};

export type LaunchEntry = {
  profile: number;
  key: number;
  path: string;
  args: string;
  /** Visual index in the combined action list (0 = first). */
  slot?: number;
};

export type ResolvedProgram = {
  path: string;
  args: string;
};

export type HidKey = { name: string; hid: number };

export const HID_ALPHA: HidKey[] = Array.from({ length: 26 }, (_, i) => ({
  name: String.fromCharCode(65 + i),
  hid: 0x04 + i,
}));

export const HID_DIGIT: HidKey[] = [
  ...Array.from({ length: 9 }, (_, i) => ({ name: String(i + 1), hid: 0x1e + i })),
  { name: "0", hid: 0x27 },
];

export const HID_NAV: HidKey[] = [
  { name: "←", hid: 0x50 },
  { name: "→", hid: 0x4f },
  { name: "↑", hid: 0x52 },
  { name: "↓", hid: 0x51 },
  { name: "Ins", hid: 0x49 },
  { name: "Del", hid: 0x4c },
  { name: "Home", hid: 0x4a },
  { name: "End", hid: 0x4d },
  { name: "PgUp", hid: 0x4b },
  { name: "PgDn", hid: 0x4e },
];

export const HID_FN: HidKey[] = Array.from({ length: 12 }, (_, i) => ({
  name: `F${i + 1}`,
  hid: 0x3a + i,
}));

export const HID_MORE: HidKey[] = [
  { name: "Caps", hid: 0x39 },
  { name: "Menu", hid: 0x65 },
  { name: "PrtSc", hid: 0x46 },
  { name: "Pause", hid: 0x48 },
];

/** Lookup table for labels (includes keys that also live under Sys). */
export const HID_LETTERS: HidKey[] = [
  ...HID_ALPHA,
  ...HID_DIGIT,
  { name: "Enter", hid: 0x28 },
  { name: "Esc", hid: 0x29 },
  { name: "Bksp", hid: 0x2a },
  { name: "Tab", hid: 0x2b },
  { name: "Space", hid: 0x2c },
  ...HID_MORE,
  ...HID_NAV,
  ...HID_FN,
];

/** Standalone taps (Win/Alt/Ctrl/Shift live in the modifier byte). */
export const HID_SPECIALS: { name: string; hid: number; mods: number }[] = [
  { name: "Win", hid: 0, mods: 8 },
  { name: "Alt", hid: 0, mods: 4 },
  { name: "Ctrl", hid: 0, mods: 1 },
  { name: "Shift", hid: 0, mods: 2 },
  { name: "Tab", hid: 0x2b, mods: 0 },
  { name: "Esc", hid: 0x29, mods: 0 },
  { name: "Enter", hid: 0x28, mods: 0 },
  { name: "Space", hid: 0x2c, mods: 0 },
  { name: "Bksp", hid: 0x2a, mods: 0 },
];

export const MEDIA = [
  { name: "Prev", usage: 0xb6 },
  { name: "Play", usage: 0xcd },
  { name: "Next", usage: 0xb5 },
  { name: "Mute", usage: 0xe2 },
  { name: "Vol+", usage: 0xe9 },
  { name: "Vol-", usage: 0xea },
];
