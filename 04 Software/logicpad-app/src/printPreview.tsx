import { useState } from "react";
import { ACT, SEND, type LaunchEntry, type PadKey, type Snapshot } from "./types";
import { PrintOverlay } from "./PrintSheet";

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

function tap(hid: number, mods = 0): PadKey["acts"][number] {
  return { type: ACT.key, mods, code: hid | (SEND.tap << 8) };
}

/** Local-only sample used by `?printPreview` during `npm run dev`. */
export function PrintPreviewDev() {
  const [all, setAll] = useState(
    () => new URLSearchParams(window.location.search).get("printPreview") !== "one",
  );
  const keys: PadKey[][] = [
    [
      K(0, 0, "Copy", 2, [tap(0x06, 1)]),
      K(0, 1, "Paste", 3, [tap(0x19, 1)]),
      K(0, 2, "Cut", 4, [tap(0x1b, 1)]),
      K(0, 3, "Undo", 0, [tap(0x1d, 1)]),
      K(0, 4, "Save", 1, [tap(0x16, 1)]),
      K(0, 5, "New", 0, [tap(0x11, 1)]),
      K(0, 6, "Find", 0, [tap(0x09, 1)]),
      K(0, 7, "Close", 0, [tap(0x1a, 1)]),
      K(0, 8, "Hello", 0, [{ type: ACT.text, mods: 0, code: 0 }], "Hello from LogicPad"),
    ],
    [
      K(1, 0, "Mute", 0, [{ type: ACT.consumer, mods: SEND.tap, code: 0xe2 }]),
      K(1, 1, "Vol-", 0, [{ type: ACT.consumer, mods: SEND.tap, code: 0xea }]),
      K(1, 2, "Vol+", 0, [{ type: ACT.consumer, mods: SEND.tap, code: 0xe9 }]),
      K(1, 3, "Prev", 0, [{ type: ACT.consumer, mods: SEND.tap, code: 0xb6 }]),
      K(1, 4, "Play", 3, [{ type: ACT.consumer, mods: SEND.tap, code: 0xcd }]),
      K(1, 5, "Next", 0, [{ type: ACT.consumer, mods: SEND.tap, code: 0xb5 }]),
      K(1, 6, "Click", 0, [{ type: ACT.mouseBtn, mods: 1, code: SEND.tap << 8 }]),
      K(1, 7, "", 0, []),
      K(1, 8, "Wait", 0, [{ type: ACT.delay, mods: 0, code: 200 }, tap(0x28)]),
    ],
    [
      K(2, 0, "Win", 0, [tap(0, 8)]),
      K(2, 1, "Shot", 2, [tap(0x46)]),
      K(2, 2, "Desk", 0, [tap(0x07, 8)]),
      K(2, 3, "", 0, []),
      K(2, 4, "OK", 1, [tap(0x28)]),
      K(2, 5, "", 0, []),
      K(2, 6, "", 0, []),
      K(2, 7, "Down", 0, [tap(0x51)]),
      K(2, 8, "Code", 0, [tap(0x06, 1), { type: ACT.delay, mods: 0, code: 50 }, tap(0x19, 1)]),
    ],
  ];
  const snap: Snapshot = {
    meta: {
      active: 0,
      dirty: false,
      contrast: 0,
      flip: 0,
      sleep: 0,
      inMenu: false,
      usb: true,
      nProfiles: 3,
    },
    profiles: [
      { index: 0, name: "Work", lightMode: 4, bright: 8, dim: 3 },
      { index: 1, name: "Media", lightMode: 2, bright: 6, dim: 2 },
      { index: 2, name: "Desk", lightMode: 1, bright: 7, dim: 2 },
    ],
    keys,
  };
  const launches: LaunchEntry[] = [
    { profile: 2, key: 8, path: "C:\\Program Files\\Cursor\\Cursor.exe", args: "", slot: 0 },
  ];
  return (
    <PrintOverlay
      snap={snap}
      launches={launches}
      allProfiles={all}
      onAllProfiles={setAll}
      onClose={() => {
        const u = new URL(window.location.href);
        u.searchParams.delete("printPreview");
        window.location.search = u.search;
      }}
      onPrint={() => window.print()}
    />
  );
}
