# `@openrunic/hl7v2`

The interface codec. A pure, IO-free HL7 v2 encoder and decoder for the four message types a
practice's interfaces actually carry, and the acknowledgement every one of them is answered with.

| Message | Direction  | Entry points                            |
| ------- | ---------- | --------------------------------------- |
| ADT     | in and out | `buildAdt` / `parseAdt`                 |
| ORU     | in and out | `buildOru` / `parseOru`                 |
| ORM     | in and out | `buildOrm` / `parseOrm`                 |
| VXU     | in and out | `buildVxu` / `parseVxu`                 |
| ACK     | in and out | `buildAck` / `parseAck` / `acknowledge` |

It reads and writes strings. It opens no sockets, touches no database and reads no clock, so every
behaviour in it is reproducible from a fixture. Transport belongs to the interface engine;
persistence belongs to the service that files the result.

## The traps this format sets

**MSH is numbered differently from every other segment.** `MSH-1` is the field separator itself and
`MSH-2` the encoding characters, so splitting on the separator puts the sending application where
the standard calls it field 3. A parser that indexes MSH like every other segment reads the sender
as the receiver, and the message still looks plausible. It is handled once, in `message.ts`, so no
caller has to remember it.

**The delimiters are declared per message.** Almost every message says `|^~\&`, and a parser that
assumes so silently mangles the one interface that does not. They are read from each message and
threaded through, and the writer emits the set it was given.

**Grouping is positional.** Every OBX after an OBR belongs to that OBR until the next OBR appears.
Getting it wrong files a result under the previous order - a wrong value on the right patient, which
is the worst shape of interface defect there is. A result that arrives before any order is dropped
rather than attached to the one that follows it.

**Some absences are assertions and some are not.** A date in `PID-29` with no `Y` in `PID-30` is not
a death notification, and reading it as one puts a date of death on a living person's chart. An
amount of `999` in `RXA-6` is the code for "not recorded", not a dose of nine hundred and ninety-nine
units. An unset processing id is read as production, because treating real traffic as a test is the
failure that loses a result silently.

## What it is lenient about

Segment separators: the standard says carriage return, and this accepts newlines too, because a
sender that uses them is out of conformance and is also most senders at some point, usually because
a file went through a text editor. Unknown escape sequences are carried through verbatim rather than
dropped - `\Zxyz\` is somebody's local extension, and a value silently missing a run of characters
is worse for the person reading the chart than one carrying a sequence they can look up. Segments
this codec does not model survive a parse and a re-render unchanged.

## Testing

The round trip is the test that matters. A builder test asserts the pipes contain what its author
expected; a parser test asserts the parser reads what its author wrote; both pass while a field is
written into a position nothing reads back.

```bash
pnpm --filter @openrunic/hl7v2 test
```
