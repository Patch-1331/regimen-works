import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import {
  assertPinned,
  buildLibrary,
  sourceExercise,
  type Library,
} from '../../src/seed/library';
import { corrections, curation, leftOut } from './curation';

/**
 * The exercise library, read from the three files beside this one (DN-167,
 * ADR-0007 decision 3):
 *
 * - `free-exercise-db.json`: https://github.com/yuhonas/free-exercise-db,
 *   `dist/exercises.json` at commit f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5,
 *   committed as-is and refused if its checksum moves. Unlicense, so names
 *   and prose are ours to copy. Its images are not, and nothing reads them.
 * - `own-exercises.json`: the app's own, in the dataset's shape.
 * - `curation.ts`: what the scheduler needs to know about the exercises it
 *   prescribes, hand fixes to the rest, and what is left out and why.
 *
 * Reads files and nothing else: no client, no writes. The seed and the specs
 * both build the library through this, so what is checked is what ships.
 */
export function loadLibrary(): Library {
  const raw = readFileSync(join(__dirname, 'free-exercise-db.json'));
  assertPinned(raw);
  const read = (json: string) =>
    z.array(sourceExercise).parse(JSON.parse(json));

  return buildLibrary({
    dataset: read(raw.toString('utf8')),
    own: read(readFileSync(join(__dirname, 'own-exercises.json'), 'utf8')),
    curation,
    corrections,
    leftOut,
  });
}
