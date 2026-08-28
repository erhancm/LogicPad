import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "./api";
import {
  assignmentFrame,
  emptyLedFrame,
  LED_PWM_STEPS,
  type LedFrame,
} from "./leds";
import type { PadKey, ProfileHdr } from "./types";

const LED_OFF = 0;
const LED_WHITE = 1;
const LED_RED = 2;
const LED_GREEN = 3;
const LED_BLUE = 4;
const LED_SEL = 9;
const LED_PIX = 10;

const MODE_OFF = 0;
const MODE_SOLID = 1;
const MODE_REACT = 2;
const MODE_BREATHE = 3;
const MODE_WAVE = 4;
const MODE_RING = 5;
const MODE_RIPPLE = 6;
const MODE_RAIN = 7;
const MODE_HEART = 8;
const MODE_CROSS = 9;
const MODE_TWINKLE = 10;
const MODE_FULL = 11;
const MODE_FULL_RED = 12;
const MODE_FULL_GREEN = 13;
const MODE_FULL_BLUE = 14;
const N_MODES = 15;

const HUE = [LED_RED, LED_GREEN, LED_BLUE];
const RING_POS = [0, 1, 2, 7, 0xff, 3, 6, 5, 4, 0];
const GAMMA = [0, 1, 1, 2, 2, 3, 4, 5, 6, 8, 10, 12, 13, 14, 15, 16, 16];

function u16(n: number): number {
  return n & 0xffff;
}

function pixRc(k: number): { row: number; col: number } {
  if (k === LED_SEL) return { row: 0, col: 0 };
  return { row: Math.floor(k / 3) + 1, col: k % 3 };
}

function udiff(a: number, b: number): number {
  return a > b ? a - b : b - a;
}

function falloff(dist: number, width: number): number {
  if (width === 0 || dist >= width) return 0;
  return Math.floor(((width - dist) * 255) / width);
}

function tri255(t: number, period: number): number {
  const h = Math.floor(period / 2);
  const p = t % period;
  const v = p < h ? p : period - p;
  return Math.floor((v * 255) / h);
}

function hueAt(t: number, period: number): number {
  return HUE[Math.floor(t / period) % 3] ?? LED_RED;
}

function toDuty(lv255: number, bright: number): number {
  if (lv255 === 0 || bright === 0) return 0;
  let lin = Math.floor((lv255 * bright * LED_PWM_STEPS) / 2550);
  if (lin > LED_PWM_STEPS) lin = LED_PWM_STEPS;
  return GAMMA[lin] ?? 0;
}

/** Firmware `show_frame` port for simulated pads and firmware without GET_LEDS. */
export class LedEngine {
  animMs = 0;
  idleMs = 0;
  flashKey = 0xff;
  flashMs = 0;
  rippleKey = 0xff;
  rippleAge = 0;
  carry = 0;
  flood = 0;
  color = Array(LED_PIX).fill(0);
  duty = Array(LED_PIX).fill(0);

  frame(): LedFrame {
    return { color: this.color.slice(), duty: this.duty.slice(), flood: this.flood };
  }

  syncFromPad(s: LedFrame) {
    if (s.animMs != null) this.animMs = s.animMs & 0xffff;
    if (s.idleMs != null) this.idleMs = s.idleMs;
    this.flashKey = s.flashKey ?? 0xff;
    this.flashMs = s.flashMs ?? 0;
    this.rippleKey = s.rippleKey ?? 0xff;
    this.rippleAge = s.rippleAge ?? 0;
    this.carry = 0;
  }

  applyPixels(s: LedFrame) {
    if (s.color.length >= 10) this.color = s.color.slice(0, 10);
    if (s.duty.length >= 10) this.duty = s.duty.slice(0, 10);
    if (s.flood != null) this.flood = s.flood;
  }

  flash(key: number) {
    if (key > LED_SEL) return;
    this.flashKey = key;
    this.flashMs = 120;
    this.idleMs = 0;
    this.rippleKey = key;
    this.rippleAge = 1;
  }

  private setPix(key: number, color: number, lv255: number, bright: number) {
    this.color[key] = color;
    this.duty[key] = toDuty(lv255, bright);
  }

