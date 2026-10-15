import { readFile } from 'node:fs/promises';
import { HttpException } from '@nestjs/common';
import type { ProgramSummary } from '@regimen-works/shared';
import type { ProgramsService } from './programs.service';

/**
 * `npm run programs:import <file>` (DN-150): an export loaded back into the
 * global library. Here rather than in the command so a test can drive it;
 * everything it checks after reading the file is `importGlobal`'s, which is
 * the editor's rules entry by entry and one transaction.
 */
export async function importProgramsFile(
  programs: Pick<ProgramsService, 'importGlobal'>,
  path: string,
): Promise<ProgramSummary[]> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    throw new Error(`Can't read ${path}.`);
  }
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    throw new Error(`${path} is not JSON. Is it a program export?`);
  }
  return programs.importGlobal(file);
}

/** What went wrong, as lines for a terminal rather than an HTTP body. */
export function failureLines(error: unknown): string[] {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    const message =
      typeof response === 'string'
        ? response
        : (response as { message?: string | string[] }).message;
    if (Array.isArray(message)) return message;
    return [message ?? error.message];
  }
  return [error instanceof Error ? error.message : String(error)];
}
