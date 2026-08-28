/** Dual-color 0.96" OLED: blue content above y=48, yellow band below. */
export const OLED_BLUE = "#7ec8ff";
export const OLED_BLUE_DIM = "#5a9fd4";
export const OLED_YELLOW = "#e6c84a";

export const CLOCK_ANIMS = [
  "Bounce",
  "Scan",
  "March",
  "Pulse",
  "Wave",
  "Blocks",
  "Comet",
  "Swing",
  "Fill",
  "Sparkle",
  "Ripple",
  "Rain",
  "Off",
] as const;

export const CLOCK_SPEEDS = ["Slow", "Normal", "Fast", "Rapid"] as const;

export const CLK_ANIM_OFF = 12;

const SPEED_MS = [32, 16, 8, 4] as const;

export type ClockStyle = {
  anim: number;
  speed: number;
  bar: number;
};

export function packClockStyle(anim: number, speed: number, bar: number): number {
  return (anim & 0xf) | ((speed & 3) << 4) | ((bar & 1) << 6) | 0x40;
}

export function unpackClockStyle(packed: number): ClockStyle {
  const v = migrateClockStyle(packed);
  return {
    anim: v & 0xf,
    speed: (v >> 4) & 3,
    bar: (v >> 6) & 1,
  };
}

/** v1 pack (pre protocol 1.9) → v2 with bit 6 set. */
export function migrateClockStyle(packed: number): number {
  if (packed & 0x40) return packed;
  return packClockStyle(packed & 7, (packed >> 3) & 3, (packed >> 5) & 1);
}

export const DEFAULT_CLOCK_STYLE = packClockStyle(0, 1, 1);

export type ClockBandDraw = {
  barRects: { x: number; y: number; w: number; h: number }[];
  animRects: { x: number; y: number; w: number; h: number }[];
  animPixels: { x: number; y: number }[];
};

/** Matches firmware `draw_clock_band` for the 128×16 yellow band. */
export function clockBandFrame(
  sec: number,
  tickMs: number,
  style: ClockStyle,
  bandY = 48,
  bandH = 16,
  width = 128,
): ClockBandDraw {
  const barRects: ClockBandDraw["barRects"] = [];
  const animRects: ClockBandDraw["animRects"] = [];
  const animPixels: ClockBandDraw["animPixels"] = [];
  const y0 = bandY + 5;
  const speed = SPEED_MS[style.speed <= 3 ? style.speed : 1] ?? 16;
  const phase = Math.floor(tickMs / speed);

  if (style.bar) {
    const barW = Math.floor((sec * width) / 60);
    if (barW > 0) barRects.push({ x: 0, y: bandY, w: barW, h: 2 });
  }

  if (style.anim === CLK_ANIM_OFF) return { barRects, animRects, animPixels };

  switch (style.anim) {
    case 0: {
      const span = 120;
      const period = span * 2;
      const p = phase % period;
      const x = p < span ? p : period - p;
      animRects.push({ x, y: y0, w: 8, h: 8 });
      break;
    }
    case 1: {
      animRects.push({ x: (phase * 126) >> 9, y: bandY + 4, w: 2, h: 8 });
      break;
    }
    case 2: {
      const n = Math.floor(phase / 24);
      for (let d = 0; d < 3; d++) {
        const pos = (n + d * 5) % 40;
        const x = 4 + pos * 3;
        if (x < 120) animRects.push({ x, y: y0 + 3, w: 2, h: 2 });
      }
      break;
    }
    case 3: {
      const p = phase & 0xff;
      let h = p < 128 ? Math.floor(p / 14) + 2 : Math.floor((255 - p) / 14) + 2;
      if (h > 10) h = 10;
      const w = h * 8;
      animRects.push({ x: Math.floor((width - w) / 2), y: bandY + bandH - 2 - h, w, h });
      break;
    }
    case 4: {
      for (let x = 0; x < width; x += 2) {
        const s = phase + x;
        const y = y0 + 2 + ((s >> 2) & 7);
        if (y < bandY + bandH - 1) animRects.push({ x, y, w: 2, h: 2 });
      }
      break;
    }
    case 5: {
      const seg = (phase >> 5) & 7;
      for (let s = 0; s < 8; s++) {
        if (((seg + s) & 7) < 4) animRects.push({ x: s * 16 + 1, y: y0, w: 14, h: 6 });
      }
      break;
    }
    case 6: {
      const x = (phase * 126) >> 9;
      animRects.push({ x, y: y0, w: 6, h: 6 });
      if (x >= 4) animRects.push({ x: x - 4, y: y0 + 2, w: 3, h: 2 });
      if (x >= 8) animRects.push({ x: x - 8, y: y0 + 3, w: 2, h: 1 });
      break;
    }
    case 7: {
      const p = phase & 0xff;
      const tri = p < 128 ? p : 255 - p;
      const x = 4 + ((tri * 116) >> 7);
      animRects.push({ x, y: y0 + 1, w: 4, h: 6 });
      animPixels.push({ x: x + 2, y: y0 });
      break;
    }
    case 8: {
      const w = (phase * 128) >> 9;
      if (w > 0) animRects.push({ x: 0, y: y0 + 2, w, h: 4 });
      break;
    }
    case 9: {
      for (let x = 0; x < width; x += 11) {
        if (((phase + x * 17) & 31) < 5) {
          animRects.push({ x, y: y0 + 2 + ((x + phase) & 3), w: 2, h: 2 });
        }
      }
      break;
    }
    case 10: {
      const rad = (phase >> 2) & 31;
      if (rad > 0) {
        animRects.push({ x: 62, y: y0 + 3, w: 4, h: 4 });
        const l = 64 - rad;
        const r = 64 + rad;
        if (l < 128) animPixels.push({ x: l, y: y0 + 4 });
        if (r < 128) animPixels.push({ x: r, y: y0 + 4 });
      }
      break;
    }
    case 11: {
      for (let col = 0; col < 12; col++) {
        const x = col * 11 + 2;
        const drop = (phase + col * 37) & 15;
        animRects.push({ x, y: y0 + drop, w: 2, h: 3 });
      }
      break;
    }
    default:
      break;
  }

  return { barRects, animRects, animPixels };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatClockTime(d: Date): { time: string; date: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const date = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  return { time, date };
}
