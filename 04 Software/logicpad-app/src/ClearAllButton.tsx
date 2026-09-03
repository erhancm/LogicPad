import type { PadKey } from "./types";
import "./ClearAllButton.css";

const KEY_COUNT = 9;

export type ClearAllButtonProps = {
  disabled?: boolean;
  profileName: string;
  onClear: () => void | Promise<void>;
};

export function emptyKey(profile: number, index: number): PadKey {
  return { profile, index, label: "", led: 0, acts: [], text: "" };
}

export function clearedKeys(profile: number): PadKey[] {
  return Array.from({ length: KEY_COUNT }, (_, index) => emptyKey(profile, index));
}

export function ClearAllButton({ disabled, profileName, onClear }: ClearAllButtonProps) {
  return (
    <button
      type="button"
      className="clear-all"
      disabled={disabled}
      onClick={() => {
        const ok = confirm(
          `Clear all 9 keys on profile “${profileName}”? This cannot be undone except Reload (if not saved) or rebuilding them.`,
        );
        if (!ok) return;
        void onClear();
      }}
    >
      Clear all
    </button>
  );
}
