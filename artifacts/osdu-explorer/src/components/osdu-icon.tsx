import type { SVGProps } from "react";

export function OsduIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 48 24"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <text
        x="24"
        y="18"
        textAnchor="middle"
        fontFamily="Inter, system-ui, sans-serif"
        fontSize="16.6"
        fontWeight="700"
        letterSpacing="0.15"
        fill="currentColor"
        stroke="none"
      >
        OSDU
      </text>
    </svg>
  );
}