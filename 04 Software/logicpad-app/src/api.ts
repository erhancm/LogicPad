import { invoke } from "@tauri-apps/api/core";
import type { LaunchEntry, PadKey, ProfileHdr, Snapshot } from "./types";

export const api = {
  connect: () => invoke<void>("connect"),
  disconnect: () => invoke<void>("disconnect"),
  isConnected: () => invoke<boolean>("is_connected"),
  ping: () => invoke<[number, number]>("ping"),
  loadPad: () => invoke<Snapshot>("load_pad"),
  applyKey: (key: PadKey) => invoke<void>("apply_key", { key }),
  applyProfile: (hdr: ProfileHdr) => invoke<void>("apply_profile", { hdr }),
  setActive: (profile: number) => invoke<void>("set_active", { profile }),
  addProfile: () => invoke<Snapshot>("add_profile"),
  deleteProfile: (profile: number) => invoke<Snapshot>("delete_profile", { profile }),
  save: () => invoke<void>("save_store"),
  reload: () => invoke<Snapshot>("reload_store"),
  factory: () => invoke<Snapshot>("factory_reset"),
  setTime: (t: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  }) => invoke<void>("set_time", t),
  flashFirmware: (data: number[]) => invoke<void>("flash_firmware", { data }),
  getLaunches: () => invoke<LaunchEntry[]>("get_launches"),
  setLaunch: (entry: LaunchEntry) => invoke<void>("set_launch", { entry }),
  pickProgram: () => invoke<string | null>("pick_program"),
};
