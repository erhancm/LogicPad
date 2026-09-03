import { useEffect, useLayoutEffect, useRef, type JSX, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import {
  copyActions,
  copyKey,
  duplicateEmptyTargets,
  get,
  has,
  isKeyEmpty,
  pasteOnto,
} from "./keyClipboard";
import type { LaunchEntry, PadKey } from "./types";
import "./KeyContextMenu.css";

export type KeyMenuTarget = { index: number; x: number; y: number };

export type KeyContextMenuProps = {
  open: KeyMenuTarget | null;
  keyData: PadKey;
  /** Launches for the open key. */
  launches: LaunchEntry[];
  /** All 9 keys in the active profile. */
  profileKeys: PadKey[];
  /** All launches for the active profile. */
  profileLaunches: LaunchEntry[];
  onClose: () => void;
  onClear: (index: number) => void;
  onApply: (index: number, key: PadKey, launches: LaunchEntry[]) => void;
  /**
   * If set, Duplicate calls this instead of looping `onApply`.
   * Parent must apply `duplicateEmptyTargets(...)` itself.
   */
  onDuplicateEmpty?: (source: number) => void;
};

export {
  duplicateEmptyTargets,
  emptyPadKey,
  isKeyEmpty,
} from "./keyClipboard";

function parseKeyIndex(raw: string | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n < 9 ? n : null;
}

/** Call from the 3x3 grid `onContextMenu`. Always preventDefault. */
export function preventGridMenu(e: MouseEvent<HTMLElement>): KeyMenuTarget | null {
  e.preventDefault();
  e.stopPropagation();
  const fromCurrent = parseKeyIndex(e.currentTarget.dataset.key);
  const node =
    e.target instanceof Element ? e.target.closest("[data-key]") : null;
  const fromClosest = parseKeyIndex(
    node instanceof HTMLElement ? node.dataset.key : undefined,
  );
  const index = fromCurrent ?? fromClosest;
  if (index == null) return null;
  return { index, x: e.clientX, y: e.clientY };
}

export function KeyContextMenu(props: KeyContextMenuProps): JSX.Element | null {
  const {
    open,
    keyData,
    launches,
    profileKeys,
    profileLaunches,
    onClose,
    onClear,
    onApply,
    onDuplicateEmpty,
  } = props;

  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    if (!open) return;
    const el = menuRef.current;
    if (!el) return;
    const pad = 8;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let x = open.x;
    let y = open.y;
    if (x + w > window.innerWidth - pad) x = window.innerWidth - w - pad;
    if (y + h > window.innerHeight - pad) y = window.innerHeight - h - pad;
    x = Math.max(pad, x);
    y = Math.max(pad, y);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onCloseRef.current();
    };
    const onPtr = (e: PointerEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      onCloseRef.current();
    };
    const id = requestAnimationFrame(() => {
      document.addEventListener("keydown", onKey);
      document.addEventListener("pointerdown", onPtr);
    });
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPtr);
    };
  }, [open]);

  if (!open) return null;

  const empty = isKeyEmpty(keyData, launches);
  const hasProgramming =
    keyData.acts.length > 0 ||
    (keyData.text ?? "") !== "" ||
    launches.some((l) => l.path.trim() !== "");
  const dupTargets = duplicateEmptyTargets(
    keyData,
    launches,
    profileKeys,
    profileLaunches,
  );
  const canDup = !empty && dupTargets.length > 0;
  const canPaste = has();

  function pick(fn: () => void) {
    fn();
    onClose();
  }

  return createPortal(
    <div
      ref={menuRef}
      className="key-menu"
      role="menu"
      tabIndex={-1}
      aria-label={`Key ${open.index + 1} menu`}
      style={{ left: open.x, top: open.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        className="key-menu-item danger"
        disabled={empty}
        onClick={() => pick(() => onClear(open.index))}
      >
        Clear key
      </button>
      <div className="key-menu-sep" role="separator" />
      <button
        type="button"
        role="menuitem"
        className="key-menu-item"
        onClick={() => pick(() => copyKey(keyData, launches))}
      >
        Copy key
      </button>
      <button
        type="button"
        role="menuitem"
        className="key-menu-item"
        disabled={!hasProgramming}
        onClick={() => pick(() => copyActions(keyData, launches))}
      >
        Copy actions only
      </button>
      <button
        type="button"
        role="menuitem"
        className="key-menu-item"
        disabled={!canPaste}
        onClick={() =>
          pick(() => {
            const data = get();
            if (!data) return;
            const next = pasteOnto(keyData, data);
            onApply(open.index, next.key, next.launches);
          })
        }
      >
        Paste key
      </button>
      <div className="key-menu-sep" role="separator" />
      <button
        type="button"
        role="menuitem"
        className="key-menu-item"
        disabled={!canDup}
        onClick={() =>
          pick(() => {
            if (onDuplicateEmpty) {
              onDuplicateEmpty(keyData.index);
              return;
            }
            for (const t of dupTargets) onApply(t.index, t.key, t.launches);
          })
        }
      >
        Duplicate onto empty keys
      </button>
    </div>,
    document.body,
  );
}
