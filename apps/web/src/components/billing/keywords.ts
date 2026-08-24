/**
 * The search words a palette command answers to, in the reader's language.
 *
 * A command's keywords are the words a tired person types instead of the label,
 * so they are per-language and not transliterations: somebody searching in
 * Spanish does not type "scrub". The catalogue holds them as one comma
 * separated message per command, which is what makes them reviewable as a
 * phrase rather than as an array literal a translator has to reassemble, and
 * this splits that message back into the list the palette filters on.
 *
 * The same shape the shell's `navigateCommands` uses for the rail, kept
 * identical on purpose: two ways to write a keyword list is two ways for one to
 * drift.
 */
export function keywordsOf(message: string): string[] {
  return message
    .split(',')
    .map((word) => word.trim())
    .filter((word) => word !== '');
}
