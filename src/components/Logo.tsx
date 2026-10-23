/** Byterush app icon (same artwork as branding/icon.svg). */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="logo">
      <rect x="0.5" y="0.5" width="63" height="63" rx="14" fill="#141111" stroke="#2a2525" />
      <g transform="translate(32 32) scale(1.14) translate(-32 -32)">
        <g fill="#f1ecec">
          <rect x="18" y="21" width="6" height="13" rx="1" />
          <rect x="29" y="17" width="6" height="21" rx="1" />
          <rect x="40" y="13" width="6" height="21" rx="1" />
          <path d="M14 37h8l10 10 10-10h8L32 55z" />
        </g>
        <rect x="29" y="9" width="6" height="6" rx="1" fill="#f6fa89" />
      </g>
    </svg>
  );
}
