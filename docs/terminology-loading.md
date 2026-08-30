# Loading a code system

openrunic ships terminology loaders and never terminology content. The clinically
useful code systems are licensed: some need a paid licence, some a national
affiliate agreement, and the terms differ per country and per deployment. A
project that bundled them would be redistributing content it has no right to
redistribute, and would be making a licensing decision on behalf of every
practice that installs it.

So the file comes from you, and this is how it gets in.

## What you need

1. **The content**, exported as `ndjson` or `tsv`, from whoever licenses it to
   you.
2. **A manifest** beside it, describing what the file is and asserting that this
   deployment may use it.

## The manifest

```json
{
  "systemUri": "http://loinc.org",
  "systemVersion": "2.83",
  "sourceName": "Regenstrief Institute, LOINC Complete (LoincTableCore)",
  "sourceReleaseDate": "2026-08-19",
  "contentHash": "sha256:<the payload's sha256>",
  "rowCount": 112405,
  "attestation": {
    "attestedBy": "A Person",
    "attestedRole": "Maintainer",
    "attestedAt": "2026-08-30T12:00:00+00:00",
    "licenceHeld": true,
    "licenceStatement": "This deployment holds a LOINC account with Regenstrief Institute and accepts the LOINC License for use of LOINC 2.83.",
    "licenceReference": "https://loinc.org/license/"
  }
}
```

Every field answers a question somebody asks later. `systemUri` and
`systemVersion` because a code means nothing without both, and a second load has
to supersede the first rather than collide with it. `contentHash` because a load
is verifiable and repeatable or it is a mystery table. `rowCount` because a
truncated download otherwise reads as a smaller code system rather than as an
error.

`attestation` is the one part that is never optional. It records **who** said
this deployment holds a licence, **when** they said it, and **in their own
words** what they are asserting, so the answer to "who decided we could load
this" is a record instead of an argument. `licenceHeld` must be exactly `true`:
there is no default, no absent field that means consent, and nothing for a
template to fill in silently.

## Verifying before you load

```bash
pnpm --filter @openrunic/ops run ops terminology verify \
  --manifest ./manifest.json \
  --content ./codes.ndjson \
  --format ndjson
```

It reports the system, the release, the row count, the verified hash and the
attestation, and exits non-zero on any of:

| Refusal                 | What it means                                      |
| ----------------------- | -------------------------------------------------- |
| `missing_attestation`   | The manifest was filled in but not signed          |
| `invalid_manifest`      | A field is missing or malformed                    |
| `content_hash_mismatch` | The payload is not the file the manifest describes |
| `row_count_mismatch`    | The download is truncated                          |
| `invalid_rows`          | A row is unusable, reported with its line number   |
| `empty_content`         | The payload carried no rows                        |

Nothing is written by this command. Pass `--emit <path>` for the normalised
rows, which carry the manifest's system and version on every row, with
duplicates already refused and defaults applied.

## Getting the rows in

Load the emitted NDJSON with whatever your deployment already uses: `POST
/terminology` for a small system, or `\copy` into `TerminologyCode` for a large
one. Both take the normalised shape as-is.

## Converting a vendor export

Publishers ship what they ship. LOINC's `LoincTableCore.csv`, for example, is
CSV with its own column names, and the loader takes `ndjson` or `tsv` with a
fixed column order. Converting is your step, and it is deliberately not this
tool's: a converter per publisher would put vendor-specific mapping decisions
into a package whose entire point is that it makes none.

Compute the hash **after** converting, over the file you are actually loading:

```bash
shasum -a 256 codes.ndjson
```
