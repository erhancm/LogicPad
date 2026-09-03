import { useEffect, type JSX } from "react";
import "./RunningPicker.css";

export type OpenProgram = { title: string; exe: string; path: string };

export type OpenWindow = OpenProgram & {
  hwnd?: string;
  thumbBmp?: string;
  thumbJpeg?: string;
  iconBmp?: string;
};

function bmpSrc(b64?: string): string | undefined {
  return b64 ? `data:image/bmp;base64,${b64}` : undefined;
}

function thumbSrc(program: OpenWindow): string | undefined {
  if (program.thumbJpeg) return `data:image/jpeg;base64,${program.thumbJpeg}`;
  return bmpSrc(program.thumbBmp) ?? bmpSrc(program.iconBmp);
}

export function RunningPicker(props: {
  open: boolean;
  dock?: boolean;
  programs?: OpenProgram[];
  windows?: OpenWindow[];
  loading?: boolean;
  error?: string;
  onClose: () => void;
  onPick: (program: OpenWindow) => void;
  onRefresh: () => void;
  onBrowse?: () => void;
}): JSX.Element | null {
  const { open, dock, programs, windows, loading, error, onClose, onPick, onRefresh, onBrowse } = props;
  const cards: OpenWindow[] = windows ?? programs ?? [];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const empty = !loading && cards.length === 0;

  return (
    <div className={`rp-back${dock ? " rp-dock" : ""}`} onClick={onClose}>
      <div
        className="rp-dialog rp-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rp-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rp-head">
          <h2 id="rp-title">Select window</h2>
          <div className="rp-head-actions">
            <button type="button" disabled={loading} onClick={onRefresh}>
              Refresh
            </button>
            <button type="button" className="rp-x" aria-label="Close" onClick={onClose}>
              ×
            </button>
          </div>
        </div>
        {error ? <p className="rp-err">{error}</p> : null}
        {loading ? <p className="rp-hint">Looking for windows…</p> : null}
        {empty ? (
          <p className="rp-empty">No open windows found. Try Browse to pick an .exe.</p>
        ) : (
          <ul className="rp-grid">
            {cards.map((program) => {
              const live = Boolean(program.thumbJpeg);
              const img = thumbSrc(program);
              return (
                <li key={program.hwnd || program.path + program.title}>
                  <button
                    type="button"
                    className="rp-card"
                    title={program.path}
                    onClick={() => onPick(program)}
                  >
                    <span className={live ? "rp-thumb" : "rp-thumb icon-only"}>
                      {img ? <img src={img} alt="" /> : <span className="rp-ph">{program.exe.slice(0, 2)}</span>}
                    </span>
                    <span className="rp-title">{program.title}</span>
                    <span className="rp-exe">{program.exe}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="rp-foot">
          {onBrowse ? (
            <button type="button" onClick={onBrowse}>
              Browse…
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
