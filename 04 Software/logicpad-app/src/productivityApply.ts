import { newLaunchId } from "./launches";
import type { LaunchEntry, Snapshot, SwitchConfig } from "./types";
import { api } from "./api";
import { productivityKeys, productivityLaunchesResolved, productivityProfiles } from "./productivity";
import { productivitySwitchConfig } from "./productivityGraph";

export type ProductivityApplyResult = {
  snap: Snapshot;
  launches: LaunchEntry[];
  switchCfg: SwitchConfig;
};

const TARGET_COUNT = 7;

/** Push productivity profiles onto the connected pad and save to flash. */
export async function applyProductivityToPad(
  snap: Snapshot,
  launches: LaunchEntry[],
  _switchCfg: SwitchConfig,
): Promise<ProductivityApplyResult> {
  let cur = snap;
  let curLaunches = [...launches];

  while ((cur.profiles.length ?? 0) < TARGET_COUNT && cur.canAddProfiles !== false) {
    cur = await api.addProfile();
  }

  const targetProfiles = productivityProfiles().slice(0, cur.profiles.length);

  for (const hdr of targetProfiles) {
    const existing = cur.profiles.find((p) => p.index === hdr.index);
    if (!existing) continue;
    await api.applyProfile({ ...existing, ...hdr, index: existing.index });
    cur = {
      ...cur,
      profiles: cur.profiles.map((p) => (p.index === hdr.index ? { ...p, ...hdr, index: p.index } : p)),
    };
  }

  const keyRows = productivityKeys().slice(0, cur.profiles.length);
  for (const row of keyRows) {
    for (const key of row) {
      const profile = key.profile;
      if (profile >= cur.profiles.length) continue;
      await api.applyKey({ ...key, profile });
    }
  }

  curLaunches = curLaunches.filter(
    (l) => !productivityLaunchesResolved().some((s) => s.profile === l.profile && s.key === l.key),
  );
  for (const raw of productivityLaunchesResolved()) {
    if (raw.profile >= cur.profiles.length) continue;
    const entry: LaunchEntry = {
      ...raw,
      id: newLaunchId(),
    };
    await api.setLaunch(entry);
    curLaunches.push(entry);
  }

  const nextSwitch = productivitySwitchConfig();
  const savedSwitch = await api.setSwitchRules(nextSwitch);

  await api.setScreen({ contrast: 8, flip: 0, sleep: 3, clockStyle: 0 });
  await api.save();
  cur = await api.loadPad();

  return { snap: cur, launches: curLaunches, switchCfg: savedSwitch };
}
