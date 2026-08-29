import { newLaunchId } from "./launches";
import type { LaunchEntry, Snapshot, SwitchConfig } from "./types";
import { api } from "./api";
import { showcaseKeys, showcaseLaunchesResolved, showcaseProfiles } from "./showcase";
import { showcaseSwitchConfig } from "./showcaseGraph";

export type ShowcaseApplyResult = {
  snap: Snapshot;
  launches: LaunchEntry[];
  switchCfg: SwitchConfig;
};

/** Push the advertising demo onto the connected pad and save to flash. */
export async function applyShowcaseToPad(
  snap: Snapshot,
  launches: LaunchEntry[],
  _switchCfg: SwitchConfig,
): Promise<ShowcaseApplyResult> {
  let cur = snap;
  let curLaunches = [...launches];

  while ((cur.profiles.length ?? 0) < 8 && cur.canAddProfiles !== false) {
    cur = await api.addProfile();
  }

  const targetProfiles = showcaseProfiles().slice(0, cur.profiles.length);

  for (const hdr of targetProfiles) {
    const existing = cur.profiles.find((p) => p.index === hdr.index);
    if (!existing) continue;
    await api.applyProfile({ ...existing, ...hdr, index: existing.index });
    cur = {
      ...cur,
      profiles: cur.profiles.map((p) => (p.index === hdr.index ? { ...p, ...hdr, index: p.index } : p)),
    };
  }

  const keyRows = showcaseKeys().slice(0, cur.profiles.length);
  for (const row of keyRows) {
    for (const key of row) {
      const profile = key.profile;
      if (profile >= cur.profiles.length) continue;
      await api.applyKey({ ...key, profile });
    }
  }

  curLaunches = curLaunches.filter(
    (l) => !showcaseLaunchesResolved().some((s) => s.profile === l.profile && s.key === l.key),
  );
  for (const raw of showcaseLaunchesResolved()) {
    if (raw.profile >= cur.profiles.length) continue;
    const entry: LaunchEntry = {
      ...raw,
      id: newLaunchId(),
    };
    await api.setLaunch(entry);
    curLaunches.push(entry);
  }

  const nextSwitch = showcaseSwitchConfig();
  const savedSwitch = await api.setSwitchRules(nextSwitch);

  await api.setScreen({ contrast: 8, flip: 0, sleep: 3, clockStyle: 0 });
  await api.save();
  cur = await api.loadPad();

  return { snap: cur, launches: curLaunches, switchCfg: savedSwitch };
}
