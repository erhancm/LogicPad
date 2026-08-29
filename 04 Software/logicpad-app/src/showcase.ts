import { ACT, SEND, type LaunchEntry, type PadKey, type ProfileHdr } from "./types";
import { PACK_VERSION, type LogicPadPack } from "./pack";
import { SHOWCASE_SWITCH_CARDS, showcaseSwitchGraph } from "./showcaseGraph";

function tap(hid: number, mods = 0) {
  return { type: ACT.key, mods, code: hid | (SEND.tap << 8) };
}

function K(profile: number, index: number, label: string, led: number, acts: PadKey["acts"], text = ""): PadKey {
  return { profile, index, label, led, acts, text };
}

export function showcaseProfiles(): ProfileHdr[] {
  return [
    { index: 0, name: "Office", lightMode: 1, bright: 7, dim: 3 },
    { index: 1, name: "Browse", lightMode: 3, bright: 7, dim: 3 },
    { index: 2, name: "CAD", lightMode: 5, bright: 8, dim: 2 },
    { index: 3, name: "Files", lightMode: 2, bright: 6, dim: 2 },
    { index: 4, name: "Dev", lightMode: 4, bright: 8, dim: 3 },
    { index: 5, name: "Meet", lightMode: 1, bright: 6, dim: 2 },
    { index: 6, name: "Stream", lightMode: 7, bright: 9, dim: 2 },
    { index: 7, name: "Media", lightMode: 8, bright: 8, dim: 2 },
  ];
}

