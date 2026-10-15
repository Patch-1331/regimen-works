import 'dotenv/config';

import { PrismaService } from '../prisma/prisma.service';
import { failureLines, importRoutinesFile } from './import-routines';
import { RoutinesService } from './routines.service';

/**
 * Loads a global routine export (DN-150). Every routine lands global and
 * live, or -- if any entry is refused -- none does.
 *
 *   npm run routines:import <file>      (in apps/api)
 *
 * It writes to whatever DATABASE_URL names. Production's database refuses
 * outside connections, so against production this runs on the API's host.
 */
async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: npm run routines:import <file>');
    process.exitCode = 2;
    return;
  }
  let prisma: PrismaService;
  try {
    prisma = new PrismaService();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  try {
    const created = await importRoutinesFile(new RoutinesService(prisma), path);
    console.log(
      `Loaded ${created.length} global routine${created.length === 1 ? '' : 's'}:`,
    );
    for (const routine of created) console.log(`  ${routine.name}`);
  } catch (error) {
    console.error('Nothing was loaded.');
    for (const line of failureLines(error)) console.error(`  ${line}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
