import { appCatalogue, createTranslator } from '@openrunic/i18n';
import { describe, expect, it } from 'vitest';

import { filterSummary } from '@/app/(app)/admin/audit/AuditScreen';

/**
 * `ar-EG` is not a locale this build offers a reader, and it is here for the one
 * thing only an unsupported locale can show: the count and the message are two
 * separate decisions. The summary words fall back to English because there is
 * no Arabic catalogue, so an Eastern Arabic-Indic numeral inside an English
 * sentence is proof the count went through `formatCount` rather than into the
 * template - which is the whole reason this call site was changed.
 *
 * `filterSummary` is called directly rather than through a render, because
 * `vitest.setup.ts` pins every component's translator to English; the way to
 * reach another language is to build a translator and pass it to the function,
 * as `lib/__tests__/format.test.ts` does.
 */
const arabic = createTranslator(appCatalogue, 'ar-EG');

describe('filterSummary', () => {
  it("writes the count in the reader's numerals while the words fall back to English", () => {
    const summary = filterSummary(arabic, 1234, 0);
    // A digit in the Arabic-Indic block, and not one ASCII digit anywhere: the
    // number was formatted for the locale, grouping separator included.
    expect(summary).toMatch(/[٠-٩]/u);
    expect(summary).not.toMatch(/[0-9]/u);
    // The noun is still English, so the two decisions really are separate.
    expect(summary).toContain('events');
  });

  it("writes the breakglass count in the reader's numerals too", () => {
    // The breakglass branch renders two numbers in one sentence. A non-zero
    // breakglass count is the only way to reach it, and it must go through
    // `formatCount` like the total does - otherwise one number in the sentence
    // is localized and the other is raw ASCII, the mixed-numeral bug this call
    // site was changed to close.
    const summary = filterSummary(arabic, 1234, 56);
    expect(summary).toMatch(/[٠-٩]/u);
    expect(summary).not.toMatch(/[0-9]/u);
    // Both numbers are present as Arabic-Indic digits, and the noun stays English.
    expect(summary).toContain('breakglass');
  });
});
