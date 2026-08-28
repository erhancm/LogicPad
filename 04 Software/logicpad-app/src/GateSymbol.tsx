import type { SwitchNode } from "./types";

/** IEEE-style logic gate symbols (ANSI shapes). */
export function GateSymbol({ kind }: { kind: SwitchNode["kind"] }) {
  const stroke = "#d8dce8";
  const fill = "#12141a";
  const sw = 1.75;

  switch (kind) {
    case "and":
      return (
        <svg viewBox="0 0 52 44" className="sw-gate-svg" aria-hidden>
          <path
            d="M 6 8 L 26 8 Q 42 8 42 22 Q 42 36 26 36 L 6 36 Z"
            fill={fill}
            stroke={stroke}
            strokeWidth={sw}
            strokeLinejoin="round"
          />
        </svg>
      );
    case "or":
      return (
        <svg viewBox="0 0 52 44" className="sw-gate-svg" aria-hidden>
          <path
            d="M 8 22 Q 8 6 26 6 Q 44 22 26 38 Q 8 38 8 22 Z"
            fill={fill}
            stroke={stroke}
            strokeWidth={sw}
            strokeLinejoin="round"
          />
        </svg>
      );
    case "not":
      return (
        <svg viewBox="0 0 52 44" className="sw-gate-svg" aria-hidden>
          <path d="M 6 8 L 34 22 L 6 36 Z" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          <circle cx="40" cy="22" r="5" fill={fill} stroke={stroke} strokeWidth={sw} />
        </svg>
      );
    case "xor":
      return (
        <svg viewBox="0 0 54 44" className="sw-gate-svg" aria-hidden>
          <path
            d="M 12 22 Q 12 6 28 6 Q 44 22 28 38 Q 12 38 12 22 Z"
            fill={fill}
            stroke={stroke}
            strokeWidth={sw}
            strokeLinejoin="round"
          />
          <path
            d="M 6 22 Q 6 4 22 4"
            fill="none"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinecap="round"
          />
        </svg>
      );
    case "if":
      return (
        <svg viewBox="0 0 52 44" className="sw-gate-svg" aria-hidden>
          <path d="M 6 8 L 38 22 L 6 36 Z" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
        </svg>
      );
    case "else":
      return (
        <svg viewBox="0 0 52 44" className="sw-gate-svg" aria-hidden>
          <path d="M 6 8 L 30 22 L 6 36 Z" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          <circle cx="36" cy="22" r="5" fill={fill} stroke={stroke} strokeWidth={sw} />
          <path d="M 6 22 L 2 22" fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
        </svg>
      );
    case "true":
      return (
        <svg viewBox="0 0 52 44" className="sw-gate-svg" aria-hidden>
          <rect x="10" y="10" width="32" height="24" rx="3" fill={fill} stroke={stroke} strokeWidth={sw} />
          <text x="26" y="27" textAnchor="middle" fill="#f0d060" fontSize="14" fontWeight="700" fontFamily="sans-serif">
            1
          </text>
        </svg>
      );
    case "false":
      return (
        <svg viewBox="0 0 52 44" className="sw-gate-svg" aria-hidden>
          <rect x="10" y="10" width="32" height="24" rx="3" fill={fill} stroke={stroke} strokeWidth={sw} />
          <text x="26" y="27" textAnchor="middle" fill="#8b8f9a" fontSize="14" fontWeight="700" fontFamily="sans-serif">
            0
          </text>
        </svg>
      );
    default:
      return null;
  }
}

/** Mini gate icon for toolbar / add menus. */
export function GateIcon({ kind, size = 28 }: { kind: SwitchNode["kind"]; size?: number }) {
  return (
    <span className="sw-gate-icon" style={{ width: size, height: Math.round(size * 0.85) }}>
      <GateSymbol kind={kind} />
    </span>
  );
}
