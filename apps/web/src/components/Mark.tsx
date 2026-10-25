/** A barbell end-on: the plates either side of the bar. */
export function Mark({ scale = 1 }: { scale?: number }) {
  return (
    <svg
      width={28 * scale}
      height={24 * scale}
      viewBox="0 0 28 24"
      fill="var(--glow)"
      aria-hidden="true"
    >
      <rect x="0" y="6" width="3" height="12" />
      <rect x="5" y="1" width="3" height="22" />
      <rect x="8" y="10.5" width="12" height="3" />
      <rect x="20" y="1" width="3" height="22" />
      <rect x="25" y="6" width="3" height="12" />
    </svg>
  );
}