  private stepMs() {
    this.animMs = u16(this.animMs + 1);
    if (this.rippleAge && this.rippleAge < 500) this.rippleAge++;
    else if (this.rippleAge >= 500) {
      this.rippleAge = 0;
      this.rippleKey = 0xff;
    }
    if (this.flashMs) {
      this.flashMs--;
      if (!this.flashMs) this.flashKey = 0xff;
    } else if (this.idleMs < 60000) {
      this.idleMs++;
    }
  }

  tick(dtMs: number, input: { mode: number; bright: number; dim: number; leds: number[] }): LedFrame {
    this.carry += Math.max(0, dtMs);
    let steps = Math.floor(this.carry);
    this.carry -= steps;
    if (steps > 100) steps = 100;
    for (let i = 0; i < steps; i++) this.stepMs();
    this.showFrame(input.mode, input.bright > 10 ? 10 : input.bright, input.dim > 10 ? 10 : input.dim, input.leds);
    return this.frame();
  }

  private showFrame(mode: number, bright: number, dim: number, leds: number[]) {
    const level = this.idleMs > 2000 ? dim : bright;
    this.flood = 0;
    for (let k = 0; k < LED_PIX; k++) {
      this.color[k] = LED_OFF;
      this.duty[k] = 0;
    }
    if (mode === MODE_OFF || mode >= N_MODES) return;

    if (mode >= MODE_FULL && mode <= MODE_FULL_BLUE) {
      let color = LED_WHITE;
      if (mode === MODE_FULL_RED) color = LED_RED;
      else if (mode === MODE_FULL_GREEN) color = LED_GREEN;
      else if (mode === MODE_FULL_BLUE) color = LED_BLUE;
      this.flood = 1;
      for (let k = 0; k < LED_PIX; k++) this.setPix(k, color, 255, bright);
      return;
    }

    if (mode === MODE_SOLID || mode === MODE_REACT) {
      for (let k = 0; k < LED_PIX; k++) {
        let color = k === LED_SEL ? (leds[0] ?? 0) : (leds[k] ?? 0);
        if (mode === MODE_REACT) {
          color = this.flashKey === k ? LED_WHITE : LED_OFF;
        }
        if (color !== LED_OFF && color <= LED_BLUE) this.setPix(k, color, 255, level);
      }
      return;
    }

    for (let k = 0; k < LED_PIX; k++) {
      const { row, col } = pixRc(k);
      let lv = 0;
      let color = LED_OFF;
      switch (mode) {
        case MODE_BREATHE:
          color = hueAt(this.animMs, 2000);
          lv = tri255(this.animMs, 2000);
          break;
        case MODE_WAVE: {
          const t = this.animMs % 1280;
          const pos = t < 640 ? Math.floor((t * 256) / 640) : Math.floor(((1280 - t) * 256) / 640);
          color = hueAt(this.animMs, 1280);
          lv = falloff(udiff(pos, col * 128), 150);
          break;
        }
        case MODE_RING: {
          const pos = RING_POS[k] ?? 0xff;
          if (pos === 0xff) break;
          const head = Math.floor((this.animMs % 720) * 256 / 720);
          const kp = pos * 32;
          let d = udiff(head, kp);
          if (d > 128) d = 256 - d;
          color = hueAt(this.animMs, 720);
          lv = falloff(d, 52);
          break;
        }
        case MODE_RIPPLE: {
          if (this.rippleKey > LED_SEL || this.rippleAge === 0) break;
          const o = pixRc(this.rippleKey);
          const dist =
            ((row > o.row ? row - o.row : o.row - row) + (col > o.col ? col - o.col : o.col - col)) * 256;
          const rad = Math.floor((this.rippleAge * 256) / 70);
          color = hueAt(this.animMs, 1500);
          lv = falloff(udiff(rad, dist), 220);
          break;
        }
        case MODE_RAIN: {
          const t = (this.animMs + col * 190) % 520;
          if (t >= 420) break;
          const drop = Math.floor((t * 384) / 420);
          color = HUE[col] ?? LED_RED;
          lv = falloff(udiff(drop, row * 128), 110);
          break;
        }
        case MODE_HEART: {
          const t = this.animMs % 1100;
          color = LED_RED;
          if (t < 140) lv = tri255(t, 140);
          else if (t >= 200 && t < 340) lv = Math.floor((tri255(t - 200, 140) * 7) / 10);
          break;
        }
        case MODE_CROSS: {
          const t = this.animMs % 800;
          const isPlus = k !== LED_SEL && ((k & 1) || k === 4) ? 1 : 0;
          let mix: number;
          if (t < 280) mix = 0;
          else if (t < 400) mix = Math.floor(((t - 280) * 255) / 120);
          else if (t < 680) mix = 255;
          else mix = Math.floor(((800 - t) * 255) / 120);
          color = hueAt(this.animMs, 1600);
          lv = isPlus ? 255 - mix : mix;
          break;
        }
        case MODE_TWINKLE: {
          const per = 640 + k * 71;
          const n = u16(this.animMs + k * 293);
          const spark = Math.floor(n / per);
          const ph = n % per;
          const on = 180 + (spark % 5) * 30;
          if (ph < on) {
            const pal = (spark * 3 + k * 5) % 4;
            color = pal === 3 ? LED_WHITE : (HUE[pal] ?? LED_RED);
            lv = tri255(ph, on);
          }
          break;
        }
        default:
          break;
      }
      if (lv && color !== LED_OFF) this.setPix(k, color, lv, bright);
    }
  }
}

