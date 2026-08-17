export const ACT = {
  none: 0,
  key: 1,
  delay: 2,
  mouseBtn: 3,
  mouseMove: 4,
  wheel: 5,
  consumer: 6,
  release: 7,
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
};

export type Snapshot = {
  meta: Meta;
  profiles: ProfileHdr[];
  keys: PadKey[][];
  textPool?: { enabled: boolean; used: number; max: number };
};

export type LaunchEntry = {
  profile: number;
  key: number;
  path: string;
  args: string;
};

export const HID_LETTERS: { name: string; hid: number }[] = [
  ...Array.from({ length: 26 }, (_, i) => ({
    name: String.fromCharCode(65 + i),
    hid: 0x04 + i,
  })),
  { name: "1", hid: 0x1e },
  { name: "2", hid: 0x1f },
  { name: "3", hid: 0x20 },
  { name: "4", hid: 0x21 },
  { name: "5", hid: 0x22 },
  { name: "6", hid: 0x23 },
  { name: "7", hid: 0x24 },
  { name: "8", hid: 0x25 },
  { name: "9", hid: 0x26 },
  { name: "0", hid: 0x27 },
  { name: "Enter", hid: 0x28 },
  { name: "Esc", hid: 0x29 },
  { name: "Bksp", hid: 0x2a },
  { name: "Tab", hid: 0x2b },
  { name: "Space", hid: 0x2c },
];

export const MEDIA = [
  { name: "Prev", usage: 0xb6 },
  { name: "Play", usage: 0xcd },
  { name: "Next", usage: 0xb5 },
  { name: "Mute", usage: 0xe2 },
  { name: "Vol+", usage: 0xe9 },
  { name: "Vol-", usage: 0xea },
];
