# `@openrunic/i18n`

What a screen says, in the language of the person reading it.

| Question                                           | Entry point                      |
| -------------------------------------------------- | -------------------------------- |
| What does this key say in this locale?             | `lookup(catalogue, locale, key)` |
| How much of the source does this locale cover?     | `coverageOf(catalogue, locale)`  |
| Which translations can the source no longer reach? | `staleKeys(catalogue, locale)`   |
| Fill in the values                                 | `format(template, values, key)`  |
| Which plural form does this locale want?           | `plural(forms, count, locale)`   |

Pure and IO-free. It loads nothing, caches nothing and reads no files: a catalogue is a value the caller supplies, so a test and a deployment see the same lookup.

## A missing translation renders in the source language, never as nothing

Three things a lookup can do when a key is absent, and only one is safe on a clinical screen.

Rendering the key puts `patient.allergy.severity` where a label belongs - obvious in a demo, and in production it sits beside a real allergy. Rendering an empty string is worse, and it is the one that ships, because it looks tidy: a blank label does not read as broken, it reads as a field with no label, and the value beside it becomes unattributed. On a medication list that is a dose with nothing saying what it is a dose of.

Rendering the source language is obviously incomplete and obviously still information, so that is what happens - and `Rendered.fellBack` records it, because a fallback nobody counts is a translation gap nobody closes.

`es-MX` falls to `es` before it falls to the source. A Mexican Spanish speaker reading Castilian Spanish is reading their own language with unfamiliar word choices; reading English is not. That chain is why storing the region is worth anything.

An **untranslated** key and an **unknown** key are different answers. The first is a translation job; the second is a bug in the code that asked. Rendering both the same way is how a typo in a key survives to production looking like a backlog.

## Coverage is measured, not claimed

`coverageOf` counts what a locale actually has against the source, so "we support Spanish" is a number rather than a sentence in a README. A declared figure drifts the moment a source string is added - every new key is missing in every locale by definition - and this one moves on its own.

## A placeholder with no value is refused

`Give {dose} mg` rendered without `dose` becomes `Give  mg` wherever a missing value is treated as an empty string. Nothing throws, the sentence is still grammatical, and the number that made it an instruction is gone. Same shape as an empty array meaning "none": an absence rendered as a value.

A value the message does not use is reported too, because it is usually a renamed placeholder - so the message is missing one and silently dropping the other, and the pair is the signal.

## Plurals are the locale's rule, never `n === 1`

English has two forms and is why everybody writes `n === 1`. Polish has four, Arabic six, Japanese one. The failure is not a crash: it is a sentence that reads as broken to a native speaker and fine to whoever shipped it.

`Intl.PluralRules` is asked twice, and the second question is the one that matters. `new Intl.PluralRules('zz')` does **not** throw - it accepts any well-formed tag and quietly uses root rules, which have only `other`. Only a malformed tag throws, and a malformed tag was never the hazard. `supportedLocalesOf` is what distinguishes a locale the runtime knows from one it will silently fall back on.

`formatCount` is separate from `plural` and always used with it. The form and the digits are two different locale decisions - Arabic can select `few` and write the number in Eastern Arabic numerals - and interpolating a raw `String(count)` gets the grammar right and the numerals wrong.

## What this does not do

Loading, bundling or negotiating. There is no catalogue on disk here and no `Accept-Language` parsing: `User.locale` already records what a person reads, and a package that also decided where catalogues live would make that decision for every deployment.