export function useLedPreview(opts: {
  simulated: boolean;
  canGetLeds: boolean;
  hdr: ProfileHdr | undefined;
  keys: PadKey[];
}): LedFrame {
  const { simulated, canGetLeds, hdr, keys } = opts;
  const [live, setLive] = useState<LedFrame>(() => assignmentFrame(keys.map((k) => k.led)));
  const engine = useRef(new LedEngine());
  const keysRef = useRef(keys);
  const hdrRef = useRef(hdr);
  keysRef.current = keys;
  hdrRef.current = hdr;
  const source = useRef<"engine" | "hid-pixels">("engine");
  const lastHid = useRef(0);

  useEffect(() => {
    if (simulated || !canGetLeds) {
      source.current = "engine";
      void api.watchLeds(false).catch(() => undefined);
      return;
    }
    void api.watchLeds(true).catch(() => undefined);
    return () => {
      void api.watchLeds(false).catch(() => undefined);
    };
  }, [canGetLeds, simulated]);

  useEffect(() => {
    let gone = false;
    let unlistenKey: (() => void) | undefined;
    let unlistenLeds: (() => void) | undefined;
    void listen<{ profile: number; key: number; down: boolean }>("pad-key", (e) => {
      if (!e.payload.down) return;
      engine.current.flash(e.payload.key);
    }).then((fn) => {
      if (gone) fn();
      else unlistenKey = fn;
    });
    if (!simulated && canGetLeds) {
      void listen<LedFrame>("pad-leds", (e) => {
        const f = e.payload;
        lastHid.current = performance.now();
        if (f.clocks) {
          engine.current.syncFromPad(f);
          engine.current.applyPixels(f);
          source.current = "engine";
          setLive(engine.current.frame());
        } else if (f.color?.length >= 10 && f.duty?.length >= 10) {
          source.current = "hid-pixels";
          setLive({ color: f.color, duty: f.duty, flood: f.flood });
        }
      }).then((fn) => {
        if (gone) fn();
        else unlistenLeds = fn;
      });
    }
    return () => {
      gone = true;
      unlistenKey?.();
      unlistenLeds?.();
    };
  }, [simulated, canGetLeds]);

  useEffect(() => {
    let gone = false;
    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      if (gone) return;
      const dt = Math.min(100, now - last);
      last = now;
      if (source.current === "hid-pixels" && now - lastHid.current > 250) {
        source.current = "engine";
      }
      const h = hdrRef.current;
      if (!h) {
        setLive(emptyLedFrame());
        raf = requestAnimationFrame(loop);
        return;
      }
      if (source.current !== "hid-pixels") {
        const leds = keysRef.current.map((k) => k.led);
        setLive(
          engine.current.tick(dt, {
            mode: h.lightMode,
            bright: h.bright,
            dim: h.dim,
            leds,
          }),
        );
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      gone = true;
      cancelAnimationFrame(raf);
    };
  }, [simulated, canGetLeds, hdr?.index, hdr?.lightMode, hdr?.bright, hdr?.dim]);

  return live;
}
