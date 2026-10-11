/**
 * Whether a movement has anything to read. An empty list is the "no copy"
 * answer (DN-165), and an empty array is truthy — so every surface asks this
 * rather than testing `instructions` itself, or a movement with no steps
 * would get a caret that opens onto nothing.
 */
export function hasInstructions(steps: readonly string[]): boolean {
  return steps.length > 0;
}
