import { useCallback, useEffect, useRef, type RefObject } from "react";
import { api } from "./api";
import {
  OLED_BLUE,
  OLED_BLUE_DIM,
  OLED_YELLOW,
  clockBandFrame,
  formatClockTime,
  type ClockStyle,
} from "./clockAnim";
import "./ClockPreview.css";

const BAND_Y = 48;

type Props = {
  style: ClockStyle;
  flip?: boolean;
  scale?: number;
  padPreview?: boolean;
};

export function ClockPreview({
  style,
  flip = false,
  scale = 2,
  padPreview = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const styleRef = useRef(style);
  styleRef.current = style;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;

    const draw = (now: number) => {
      const w = 128;
      const h = 64;
      const s = styleRef.current;
      const d = new Date();
      const { time, date } = formatClockTime(d);

      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = OLED_BLUE;
      ctx.font = "bold 16px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(time, w / 2, 8);

      ctx.fillStyle = OLED_BLUE_DIM;
      ctx.font = "8px monospace";
      ctx.fillText(date, w / 2, 32);

      const band = clockBandFrame(d.getSeconds(), now, s);
      for (const r of band.barRects) {
        ctx.fillStyle = OLED_YELLOW;
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
      for (const r of band.animRects) {
        ctx.fillStyle = OLED_YELLOW;
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
      for (const p of band.animPixels) {
        ctx.fillStyle = OLED_YELLOW;
        ctx.fillRect(p.x, p.y, 1, 1);
      }

      if (padPreview) {
        ctx.strokeStyle = "rgba(126, 200, 255, 0.35)";
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, w - 1, BAND_Y - 1);
        ctx.strokeStyle = "rgba(230, 200, 74, 0.45)";
        ctx.strokeRect(0.5, BAND_Y + 0.5, w - 1, h - BAND_Y - 1);
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [padPreview]);

  return (
    <div className={`clock-preview${flip ? " flip" : ""}${padPreview ? " pad-live" : ""}`}>
      <canvas
        ref={canvasRef}
        width={128}
        height={64}
        style={{ width: 128 * scale, height: 64 * scale }}
        aria-label="Standby clock preview"
      />
      <p className="hint">
        {padPreview
          ? "Live on pad — move away to return to your profile."
          : "Hover here to mirror the standby clock on the pad OLED."}
      </p>
    </div>
  );
}

function pointerInside(el: HTMLElement, x: number, y: number): boolean {
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

/** Keep the pad OLED in standby preview only while the pointer is over `root`. */
export function usePadClockPreview(
  enabled: boolean,
  active: boolean,
  root: RefObject<HTMLElement | null>,
  setActive: (on: boolean) => void,
) {
  const timerRef = useRef<number | undefined>(undefined);
  const liveRef = useRef(false);

  const stopPad = useCallback(() => {
    window.clearInterval(timerRef.current);
    timerRef.current = undefined;
    if (!liveRef.current) return;
    liveRef.current = false;
    void api.previewClock(false).catch(() => undefined);
  }, []);

  const startPad = useCallback(() => {
    if (!enabled || liveRef.current) return;
    liveRef.current = true;
    void api.previewClock(true).catch(() => undefined);
    if (!timerRef.current) {
      timerRef.current = window.setInterval(() => {
        if (liveRef.current) void api.previewClock(true).catch(() => undefined);
      }, 900);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !active) {
      stopPad();
      return;
    }
    startPad();
    return () => stopPad();
  }, [enabled, active, startPad, stopPad]);

  useEffect(() => {
    if (!enabled) return;
    const el = root.current;
    if (!el || !active) return;

    const leaveIfOutside = (x: number, y: number) => {
      if (!liveRef.current) return;
      if (!pointerInside(el, x, y)) {
        setActive(false);
      }
    };

    const onMove = (e: PointerEvent) => leaveIfOutside(e.clientX, e.clientY);
    const onBlur = () => setActive(false);
    const onVis = () => {
      if (document.visibilityState !== "visible") setActive(false);
    };
    const onMouseOut = (e: MouseEvent) => {
      if (!e.relatedTarget && e.clientY <= 0) setActive(false);
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerdown", onMove);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVis);
    document.addEventListener("mouseout", onMouseOut);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerdown", onMove);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis);
      document.removeEventListener("mouseout", onMouseOut);
    };
  }, [enabled, active, root, setActive]);

  useEffect(() => () => stopPad(), [stopPad]);
}
