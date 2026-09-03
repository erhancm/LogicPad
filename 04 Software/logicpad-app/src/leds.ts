/** FM-B2020RGBA-HG dies: saturated R/G/B, white is all three on. */
export const LED_RGB: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [255, 248, 255],
  [255, 22, 0],
  [0, 255, 42],
  [0, 52, 255],
];

export const LED_WELL = "#14161c";
export const LED_PWM_STEPS = 16;

/** Firmware `GAMMA[]` — invert PWM duty back to perceptual lin 0–16. */
const GAMMA = [0, 1, 1, 2, 2, 3, 4, 5, 6, 8, 10, 12, 13, 14, 15, 16, 16];

export type LedFrame = {
  color: number[];
  duty: number[];
  animMs?: number;
  idleMs?: number;
  flashKey?: number;
  flashMs?: number;
  rippleKey?: number;
  rippleAge?: number;
  flood?: number;
  clocks?: boolean;
};

export function emptyLedFrame(): LedFrame {
  return { color: Array(10).fill(0), duty: Array(10).fill(0) };
}

/** Solid assignments at full PWM. SEL (index 9) follows key 1 (index 0). */
export function assignmentFrame(leds: number[]): LedFrame {
  const color = Array(10).fill(0);
  const duty = Array(10).fill(0);
  for (let i = 0; i < 9; i++) {
    const c = leds[i] ?? 0;
    color[i] = c;
    duty[i] = c ? LED_PWM_STEPS : 0;
  }
  color[9] = leds[0] ?? 0;
  duty[9] = color[9] ? LED_PWM_STEPS : 0;
  return { color, duty };
}

function invGamma(duty: number): number {
  const d = Math.max(0, Math.min(LED_PWM_STEPS, duty | 0));
  let lin = 0;
  for (let i = 0; i <= LED_PWM_STEPS; i++) {
    if ((GAMMA[i] ?? 0) <= d) lin = i;
  }
  return lin;
}

/** Map pad PWM to sRGB so mid-Wave matches LED brightness (firmware gamma inverted). */
export function cssLed(color: number, duty: number, flood = false): string {
  const rgb = LED_RGB[color] ?? LED_RGB[0];
  let s = invGamma(duty) / LED_PWM_STEPS;
  if (!flood) s *= 0.92;
  const r = Math.round(rgb[0] * s);
  const g = Math.round(rgb[1] * s);
  const b = Math.round(rgb[2] * s);
  if (r + g + b === 0) return LED_WELL;
  return `rgb(${r},${g},${b})`;
}

/** Swatch for a stored LED id at full brightness (palette / inactive cards). */
export function cssLedId(led: number): string {
  return cssLed(led, led ? LED_PWM_STEPS : 0, true);
}

export function ledLabelColor(color: number, duty: number): string {
  const rgb = LED_RGB[color] ?? LED_RGB[0];
  const s = invGamma(duty) / LED_PWM_STEPS;
  const y = 0.2126 * rgb[0] * s + 0.7152 * rgb[1] * s + 0.0722 * rgb[2] * s;
  return y > 110 ? "#12141a" : "#e8e4d8";
}

export function pixOf(frame: LedFrame | null | undefined, index: number, fallbackLed = 0): {
  background: string;
  color: string;
  boxShadow: string;
} {
  const c = frame && frame.color.length > index ? (frame.color[index] ?? 0) : fallbackLed;
  const d =
    frame && frame.duty.length > index
      ? (frame.duty[index] ?? 0)
      : fallbackLed
        ? LED_PWM_STEPS
        : 0;
  const flood = Boolean(frame?.flood);
  const background = cssLed(c, d, flood);
  const glow =
    d > 1 && c
      ? `0 0 ${6 + d}px ${background}, 0 0 ${14 + d}px ${background}`
      : "inset 0 0 10px rgba(0, 0, 0, 0.45)";
  return { background, color: ledLabelColor(c, d), boxShadow: glow };
}
