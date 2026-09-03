import { ACT, SEND, type LaunchEntry, type PadKey, type ProfileHdr } from "./types";
import { PACK_VERSION, type LogicPadPack } from "./pack";
import { PRODUCTIVITY_SWITCH_CARDS, productivitySwitchGraph } from "./productivityGraph";

function tap(hid: number, mods = 0) {
  return { type: ACT.key, mods, code: hid | (SEND.tap << 8) };
}

function K(profile: number, index: number, label: string, led: number, acts: PadKey["acts"], text = ""): PadKey {
  return { profile, index, label, led, acts, text };
}

export function productivityProfiles(): ProfileHdr[] {
  return [
    { index: 0, name: "Office", lightMode: 1, bright: 7, dim: 3 },
    { index: 1, name: "Files", lightMode: 2, bright: 6, dim: 2 },
    { index: 2, name: "Browse", lightMode: 3, bright: 7, dim: 3 },
    { index: 3, name: "CAD", lightMode: 5, bright: 8, dim: 2 },
    { index: 4, name: "Outlook", lightMode: 1, bright: 6, dim: 2 },
    { index: 5, name: "Teams", lightMode: 4, bright: 6, dim: 2 },
    { index: 6, name: "Media", lightMode: 7, bright: 8, dim: 2 },
  ];
}

export function productivityKeys(): PadKey[][] {
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
      K(0, 8, "Note", 1, [{ type: ACT.text, mods: 0, code: 0 }], "Notes:\n"),
    ],
    [
      K(1, 0, "Copy", 4, [tap(0x06, 1)]),
      K(1, 1, "Paste", 3, [tap(0x19, 1)]),
      K(1, 2, "Ren", 1, [tap(0x15, 1)]),
      K(1, 3, "Del", 2, [tap(0x4c)]),
      K(1, 4, "New", 1, [tap(0x11, 4)]),
      K(1, 5, "Up", 0, [tap(0x52, 1)]),
      K(1, 6, "Sel", 4, [tap(0x04, 1)]),
      K(1, 7, "Path", 1, [{ type: ACT.text, mods: 0, code: 0 }], "C:\\Users\\\n"),
      K(1, 8, "Exp", 0, []),
    ],
    [
      K(2, 0, "Tab", 1, [tap(0x04, 1)]),
      K(2, 1, "Reload", 4, [tap(0x15, 1)]),
      K(2, 2, "Back", 4, [tap(0x50, 1)]),
      K(2, 3, "Fwd", 4, [tap(0x4f, 1)]),
      K(2, 4, "Find", 2, [tap(0x09, 1)]),
      K(2, 5, "Home", 3, [tap(0x0e, 1)]),
      K(2, 6, "Full", 0, [tap(0x43)]),
      K(2, 7, "Close", 0, [tap(0x1a, 1)]),
      K(2, 8, "URL", 1, [{ type: ACT.text, mods: 0, code: 0 }], "https://\n"),
    ],
    [
      K(3, 0, "Save", 1, [tap(0x16, 1)]),
      K(3, 1, "Undo", 2, [tap(0x1d, 1)]),
      K(3, 2, "Fit", 4, [tap(0x0f)]),
      K(3, 3, "Build", 1, [tap(0x05, 1)]),
      K(3, 4, "Front", 3, [tap(0x1e, 1)]),
      K(3, 5, "Iso", 2, [tap(0x24, 1)]),
      K(3, 6, "Pan", 0, [tap(0x2c)]),
      K(3, 7, "Close", 0, [tap(0x1a, 1)]),
      K(3, 8, "SW", 2, []),
    ],
    [
      K(4, 0, "Reply", 4, [tap(0x15, 1)]),
      K(4, 1, "All", 3, [tap(0x15, 3)]),
      K(4, 2, "Fwd", 1, [tap(0x09, 1)]),
      K(4, 3, "Send", 1, [tap(0x28, 1)]),
      K(4, 4, "Del", 2, [tap(0x4c)]),
      K(4, 5, "Flag", 4, [tap(0x0a, 3)]),
      K(4, 6, "Mail", 0, [tap(0x1e, 1)]),
      K(4, 7, "Cal", 0, [tap(0x1f, 1)]),
      K(4, 8, "Mail", 1, []),
    ],
    [
      K(5, 0, "Mute", 2, [tap(0x10, 3)]),
      K(5, 1, "Cam", 1, [tap(0x12, 3)]),
      K(5, 2, "Share", 4, [tap(0x08, 3)]),
      K(5, 3, "Leave", 2, [tap(0x0b, 3)]),
      K(5, 4, "Hand", 3, [tap(0x0e, 3)]),
      K(5, 5, "Chat", 4, [tap(0x09, 2)]),
      K(5, 6, "Vol-", 0, [{ type: ACT.consumer, mods: SEND.tap, code: 0xea }]),
      K(5, 7, "Vol+", 0, [{ type: ACT.consumer, mods: SEND.tap, code: 0xe9 }]),
      K(5, 8, "Teams", 1, []),
    ],
    [
      K(6, 0, "Prev", 4, [{ type: ACT.consumer, mods: SEND.tap, code: 0xb6 }]),
      K(6, 1, "Play", 3, [{ type: ACT.consumer, mods: SEND.tap, code: 0xcd }]),
      K(6, 2, "Next", 4, [{ type: ACT.consumer, mods: SEND.tap, code: 0xb5 }]),
      K(6, 3, "Vol+", 2, [{ type: ACT.consumer, mods: SEND.tap, code: 0xe9 }]),
      K(6, 4, "Vol-", 2, [{ type: ACT.consumer, mods: SEND.tap, code: 0xea }]),
      K(6, 5, "Mute", 1, [{ type: ACT.consumer, mods: SEND.tap, code: 0xe2 }]),
      K(6, 6, "Stop", 0, [{ type: ACT.consumer, mods: SEND.tap, code: 0xb7 }]),
      K(6, 7, "", 0, []),
      K(6, 8, "Spot", 3, []),
    ],
  ];
}

export function productivityLaunchesResolved(): LaunchEntry[] {
  return [
    { profile: 1, key: 8, path: "explorer.exe", args: "", slot: 0 },
    { profile: 3, key: 8, path: "SLDWORKS.exe", args: "", slot: 0 },
    { profile: 4, key: 8, path: "OUTLOOK.EXE", args: "", slot: 0 },
    { profile: 5, key: 8, path: "Teams.exe", args: "", slot: 0 },
    { profile: 6, key: 8, path: "Spotify.exe", args: "", slot: 0 },
  ];
}

export function productivityYamlPack(): LogicPadPack {
  const profiles = productivityProfiles();
  const keys = productivityKeys();
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
            ? productivityLaunchesResolved()
                .filter((l) => l.profile === pi)
                .map((l) => ({ path: l.path, args: l.args ?? "", slot: l.slot ?? 0 }))
            : undefined,
      })),
    })),
    autoSwitch: {
      enabled: true,
      rules: PRODUCTIVITY_SWITCH_CARDS.flatMap((c) =>
        c.programs.map((exe) => ({
          exe,
          profileName: profiles[c.profile]?.name,
          profile: c.profile,
        })),
      ),
      graph: productivitySwitchGraph(),
    },
  };
}
