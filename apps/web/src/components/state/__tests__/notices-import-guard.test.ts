import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * THE NOTICES IMPORT RULE, AS A TEST RATHER THAN AS A PROMISE.
 *
 * `eslint.config.mjs` bans `Alert` and `Toast` from `@openrunic/ui` everywhere
 * except the wrapper, because imported from there they announce English to a
 * screen reader inside whatever `lang` the page carries (#312). The wrapper's
 * own docblock claimed that property long before anything enforced it, which is
 * how one word of five stayed English for thirty call sites.
 *
 * Two kinds of assertion here, and they answer different questions.
 *
 * BEHAVIOUR - does the rule fire, and does the exemption hold. Run through the
 * real config, so a config that stops loading fails rather than passing quietly.
 *
 * SHAPE - the exemption is `'no-restricted-imports': 'off'` for one file, which
 * is broader than the sentence it is making: it exempts that file from every
 * restricted import in that rule, not only from these two names. Measured, an
 * `ignores` on the restricting block is not narrower - it is wider, because it
 * removes the file from every rule in the block rather than from one. So the
 * exemption stays and the blast radius is pinned instead:
 *
 *   - the restricting block carries EXACTLY ONE restricted path. A second one
 *     added there would be silently swallowed for the wrapper. Put it in its own
 *     config block, where the exemption does not reach.
 *   - the exempting block turns off EXACTLY ONE rule. A second rule added there
 *     would be silently disabled for the wrapper too.
 *
 * Both are the "assert a count the file already knows" shape: the failure names
 * the block and says where the new restriction belongs.
 */

// vitest runs each workspace from its own root, and `import.meta.url` arrives
// through vite as a `/@fs/` URL that `readFile` cannot open. `beforeAll` below
// asserts this is the directory holding the config rather than assuming it.
const APP_ROOT = process.cwd();
const CONFIG = join(APP_ROOT, 'eslint.config.mjs');

const WRAPPER = join(APP_ROOT, 'src/components/state/Notices.tsx');
const A_SCREEN = join(APP_ROOT, 'src/components/state/__tests__/not-the-wrapper.tsx');

// Loading `eslint.config.mjs` pulls in the whole Next.js shareable config and
// its plugins, and that happens on the FIRST lint rather than on construction.
// Measured on a quiet machine: first lint 580 ms, every lint after it 3-8 ms -
// including one from a freshly constructed ESLint, so this is a process-wide
// cache and not something instance reuse would buy. Left where it fell, the
// whole 580 ms was charged to whichever case linted first, which is why that
// one case sat at 3.3 s on a quiet machine and 8.9 s under workspace load
// against a 5000 ms budget while the other four finished in tens of ms (#532).
// `beforeAll` below pays it once, so no case is charged for it.
//
// The hook needs its own budget because 8.9 s was the slowest cold load seen in
// #532 and the same file ran 2-3x slower beside the rest of the workspace, which
// is past the 10000 ms vitest gives a hook. Generous on purpose: nothing an
// assertion says depends on this number, so it is only here to make a wedged
// config load fail rather than hang.
const CONFIG_LOAD_BUDGET_MS = 60_000;

async function restrictedImportsIn(code: string, filePath: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: APP_ROOT });
  const [result] = await eslint.lintText(code, { filePath, warnIgnored: false });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === 'no-restricted-imports')
    .map((message) => message.message);
}

describe('the notices import rule', () => {
  // A guard read out of a file needs an assertion that it read the right file:
  // every check below is vacuous if the config resolves somewhere else.
  beforeAll(async () => {
    expect(APP_ROOT.endsWith(join('apps', 'web'))).toBe(true);
    // Keyed on something no assertion below reads, so this fires only for "wrong
    // file" and never steals a failure from the check that would name the cause.
    await expect(readFile(CONFIG, 'utf8')).resolves.toContain('eslint-config-next');

    // Warms the config load described above. Deliberately unasserted and on an
    // import no case below uses, so it cannot take a failure from the case that
    // would name the cause - the point here is the cost, not the result.
    await restrictedImportsIn("import { Card } from '@openrunic/ui';\n", A_SCREEN);
  }, CONFIG_LOAD_BUDGET_MS);

  it('refuses Alert and Toast from the design system in an ordinary screen', async () => {
    const alert = await restrictedImportsIn("import { Alert } from '@openrunic/ui';\n", A_SCREEN);
    const toast = await restrictedImportsIn("import { Toast } from '@openrunic/ui';\n", A_SCREEN);
    // The renamed form is the one copy-pasted out of the wrapper, which imports
    // both under `Ui*` aliases - a rule keyed on the local name would miss it.
    const renamed = await restrictedImportsIn(
      "import { Toast as UiToast } from '@openrunic/ui';\n",
      A_SCREEN
    );

    expect(alert).toHaveLength(1);
    expect(toast).toHaveLength(1);
    expect(renamed).toHaveLength(1);
    expect(alert[0]).toContain('@/components/state');
  });

  it('allows the types, which carry no words', async () => {
    const tone = await restrictedImportsIn(
      "import type { ToastTone } from '@openrunic/ui';\n",
      A_SCREEN
    );
    const other = await restrictedImportsIn("import { Button } from '@openrunic/ui';\n", A_SCREEN);

    expect(tone).toEqual([]);
    expect(other).toEqual([]);
  });

  it('exempts the wrapper, which is the module that adds the words', async () => {
    const inWrapper = await restrictedImportsIn(
      "import { Alert as UiAlert, Toast as UiToast } from '@openrunic/ui';\n",
      WRAPPER
    );

    expect(inWrapper).toEqual([]);
  });

  it('restricts exactly one import path, because the wrapper is exempt from all of them', async () => {
    const source = await readFile(CONFIG, 'utf8');
    const restricting = source.match(
      /'no-restricted-imports':\s*\['error',\s*\{\s*paths:\s*\[([^\]]*)\]/
    );

    expect(restricting).not.toBeNull();
    const paths = (restricting?.[1] ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    // Not a smoke check: the one entry has to be the notices one, so renaming
    // the constant away cannot leave this green.
    expect(paths).toEqual(['NOTICE_COMPONENTS_VIA_WRAPPER']);
  });

  it('turns off exactly one rule for the wrapper', async () => {
    const source = await readFile(CONFIG, 'utf8');
    const exempting = source.slice(source.indexOf("files: ['src/components/state/Notices.tsx']"));

    expect(exempting).not.toEqual(source);
    const disabled = [...exempting.matchAll(/'([a-z@][\w@/-]*)':\s*'off'/g)].map(
      (match) => match[1]
    );

    expect(disabled).toEqual(['no-restricted-imports']);
  });
});
