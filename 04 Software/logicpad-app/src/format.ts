import {
  ACT,
  HID_LETTERS,
  MEDIA,
  SEND,
  type Action,
  type LaunchEntry,
  type PadKey,
} from "./types";

export function hidName(hid: number): string {
  return HID_LETTERS.find((h) => h.hid === hid)?.name ?? `0x${hid.toString(16)}`;
}

export function fmtAct(a: Action): string {
  switch (a.type) {
    case ACT.key: {
      const send = a.code >> 8;
      const hid = a.code & 0xff;
      const mods = [
        a.mods & 1 ? "Ctrl" : "",
        a.mods & 2 ? "Shift" : "",
        a.mods & 4 ? "Alt" : "",
        a.mods & 8 ? "Win" : "",
      ]
        .filter(Boolean)
        .join("+");
      const mode = send === SEND.down ? " down" : send === SEND.up ? " up" : "";
      const key = hid ? hidName(hid) : "";
      return [mods, key].filter(Boolean).join("+") + mode || "Key";
    }
    case ACT.delay:
      return `Wait ${a.code} ms`;
    case ACT.consumer:
      return MEDIA.find((m) => m.usage === a.code)?.name ?? "Media";
    case ACT.mouseBtn:
      return "Click";
    case ACT.mouseMove:
      return "Move";
    case ACT.wheel:
      return "Wheel";
    case ACT.release:
      return "Release";
    case ACT.text:
      return "Type text";
    default:
      return "—";
  }
}

export function baseName(path: string): string {
  const p = path.replaceAll("\\", "/");
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

export function launchOf(list: LaunchEntry[], profile: number, key: number): LaunchEntry {
  const found = list.find((l) => l.profile === profile && l.key === key);
  return found
    ? { slot: 0, ...found }
    : { profile, key, path: "", args: "", slot: 0 };
}

function clampSlot(slot: number, nActs: number): number {
  return Math.max(0, Math.min(nActs, slot));
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function fmtText(raw: string): string {
  const t = clip(raw, 40);
  return t ? `Type “${t}”` : "Type text";
}

/** Macro steps in the order the pad runs them, including a PC launch if linked. */
export function keySteps(key: PadKey, launch: LaunchEntry): string[] {
  const lines: string[] = [];
  const showLaunch = Boolean(launch.path);
  const at = showLaunch ? clampSlot(launch.slot ?? 0, key.acts.length) : -1;
  let typed = false;

  const pushAct = (a: Action) => {
    if (a.type === ACT.text) {
      typed = true;
      lines.push(fmtText(key.text ?? ""));
      return;
    }
    lines.push(fmtAct(a));
  };

  key.acts.forEach((a, i) => {
    if (i === at) lines.push(`Launch ${baseName(launch.path)}`);
    pushAct(a);
  });
  if (showLaunch && at >= key.acts.length) {
    lines.push(`Launch ${baseName(launch.path)}`);
  }
  if (!typed && (key.text ?? "").trim()) lines.push(fmtText(key.text));
  return lines;
}
