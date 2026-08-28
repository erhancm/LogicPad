type LogicPadMarkProps = {
  size?: number;
  className?: string;
};

/** LogicPad mark: 3×3 keypad on a dark device body (app palette). */
export function LogicPadMark({ size = 28, className }: LogicPadMarkProps) {
  const keys = [
    [5, 5],
    [13, 5],
    [21, 5],
    [5, 13],
    [13, 13],
    [21, 13],
    [5, 21],
    [13, 21],
    [21, 21],
  ] as const;

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect
        x="1.5"
        y="1.5"
        width="29"
        height="29"
        rx="6"
        fill="#12141a"
        stroke="#2a2e38"
        strokeWidth="1"
      />
      {keys.map(([x, y], i) => (
        <rect
          key={i}
          x={x}
          y={y}
          width="6"
          height="6"
          rx="1.5"
          fill={i === 4 ? "#e8e4d8" : "#f0d060"}
        />
      ))}
    </svg>
  );
}
