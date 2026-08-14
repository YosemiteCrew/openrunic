# `@openrunic/ccda`

The document codec. A pure, IO-free C-CDA R2.1 Continuity of Care Document generator and parser -
the format a chart travels in when it leaves this practice for another one, or arrives from one.

| Direction | Entry point                          |
| --------- | ------------------------------------ |
| generate  | `generateCcd(document): string`      |
| import    | `parseCcd(xml): CcdDocument`         |
| inspect   | `parseDocumentTree(xml): XmlElement` |

It reads and writes strings. It opens no sockets, touches no database and reads no clock, so every
behaviour in it is reproducible from a fixture. Fetching the chart belongs to the API; storing what
an import produced belongs to reconciliation, which is a decision a person makes.

## Nine sections

Allergies, medications, problems, results, vital signs, immunisations, encounters, plan of
treatment, social history. Each is written with both a coded entry and a narrative row, because the
narrative is the attested content and is what a receiving system displays when it cannot map an
entry - which is often.

Each section is declared once, in `src/sections/`, as a `SectionSpec` giving its template, its LOINC
code, what a narrative row looks like and what one entry contains. The wrapper, the title, the
empty-section handling and finding the section again on the way back in are written once in
`src/section.ts`, so a section cannot be subtly different from the other eight.

## Why the XML is hand-written

Importing a C-CDA means parsing a file another organisation sent, which is the most hostile input
this system accepts. The historic way that goes wrong is XXE: a document declares an external
entity, the parser resolves it, and a clinical import becomes a file read or an outbound request
from inside the network. Every mainstream XML library has had that as a default at some point, and
every one fixes it by asking the caller to remember a flag.

This reader has no flag to remember, because the machinery is absent:

- `<!DOCTYPE` is refused outright, by name. No internal subset is parsed, so no entity can be
  declared - which also rules out billion-laughs expansion, since an entity that cannot be declared
  cannot recurse.
- The only entities are the five predefined ones and numeric character references. There is no
  entity table to add to.
- Nothing in it opens a file, a socket or a URL.

It is a character scanner rather than a set of regular expressions, so there is no backtracking to
be catastrophic; `reader.test.ts` holds the linearity regression test alongside the refusals.

## What it will and will not do on import

Lenient about what it accepts, strict about what it claims. A section that is absent, empty, or
written by a generator this codec has never seen yields an empty list rather than an exception:
refusing a whole chart because one section was unfamiliar is what makes an import feature unusable
in the field, where every document comes from a different vendor.

What it will not do is guess. An entry it cannot read a substance or a medication out of comes back
with an explicit `Unknown` display rather than a plausible one, because the person reconciling the
import needs to see which rows to check.

## Testing

The round trip is the test that matters. A generator test asserts the XML has the elements its
author expected; a parser test asserts the parser reads the XML its author wrote. Both pass while a
field is written into an element nothing reads back - the defect this codec is most likely to have,
and the one a receiving practice discovers as a missing allergy.

```bash
pnpm --filter @openrunic/ccda test
```
