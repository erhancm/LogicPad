import type { ReactNode } from "react";
import type { SwitchNode } from "./types";

export type LogicGateKind = Extract<
  SwitchNode["kind"],
  "and" | "or" | "not" | "xor" | "if" | "else" | "true" | "false"
>;

export type LogicGateInfo = { title: string; menuLabel: string; hint: string };

/** Labels and hints for logic nodes in the Auto-switch graph. */
export const LOGIC_GATE_INFO: Record<LogicGateKind, LogicGateInfo> = {
  and: {
    title: "AND",
    menuLabel: "AND",
    hint: "All linked conditions must match",
  },
  or: {
    title: "OR",
    menuLabel: "OR",
    hint: "At least one linked condition matches",
  },
  not: {
    title: "NOT",
    menuLabel: "NOT",
    hint: "Matches when the input condition fails",
  },
  xor: {
    title: "XOR",
    menuLabel: "XOR",
    hint: "Exactly one linked condition matches",
  },
  if: {
    title: "BUF",
    menuLabel: "Buffer",
    hint: "Passes the condition through unchanged",
  },
  else: {
    title: "NOR",
    menuLabel: "NOR",
    hint: "Matches only when no inputs match",
  },
  true: {
    title: "1",
    menuLabel: "Always on",
    hint: "Always matches (logic 1)",
  },
  false: {
    title: "0",
    menuLabel: "Always off",
    hint: "Never matches (logic 0)",
  },
};

export function logicGateInfo(kind: SwitchNode["kind"]): LogicGateInfo {
  if (kind in LOGIC_GATE_INFO) return LOGIC_GATE_INFO[kind as LogicGateKind];
  return { title: kind, menuLabel: kind, hint: "" };
}

const STROKE = "#d0d4de";
const FILL = "#161922";
const SW = 2;

/** ANSI OR / NOR / XOR body — concave input side, pointed output. */
const OR_BODY = "M 14 9 Q 19 24 14 39 Q 30 43 46 24 Q 30 5 14 9 Z";

/** XOR extra input arc, parallel to the OR concave edge. */
const XOR_ARC = "M 8 7 Q 13 24 8 41";

/** ANSI AND body — flat input side, semicircular output. */
const AND_BODY = "M 18 9 L 30 9 A 15 15 0 0 1 30 39 L 18 39 Z";

function GateSvg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 64 48" className="sw-gate-svg" aria-hidden>
      {children}
    </svg>
  );
}

function Lead({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={STROKE} strokeWidth={SW} strokeLinecap="square" />;
}

function Body({ d }: { d: string }) {
  return (
    <path d={d} fill={FILL} stroke={STROKE} strokeWidth={SW} strokeLinejoin="round" strokeLinecap="square" />
  );
}

function Bubble({ cx, cy, r = 4 }: { cx: number; cy: number; r?: number }) {
  return <circle cx={cx} cy={cy} r={r} fill={FILL} stroke={STROKE} strokeWidth={SW} />;
}

function DualInputs({ inX = 2, bodyX = 18 }: { inX?: number; bodyX?: number }) {
  return (
    <>
      <Lead x1={inX} y1={16} x2={bodyX} y2={16} />
      <Lead x1={inX} y1={32} x2={bodyX} y2={32} />
    </>
  );
}

/** IEEE/ANSI logic gate symbols matching standard schematic shapes. */
export function GateSymbol({ kind }: { kind: SwitchNode["kind"] }) {
  switch (kind) {
    case "and":
      return (
        <GateSvg>
          <DualInputs />
          <Lead x1={45} y1={24} x2={62} y2={24} />
          <Body d={AND_BODY} />
        </GateSvg>
      );
    case "or":
      return (
        <GateSvg>
          <DualInputs />
          <Lead x1={46} y1={24} x2={62} y2={24} />
          <Body d={OR_BODY} />
        </GateSvg>
      );
    case "not":
      return (
        <GateSvg>
          <Lead x1={2} y1={24} x2={16} y2={24} />
          <Lead x1={50} y1={24} x2={62} y2={24} />
          <Body d="M 16 9 L 40 24 L 16 39 Z" />
          <Bubble cx={46} cy={24} />
        </GateSvg>
      );
    case "xor":
      return (
        <GateSvg>
          <DualInputs inX={2} bodyX={14} />
          <Lead x1={46} y1={24} x2={62} y2={24} />
          <path d={XOR_ARC} fill="none" stroke={STROKE} strokeWidth={SW} strokeLinecap="square" />
          <Body d={OR_BODY} />
        </GateSvg>
      );
    case "if":
      return (
        <GateSvg>
          <Lead x1={2} y1={24} x2={16} y2={24} />
          <Lead x1={46} y1={24} x2={62} y2={24} />
          <Body d="M 16 9 L 46 24 L 16 39 Z" />
        </GateSvg>
      );
    case "else":
      return (
        <GateSvg>
          <DualInputs />
          <Lead x1={50} y1={24} x2={62} y2={24} />
          <Body d={OR_BODY} />
          <Bubble cx={50} cy={24} />
        </GateSvg>
      );
    case "true":
      return (
        <GateSvg>
          <Lead x1={42} y1={24} x2={62} y2={24} />
          <rect x={14} y={14} width={28} height={20} rx={2} fill={FILL} stroke={STROKE} strokeWidth={SW} />
          <text
            x={28}
            y={29}
            textAnchor="middle"
            fill="#f0d060"
            fontSize="16"
            fontWeight="700"
            fontFamily="Consolas, 'Segoe UI', sans-serif"
          >
            1
          </text>
        </GateSvg>
      );
    case "false":
      return (
        <GateSvg>
          <Lead x1={42} y1={24} x2={62} y2={24} />
          <rect x={14} y={14} width={28} height={20} rx={2} fill={FILL} stroke={STROKE} strokeWidth={SW} />
          <text
            x={28}
            y={29}
            textAnchor="middle"
            fill="#8b909c"
            fontSize="16"
            fontWeight="700"
            fontFamily="Consolas, 'Segoe UI', sans-serif"
          >
            0
          </text>
        </GateSvg>
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
