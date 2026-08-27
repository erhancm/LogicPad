import { useEffect, type JSX } from "react";
import "./RunningPicker.css";

export type OpenProgram = { title: string; exe: string; path: string };

export function RunningPicker(props: {
  open: boolean;
  programs: OpenProgram[];
  loading?: boolean;
  error?: string;
  onClose: () => void;
  onPick: (program: OpenProgram) => void;
  onRefresh: () => void;
}): JSX.Element | null {
  const { open, programs, loading, error, onClose, onPick, onRefresh } = props;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const empty = !loading && programs.length === 0;

  return (
    <div className="rp-back" onClick={onClose}>
      <div
        className="rp-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rp-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rp-head">
          <h2 id="rp-title">Open programs</h2>
          <button type="button" disabled={loading} onClick={onRefresh}>
            Refresh
          </button>
        </div>
        {error ? <p className="rp-err">{error}</p> : null}
        {loading ? <p className="rp-hint">Looking for windows…</p> : null}
        {empty ? (
          <p className="rp-empty">No open windows found. Try Browse to pick an .exe.</p>
        ) : (
          <ul className="rp-list">
            {programs.map((program) => (
              <li key={program.path}>
                <button
                  type="button"
                  className="rp-row"
                  title={program.path}
                  onClick={() => onPick(program)}
                >
                  <span className="rp-title">{program.title}</span>
                  <span className="rp-exe">{program.exe}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="rp-foot">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
