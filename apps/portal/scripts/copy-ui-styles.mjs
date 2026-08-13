/**
 * Copies the @openrunic/ui stylesheet into public/ so the app serves it.
 *
 * The library is consumed the way its README prescribes: as one served stylesheet with a
 * `fonts/` directory beside it, not as a bundler import. That is not a preference. The
 * built stylesheet carries `@font-face` rules pointing at `./fonts/*.woff2`, and the font
 * binaries are deliberately not shipped inside the package - a bundler asked to resolve
 * those URLs fails the build, while a browser asked to fetch them simply falls back to the
 * stacks in `tokens/typography.css`, which is the documented degradation.
 *
 * Drop the six OFL font files into `public/fonts/` to complete the typography. Nothing
 * breaks without them; the only loss is the variable optical-size axis.
 */

import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');

const source = join(appRoot, 'node_modules', '@openrunic', 'ui', 'dist', 'styles.css');
const target = join(appRoot, 'public', 'styles.css');

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);

process.stdout.write(`Copied @openrunic/ui stylesheet to ${target}\n`);
