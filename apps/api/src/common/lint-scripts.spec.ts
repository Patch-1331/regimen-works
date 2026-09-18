import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `npm run lint` must be a check (DN-56).
 *
 * It was `eslint --fix` here, which meant the CI lint gate repaired every
 * auto-fixable violation on the runner, exited 0, and threw the repair away —
 * so no fixable rule could fail CI at all. Locally it was worse than useless:
 * it edited the working tree and left the edits for whoever ran it next. It
 * once deleted a real null guard, because the Prisma client had not been
 * generated and `@typescript-eslint/no-unnecessary-type-assertion` judged the
 * `!` redundant against an `any`.
 *
 * This is a guard rather than a proof. It cannot tell you eslint behaves
 * correctly — only that nobody has put `--fix` back on the checking script,
 * which is a one-word change that would restore the whole failure silently and
 * which no other test in this repo would notice.
 */

const ROOT = join(__dirname, '..', '..', '..', '..');

function scriptsOf(dir: string): Record<string, string> {
  const raw = readFileSync(join(dir, 'package.json'), 'utf8');
  return (
    (JSON.parse(raw) as { scripts?: Record<string, string> }).scripts ?? {}
  );
}

/** Every workspace directory that has a package.json, from the root globs. */
function workspaces(): { name: string; dir: string }[] {
  return ['apps', 'packages'].flatMap((group) =>
    readdirSync(join(ROOT, group), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => ({
        name: `${group}/${e.name}`,
        dir: join(ROOT, group, e.name),
      })),
  );
}

describe('lint scripts', () => {
  const linting = workspaces().filter((w) => 'lint' in scriptsOf(w.dir));

  it('finds the workspaces that lint', () => {
    // Guards the loops below: a bad path would make every one of them vacuous
    // and this file would pass while checking nothing.
    expect(linting.length).toBeGreaterThan(0);
  });

  it.each(linting)('$name: `lint` does not fix', ({ dir }) => {
    expect(scriptsOf(dir).lint).not.toContain('--fix');
  });

  // Without one, the next person who wants the fixing behaviour back has
  // nowhere to put it except onto `lint`.
  it.each(linting)('$name: offers `lint:fix` instead', ({ dir }) => {
    const scripts = scriptsOf(dir);
    expect(scripts['lint:fix']).toBeDefined();
    expect(scripts['lint:fix']).toContain('--fix');
  });

  it('fans both out from the root, to the right one each', () => {
    const root = scriptsOf(ROOT);
    // Both halves matter. `--fix` is the obvious way to break this; pointing
    // the root's `lint` at each workspace's `lint:fix` is the quiet one, and
    // it carries no `--fix` of its own to notice.
    expect(root.lint).not.toMatch(/--fix|lint:fix/);
    expect(root.lint).toContain('run lint --workspaces');
    expect(root['lint:fix']).toContain('run lint:fix --workspaces');
  });
});
