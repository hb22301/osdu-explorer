import type { SVGProps } from "react";

export function OsduIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <g transform="translate(0 -2)">
        <path
          d="m12 2.5 8.25 4.65v9.7L12 21.5l-8.25-4.65v-9.7L12 2.5Z"
          fill="currentColor"
          fillOpacity="0.08"
        />
        <path d="m12 4.75 6.25 3.5L12 11.75 5.75 8.25 12 4.75Z" fill="currentColor" fillOpacity="0.2" />
        <path d="M5.75 8.25 12 11.75l6.25-3.5M12 11.75v7.5" />
        <path d="m9.15 9.95 2.85-1.6 2.85 1.6-2.85 1.6-2.85-1.6Z" strokeOpacity="0.55" />
        <path d="M9.15 9.95v3.1l2.85 1.6 2.85-1.6v-3.1" strokeOpacity="0.55" />
        <path d="M4.15 7.15 2.75 6.35M19.85 7.15l1.4-.8M4.15 16.85l-1.4.8M19.85 16.85l1.4.8" />
        <circle cx="2.5" cy="6.2" r="1.15" fill="currentColor" stroke="none" />
        <circle cx="21.5" cy="6.2" r="1.15" fill="currentColor" stroke="none" />
        <circle cx="2.5" cy="17.8" r="1.15" fill="currentColor" stroke="none" />
        <circle cx="21.5" cy="17.8" r="1.15" fill="currentColor" stroke="none" />
        <circle cx="12" cy="11.75" r="1.25" fill="currentColor" stroke="none" />
        <path d="M12 13.5v3.35" strokeOpacity="0.55" />
        <path d="M10.35 16.9h3.3" strokeOpacity="0.55" />
      </g>
      <text
        x="12"
        y="24"
        textAnchor="middle"
        fontFamily="Arial, sans-serif"
        fontSize="5.9"
        fontWeight="800"
        letterSpacing="0.1"
        textLength="17"
        lengthAdjust="spacingAndGlyphs"
        fill="currentColor"
        stroke="none"
      >
        OSDU
      </text>
    </svg>
  );
}