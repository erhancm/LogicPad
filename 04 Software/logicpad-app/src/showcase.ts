import { ACT, SEND, type LaunchEntry, type PadKey, type ProfileHdr } from "./types";
import { PACK_VERSION, type LogicPadPack } from "./pack";
import { SHOWCASE_SWITCH_CARDS, showcaseSwitchGraph } from "./showcaseGraph";

function tap(hid: number, mods = 0) {
  return { type: ACT.key, mods, code: hid | (SEND.tap << 8) };
}

function K(
  profile: number,
  index: number,
  label: string,
  led: number,
  acts: PadKey["acts"],
  text = "",
): PadKey {
  return { profile, index, label, led, acts, text };
}

/** Five rich profiles for product photography and live demos. */
export function showcaseProfiles(): ProfileHdr[] {
  return [
    { index: 0, name: "Create", lightMode: 5, bright: 8, dim: 3 },
    { index: 1, name: "Stream", lightMode: 7, bright: 9, dim: 2 },
    { index: 2, name: "Meet", lightMode: 1, bright: 6, dim: 2 },
    { index: 3, name: "Browse", lightMode: 3, bright: 7, dim: 3 },
    { index: 4, name: "Play", lightMode: 8, bright: 8, dim: 2 },
  ];
}

export function showcaseKeys(): PadKey[][] {
  return [
    [
      K(0, 0, "Copy", 4, [tap(0x06, 1)]),
      K(0, 1, "Paste", 3, [tap(0x19, 1)]),
      K(0, 2, "Undo", 2, [tap(0x1d, 1)]),
      K(0, 3, "Save", 1, [tap(0x16, 1)]),
      K(0, 4, "Find", 4, [tap(0x09, 1)]),
      K(0, 5, "Run", 1, [tap(0x15, 2)]),
      K(0, 6, "Term", 2, [tap(0x17, 2)]),
      K(0, 7, "Close", 0, [tap(0x1a, 1)]),
      K(0, 8, "Snippet", 1, [{ type: ACT.text, mods: 0, code: 0 }], "// LogicPad demo\n"),
    ],
    [
      K(1, 0, "Rec", 2, [tap(0x52, 4)]),
      K(1, 1, "Mute", 0, [{ type: ACT.consumer, mods: SEND.tap, code: 0xe2 }]),
      K(1, 2, "Vol+", 0, [{ type: ACT.consumer, mods: SEND.tap, code: 0xe9 }]),
      K(1, 3, "Vol-", 0, [{ type: ACT.consumer, mods: SEND.tap, code: 0xea }]),
      K(1, 4, "Scene", 3, [tap(0x09, 4)]),
      K(1, 5, "Mic", 1, [tap(0x10, 4)]),
      K(1, 6, "Chat", 4, [tap(0x09, 2)]),
      K(1, 7, "Click", 0, [{ type: ACT.mouseBtn, mods: 1, code: SEND.tap << 8 }]),
      K(1, 8, "OBS", 2, []),
    ],
    [
      K(2, 0, "Mute", 2, [{ type: ACT.consumer, mods: SEND.tap, code: 0xe2 }]),
      K(2, 1, "Cam", 1, [tap(0x39, 4)]),
      K(2, 2, "Share", 4, [tap(0x13, 4)]),
      K(2, 3, "Leave", 2, [tap(0x2b, 4)]),
      K(2, 4, "OK", 1, [tap(0x28)]),
      K(2, 5, "Up", 0, [tap(0x52)]),
      K(2, 6, "Down", 0, [tap(0x51)]),
      K(2, 7, "Hand", 3, [tap(0x23, 4)]),
      K(2, 8, "Teams", 1, []),
    ],
    [
      K(3, 0, "NewTab", 1, [tap(0x04, 1)]),
      K(3, 1, "Close", 0, [tap(0x1a, 1)]),
      K(3, 2, "Back", 4, [tap(0x50, 1)]),
      K(3, 3, "Fwd", 4, [tap(0x4f, 1)]),
      K(3, 4, "Reload", 1, [tap(0x15, 1)]),
      K(3, 5, "Find", 2, [tap(0x09, 1)]),
      K(3, 6, "Home", 3, [tap(0x0e, 1)]),
      K(3, 7, "Full", 0, [tap(0x43)]),
      K(3, 8, "URL", 1, [{ type: ACT.text, mods: 0, code: 0 }], "logicpad.dev\n"),
    ],
    [
      K(4, 0, "Prev", 4, [{ type: ACT.consumer, mods: SEND.tap, code: 0xb6 }]),
      K(4, 1, "Play", 3, [{ type: ACT.consumer, mods: SEND.tap, code: 0xcd }]),
      K(4, 2, "Next", 4, [{ type: ACT.consumer, mods: SEND.tap, code: 0xb5 }]),
      K(4, 3, "Vol+", 2, [{ type: ACT.consumer, mods: SEND.tap, code: 0xe9 }]),
      K(4, 4, "Vol-", 2, [{ type: ACT.consumer, mods: SEND.tap, code: 0xea }]),
      K(4, 5, "Mute", 1, [{ type: ACT.consumer, mods: SEND.tap, code: 0xe2 }]),
      K(4, 6, "Like", 1, [tap(0x0f)]),
      K(4, 7, "Skip", 0, [tap(0x28)]),
      K(4, 8, "Macro", 3, [
        { type: ACT.delay, mods: 0, code: 120 },
        tap(0x04, 2),
        { type: ACT.delay, mods: 0, code: 80 },
        tap(0x28),
      ]),
    ],
  ];
}

export function showcaseLaunchesResolved(): LaunchEntry[] {
  return [
    { profile: 0, key: 8, path: "Cursor.exe", args: "", slot: 0 },
    { profile: 1, key: 8, path: "obs64.exe", args: "", slot: 0 },
    { profile: 2, key: 8, path: "Teams.exe", args: "", slot: 0 },
  ];
}

export function showcaseYamlPack(): LogicPadPack {
  const profiles = showcaseProfiles();
  const keys = showcaseKeys();
  return {
    logicpadPack: PACK_VERSION,
    exportedAt: new Date().toISOString(),
    profiles: profiles.map((hdr, pi) => ({
      name: hdr.name,
      lightMode: hdr.lightMode,
      bright: hdr.bright,
      dim: hdr.dim,
      keys: keys[pi].map((k) => ({
        index: k.index,
        label: k.label,
        led: k.led,
        acts: k.acts.map((a) => ({ type: a.type, mods: a.mods, code: a.code })),
        text: k.text,
        launches:
          k.index === 8
            ? showcaseLaunchesResolved()
                .filter((l) => l.profile === pi)
                .map((l) => ({ path: l.path, args: l.args ?? "", slot: l.slot ?? 0 }))
            : undefined,
      })),
    })),
    autoSwitch: {
      enabled: true,
      rules: SHOWCASE_SWITCH_CARDS.flatMap((c) =>
        c.programs.map((exe) => ({
          exe,
          profileName: showcaseProfiles()[c.profile]?.name,
          profile: c.profile,
        })),
      ),
      graph: showcaseSwitchGraph(),
    },
  };
}
