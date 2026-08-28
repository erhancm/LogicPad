import { invoke } from "@tauri-apps/api/core";
import type { OpenProgram, OpenWindow } from "./RunningPicker";
import type { LaunchEntry, Meta, PadInfo, PadKey, ProfileHdr, ResolvedProgram, Snapshot, SwitchConfig } from "./types";

export const api = {
  connect: () => invoke<void>("connect"),
  connectTo: (id: string) => invoke<void>("connect_to", { id }),
  listPads: () => invoke<PadInfo[]>("list_pads"),
  currentPad: () => invoke<PadInfo>("current_pad"),
  disconnect: () => invoke<void>("disconnect"),
  isConnected: () => invoke<boolean>("is_connected"),
  ping: () => invoke<[number, number]>("ping"),
  getMeta: () => invoke<Meta>("get_meta"),
  loadPad: () => invoke<Snapshot>("load_pad"),
  applyKey: (key: PadKey) => invoke<void>("apply_key", { key }),
  applyProfile: (hdr: ProfileHdr) => invoke<void>("apply_profile", { hdr }),
  setActive: (profile: number) => invoke<void>("set_active", { profile }),
  addProfile: () => invoke<Snapshot>("add_profile"),
  deleteProfile: (profile: number) => invoke<Snapshot>("delete_profile", { profile }),
  save: () => invoke<void>("save_store"),
  reload: () => invoke<Snapshot>("reload_store"),
  factory: () => invoke<Snapshot>("factory_reset"),
  setScreen: (t: { contrast: number; flip: number; sleep: number; clockStyle: number }) =>
    invoke<void>("set_screen", t),
  previewClock: (on: boolean) => invoke<void>("preview_clock", { on }),
  getLeds: () => invoke<{ color: number[]; duty: number[] }>("get_leds"),
  watchLeds: (watch: boolean) => invoke<void>("watch_leds", { watch }),
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
  listOpenPrograms: () => invoke<OpenProgram[]>("list_open_programs"),
  listOpenWindows: () => invoke<OpenWindow[]>("list_open_windows"),
  watchWindowPreviews: (hwnds: string[]) => invoke<void>("watch_window_previews", { hwnds }),
  stopWindowPreviews: () => invoke<void>("stop_window_previews"),
  resolveProgram: (path: string) => invoke<ResolvedProgram>("resolve_program", { path }),
  getSwitchRules: () => invoke<SwitchConfig>("get_switch_rules"),
  setSwitchRules: (cfg: SwitchConfig) => invoke<SwitchConfig>("set_switch_rules", { cfg }),
  addSwitchProgram: (profile: number, path: string) =>
    invoke<SwitchConfig>("add_switch_program", { profile, path }),
  removeSwitchProgram: (exe: string) => invoke<SwitchConfig>("remove_switch_program", { exe }),
  saveTextFile: (name: string, contents: string) =>
    invoke<string | null>("save_text_file", { name, contents }),
  loadTextFile: () => invoke<[string, string] | null>("load_text_file"),
};
