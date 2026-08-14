# @openrunic/agent

The loop and the provider layer for openrunic's optional assistant
([ADR-0005](../../docs/adr/0005-agentic-layer.md)).

**The assistant is off by default.** With no endpoint configured the product is complete: the API
mounts no agent routes, every agent path answers 404, and no screen reserves space for a surface
that is not there. This is the shipped open-source state and it is a normal state, not an error one.

## Configuration

openrunic ships **two zero-paperwork configurations: a local OpenAI-compatible endpoint, and
nothing.** There is no default provider, no default base URL and no trial key anywhere in this
package.

| Variable                                       | Meaning                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| `OPENRUNIC_AGENT_BASE_URL`                     | The endpoint. Absent means the assistant is off.                          |
| `OPENRUNIC_AGENT_MODEL`                        | The model id. Required alongside the base URL.                            |
| `OPENRUNIC_AGENT_API_KEY`                      | Optional credential for the endpoint.                                     |
| `OPENRUNIC_AGENT_PROVIDER`                     | `openai-compatible` (default) or `anthropic`.                             |
| `OPENRUNIC_AGENT_PHI_EGRESS`                   | `none` or `configured-baa`. Defaults to `none` only for a local endpoint. |
| `OPENRUNIC_AGENT_PHI_EGRESS_AGREEMENT`         | Names the executed agreement. Required for a remote endpoint.             |
| `OPENRUNIC_AGENT_PHI_EGRESS_RESPONSIBLE_PARTY` | Names who is answerable for it. Required for a remote endpoint.           |
| `OPENRUNIC_AGENT_APPROVAL_SECRET`              | Signs confirmations. At least 32 characters. Required to enable.          |
| `OPENRUNIC_AGENT_DAILY_BUDGET_CENTS`           | Per-tenant hard stop per day.                                             |
| `OPENRUNIC_AGENT_MONTHLY_BUDGET_CENTS`         | Per-tenant hard stop per month.                                           |
| `OPENRUNIC_AGENT_FALLBACK_*`                   | A spare endpoint. Refused unless its egress posture matches the primary.  |

**Named egress.** A remote endpoint needs two independent settings: the endpoint plus its
credential, and a separate acknowledgement naming the agreement and the responsible party. One
variable must not be able to start health data flowing. A remote base URL without the
acknowledgement is a hard failure of the assistant subsystem, reported loudly, with the rest of the
product unaffected.

> openrunic never phones home. The software transmits nothing to the project, its maintainers, or
> any third party we choose. A deployer may configure an external inference endpoint; if they do,
> data they send to it goes to a processor **they** have contracted with, under an agreement **they**
> hold, and the product states plainly at configuration time and in the product that this is
> happening.

## Never a bare model string

`ai` accepts a bare model name and, when given one, resolves it through a hosted routing gateway. In
a self-hosted, privacy-first EMR that is health-data egress nobody configured, and it would arrive
as one innocuous line of code. Three defences, all required:

1. **Types.** `ExplicitLanguageModel` removes the string form from the model type.
2. **Lint.** `eslint.config.mjs` refuses a literal in a `model` position and refuses to import the
   gateway package at all.
3. **Test.** `provider.test.ts` drives a real call through a recording `fetch` and asserts the URL
   contacted equals the configured base URL. If that test ever fails, do not relax it.

## `pnpm agent:conform`

Thirty fixture cases across nine families, runnable against any configured endpoint. A deployer
points openrunic at a model we have never evaluated, runs this **before go-live**, and learns three
things: whether the endpoint can run the loop at all, which capability tier they are in, and exactly
which fallbacks will fire. That is what turns "supports any model" into a testable promise.

The probes carry no patient data. They are invented words and small integers, identical on every
run. Exit codes: `0` usable, `1` not usable, `2` nothing configured or a misconfiguration.

The families are baseline, tool calling, forced calls, parallel calls, malformed arguments,
structured output, **system prompt**, oversized context and refusal. The system-prompt family is the
one that matters most: a dropped system prompt is a silent safety-policy failure, and it is
invisible unless probed. Anything less than every attempt passing counts as absent, because a safety
policy that sometimes vanishes is not one.

## What the loop owns

Provider normalisation is borrowed; the policy layer is ours, because that is where every compliance
property lives and an auditor has to be able to read it without first learning a framework's
callback lifecycle.

1. **Budget and concurrency.** Admission before the provider is contacted, one turn at a time per
   principal, hard per-tenant daily and monthly stops. Exhausting the budget makes the assistant
   unavailable and changes nothing else.
2. **The reader/writer split.** Two phases, two disjoint tool sets, two disjoint contexts. The
   reader may see untrusted record text and holds no state-changing tool; only ids, codes, enums,
   numbers and dates cross into the writer. Injection in the reader produces a wrong answer, which
   is bad, but it cannot produce an action.
3. **Deny by default.** A tool the caller was not granted was never advertised, and asking for it
   anyway is a guardrail block with its own audit record.
4. **Approval.** Every write produces a proposal plus a single-use token bound by HMAC to the exact
   input. Nothing executes inside a turn; a confirmation is a fresh authenticated action by a person
   who independently holds the permission, and it commits through the endpoint the human interface
   uses.
5. **Audit.** One chained event per turn, one per state-changing call, one per denial. The
   delegating human stays the actor of record; the agent is recorded beside them in an immutable
   `viaAgent` field of ids and enums. **Free text never enters the hashed metadata**, because
   anything inside the hash can never be redacted or erased.

## Capability degradation never weakens a safety property

A weaker endpoint gets fewer tools and more confirmations. It never gets looser approval gating,
because approval is enforced here and never by prompting, and nothing in `planDegradation` can
change an approval policy. There is no field there that could.