export function showcaseKeys(): PadKey[][] {
  return [
    [
      K(0, 0, "Copy", 4, [tap(0x06, 1)]),
      K(0, 1, "Paste", 3, [tap(0x19, 1)]),
      K(0, 2, "Save", 1, [tap(0x16, 1)]),
      K(0, 3, "Undo", 2, [tap(0x1d, 1)]),
      K(0, 4, "Bold", 1, [tap(0x05, 2)]),
      K(0, 5, "Find", 4, [tap(0x09, 1)]),
      K(0, 6, "Print", 0, [tap(0x13, 1)]),
      K(0, 7, "Close", 0, [tap(0x1a, 1)]),
      K(0, 8, "Note", 1, [{ type: ACT.text, mods: 0, code: 0 }], "Meeting notes:\n"),
    ],
    [
      K(1, 0, "Tab", 1, [tap(0x04, 1)]),
      K(1, 1, "Reload", 4, [tap(0x15, 1)]),
      K(1, 2, "Back", 4, [tap(0x50, 1)]),
      K(1, 3, "Fwd", 4, [tap(0x4f, 1)]),
      K(1, 4, "Find", 2, [tap(0x09, 1)]),
      K(1, 5, "Home", 3, [tap(0x0e, 1)]),
      K(1, 6, "Full", 0, [tap(0x43)]),
      K(1, 7, "Close", 0, [tap(0x1a, 1)]),
      K(1, 8, "URL", 1, [{ type: ACT.text, mods: 0, code: 0 }], "https://\n"),
    ],
    [
      K(2, 0, "Save", 1, [tap(0x16, 1)]),
      K(2, 1, "Undo", 2, [tap(0x1d, 1)]),
      K(2, 2, "Zoom+", 4, [tap(0x57, 1)]),
      K(2, 3, "Zoom-", 4, [tap(0x56, 1)]),
      K(2, 4, "Pan", 3, [tap(0x25, 1)]),
      K(2, 5, "Meas", 1, [tap(0x14, 1)]),
      K(2, 6, "Grid", 2, [tap(0x0a, 1)]),
      K(2, 7, "Exp", 0, [tap(0x08, 1)]),
      K(2, 8, "CAD", 2, []),
    ],
    [
      K(3, 0, "Copy", 4, [tap(0x06, 1)]),
      K(3, 1, "Paste", 3, [tap(0x19, 1)]),
      K(3, 2, "Ren", 1, [tap(0x15, 1)]),
      K(3, 3, "Del", 2, [tap(0x4c)]),
      K(3, 4, "New", 1, [tap(0x11, 4)]),
      K(3, 5, "Up", 0, [tap(0x52, 1)]),
      K(3, 6, "Sel", 4, [tap(0x04, 1)]),
      K(3, 7, "Path", 1, [{ type: ACT.text, mods: 0, code: 0 }], "C:\\Projects\\\n"),
      K(3, 8, "Exp", 0, []),
    ],
    [
      K(4, 0, "Copy", 4, [tap(0x06, 1)]),
      K(4, 1, "Paste", 3, [tap(0x19, 1)]),
      K(4, 2, "Save", 1, [tap(0x16, 1)]),
      K(4, 3, "Find", 4, [tap(0x09, 1)]),
      K(4, 4, "Run", 1, [tap(0x15, 2)]),
      K(4, 5, "Term", 2, [tap(0x17, 2)]),
      K(4, 6, "Git", 3, [tap(0x0a, 4)]),
      K(4, 7, "Close", 0, [tap(0x1a, 1)]),
      K(4, 8, "Code", 1, []),
    ],
    [
      K(5, 0, "Mute", 2, [{ type: ACT.consumer, mods: SEND.tap, code: 0xe2 }]),
      K(5, 1, "Cam", 1, [tap(0x39, 4)]),
      K(5, 2, "Share", 4, [tap(0x13, 4)]),
      K(5, 3, "Leave", 2, [tap(0x2b, 4)]),
      K(5, 4, "OK", 1, [tap(0x28)]),
      K(5, 5, "Up", 0, [tap(0x52)]),
      K(5, 6, "Down", 0, [tap(0x51)]),
      K(5, 7, "Hand", 3, [tap(0x23, 4)]),
      K(5, 8, "Meet", 1, []),
    ],
    [
      K(6, 0, "Rec", 2, [tap(0x52, 4)]),
      K(6, 1, "Mute", 0, [{ type: ACT.consumer, mods: SEND.tap, code: 0xe2 }]),
      K(6, 2, "Vol+", 0, [{ type: ACT.consumer, mods: SEND.tap, code: 0xe9 }]),
      K(6, 3, "Scene", 3, [tap(0x09, 4)]),
      K(6, 4, "Mic", 1, [tap(0x10, 4)]),
      K(6, 5, "Chat", 4, [tap(0x09, 2)]),
      K(6, 6, "Click", 0, [{ type: ACT.mouseBtn, mods: 1, code: SEND.tap << 8 }]),
      K(6, 7, "Stop", 2, [tap(0x3b, 4)]),
      K(6, 8, "OBS", 2, []),
    ],
    [
      K(7, 0, "Prev", 4, [{ type: ACT.consumer, mods: SEND.tap, code: 0xb6 }]),
      K(7, 1, "Play", 3, [{ type: ACT.consumer, mods: SEND.tap, code: 0xcd }]),
      K(7, 2, "Next", 4, [{ type: ACT.consumer, mods: SEND.tap, code: 0xb5 }]),
      K(7, 3, "Vol+", 2, [{ type: ACT.consumer, mods: SEND.tap, code: 0xe9 }]),
      K(7, 4, "Vol-", 2, [{ type: ACT.consumer, mods: SEND.tap, code: 0xea }]),
      K(7, 5, "Mute", 1, [{ type: ACT.consumer, mods: SEND.tap, code: 0xe2 }]),
      K(7, 6, "Like", 1, [tap(0x0f)]),
      K(7, 7, "Skip", 0, [tap(0x28)]),
      K(7, 8, "Spot", 3, []),
    ],
  ];
}

export function showcaseLaunchesResolved(): LaunchEntry[] {
  return [
    { profile: 2, key: 8, path: "FreeCAD.exe", args: "", slot: 0 },
    { profile: 3, key: 8, path: "explorer.exe", args: "", slot: 0 },
    { profile: 4, key: 8, path: "Cursor.exe", args: "", slot: 0 },
    { profile: 5, key: 8, path: "Teams.exe", args: "", slot: 0 },
    { profile: 6, key: 8, path: "obs64.exe", args: "", slot: 0 },
    { profile: 7, key: 8, path: "Spotify.exe", args: "", slot: 0 },
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
          profileName: profiles[c.profile]?.name,
          profile: c.profile,
        })),
      ),
      graph: showcaseSwitchGraph(),
    },
  };
}
