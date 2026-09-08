import type { SVGProps } from "react";

export function WellboreDmsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M8 2.5v3.9c0 2.9.8 4.7 3.1 6.2 2.2 1.5 3.8 3.1 3.8 5.7v3.2" />
      <path d="M4.5 3.5v17" />
      <path d="M2.5 6h4M2.5 10h4M2.5 14h4M2.5 18h4" />
      <circle cx="8" cy="6.4" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="11.1" cy="12.3" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="14.7" cy="18.1" r="1.05" fill="currentColor" stroke="none" />
      <path d="M6.8 6.4h2.4M9.9 12.3h2.4M13.5 18.1h2.4" />
    </svg>
  );
}