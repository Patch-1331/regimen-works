/**
 * Where the shared library's movements come from (DN-171, ADR-0007).
 *
 * free-exercise-db is released under the Unlicense, which asks for nothing;
 * this is courtesy, kept to one quiet line.
 */
export function DatasetCredit() {
  return (
    <p className="mt-10 text-[11px] text-[var(--ink-faint)]">
      Exercise data from{" "}
      <a
        href="https://github.com/yuhonas/free-exercise-db"
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-2"
      >
        free-exercise-db
      </a>{" "}
      (public domain).
    </p>
  );
}
