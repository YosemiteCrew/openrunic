# `@openrunic/cds-hooks`

The protocol half of CDS Hooks 2.0: the open contract by which an EMR asks for advice at the moment
a clinician is deciding, and gets back cards to show them.

| Piece              | Entry point                                              |
| ------------------ | -------------------------------------------------------- |
| Discovery document | `discoveryDocument(definitions)`                         |
| Service lookup     | `serviceById(services, id)`                              |
| Request validation | `parseRequest(body)`                                     |
| Context accessors  | `requireContextString` / `contextString` / `draftOrders` |
| Card construction  | `card(input)`                                            |

It holds no clinical logic and no chart access. What the cards actually say is decided in
`apps/api`, where the repositories are - so this can be tested without a database, and the
security-relevant reading of a request has one place to be reviewed.

## The field this deliberately does not honour

A CDS Hooks request may carry `fhirServer`: a URL the calling EMR offers so a service can fetch more
of the chart. Honouring it is a server-side request forgery with a specification behind it - the
caller names a host and this process connects to it.

Some CDS services genuinely need it. This one does not; it answers about a patient in its own
database. So the field is read, recorded on the parsed request, and never dereferenced, and
`fhirAuthorization` is not read at all because there is nothing to authenticate to. `prefetch` is
treated the same way: accepted, noted as offered, and not used, because trusting a caller's copy of
the chart would let the caller decide what the safety screening screens against.

Both decisions are recorded rather than hidden, so a route can audit that a caller offered a server
and was not followed.

## Why cards are built through a function

A card competes for a prescriber's attention against everything else on the screen, and the failure
mode of decision support is not a missing card - it is a stream of them that trains the reader to
dismiss without looking.

The indicator is a promise: `critical` means stop, and a system that says critical about something
routine has spent the word. The summary is capped at 140 characters by the specification, and the
cap is enforced here rather than left to a receiving system to truncate wherever it likes, because a
summary cut mid-clause by somebody else's renderer can invert its meaning. A card carrying
suggestions and no `selectionBehavior` is refused outright: the specification requires the field, and
a receiving EMR that finds it missing has no defined way to render the choice it is being offered.

```bash
pnpm --filter @openrunic/cds-hooks test
```
