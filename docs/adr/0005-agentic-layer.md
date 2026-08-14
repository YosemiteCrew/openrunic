# 0005. An optional agentic layer over a deployer-configured inference endpoint

## Status

Accepted

Supplements [ADR-0004](0004-no-ml-runtime-in-core.md) and amends exactly one clause of it, named
below. ADR-0004 is not superseded and remains Accepted.

## Date

2026-08-13

## Context

ADR-0004 decided that no machine-learning runtime goes inside the core deployment, and that ML, if
it ever ships, arrives as "an optional, out-of-process adapter behind the existing partner-adapter
seam: a separate container, opt-in, never on the request path, and never required for the product to
run."

We now want an assistant that lets clinic staff ask questions of the record in natural language and
receive answers, drafts, and a very small set of bounded administrative actions. Nothing about it
would be bundled: no weights, no Python, no inference in our image. It would call an HTTPS endpoint
the deployer names, configures and pays for.

The tempting move is to say "we are not bundling a runtime, we are calling an endpoint, so ADR-0004
does not apply." That is half correct and half a dodge, and shipping on it would ship this decision
silently under an ADR that never considered it. ADR-0004 itself mandates the honest route: it
recorded that on-premise inference "will need revisiting through a new ADR rather than an
incremental change."

ADR-0004 rests on four constraints. Scored against an agent over a deployer-configured endpoint,
three clear and one does not.

| ADR-0004 constraint | Agent over a deployer-configured endpoint                                                                                                                                           | Verdict                                                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime shape       | An HTTPS client. No native modules, no second language runtime, no second process manager, and every package visible to the existing package-tree SBOM.                             | Clears.                                                                                                                                                        |
| Licence provenance  | Zero weights anywhere. The deployer supplies the endpoint, which is the same bring-your-own-content posture ADR-0004 calls this project's differentiator.                           | Clears, and is arguably the only shape ADR-0004 permits: bundling weights would violate it directly.                                                           |
| Deployability       | Nothing to download for the hosted path. For the self-hosted-model path the GPU problem is **relocated to the deployer, not solved**.                                               | Clears for the hosted path. Does not clear for the self-hosted path, which is documented as an opt-in with real hardware requirements, never as an equivalent. |
| Regulatory line     | **Identical concern, not improved at all by the change of deployment shape.** Where inference happens has no bearing on device status; intended purpose, claims and output type do. | Does not clear. Argued separately below.                                                                                                                       |

The load-bearing finding is that the runtime argument and the regulatory argument are independent,
and the first must not be allowed to imply the second. A pure HTTP client that tells a clinician
which antibiotic to start is a device. A bundled model that only does spell-check is not.

Two clauses of ADR-0004 the agent meets head-on:

**"Never on the request path."** A synchronous assistant surface is a request path by construction.
One reading reinterprets "request path" to mean "the agent's own path", which makes the clause
vacuous. The defensible reading is that ADR-0004 means the **clinical** request path: the paths a
clinician must traverse to render a chart, book an appointment, place an order or sign a note. We
take the second reading, and because it is a reading rather than the plain words, this ADR amends
the clause explicitly rather than quietly adopting the convenient interpretation.

**"No telemetry that exfiltrates health data."** This is genuinely new. Every option ADR-0004
evaluated kept data inside the deployment. Posting a chart excerpt to a third-party inference
endpoint is, in plain language, health-data egress to a third party. It can be entirely legitimate
under an executed agreement with a bounded retention position, but it cannot inherit ADR-0004's
reasoning, because ADR-0004 never had to consider it.

## Decision

We will add an optional, default-off agentic layer, and we will bind it with the rule below.

> **A deployer-configured remote inference endpoint is a new adapter class, not an ML runtime.**
> ADR-0004's prohibition on an in-image ML runtime is preserved in full: **no weights, no Python, no
> second language runtime, no in-image inference, ever.** What this ADR permits is an optional
> sidecar that speaks HTTP to an endpoint the deployer names, configures and pays for. It is
> default-off, never started by the default compose invocation, never required for any clinical
> workflow, and never on any clinical request path. Its behaviour is bound by ADR-0004's five
> adapter rules verbatim, and by three new rules that address concerns ADR-0004 did not have: named
> PHI egress, separate patient-surface gating, and retrieval-not-generation for clinical content.

### The amendment to ADR-0004, stated narrowly

ADR-0004's phrase "never on the request path" is amended to read **"never on a clinical request
path"**, and only for the adapter class this ADR defines. Nothing else in ADR-0004 changes. The
amendment is enforced architecturally rather than asserted:

1. The agent runs in a separate container that `docker compose up` does not start. It is reached
   only through `docker compose --profile agent up`.
2. The agent-disabled configuration is a **first-class CI target**, not an afterthought. A CI job
   runs the full test suite with no model configured and asserts every workflow completes.
3. Every agent-reachable capability has a deterministic non-agent UI path. If booking were possible
   only by asking the agent, a third-party model outage would become a clinical-availability outage,
   which is the most serious failure mode available in this design.
4. No screen reserves layout space for the agent. "Not configured" is a normal, styled product
   state, not an error.

If any screen degrades without the model, we have shipped the dependency we said we would not ship.
We would just have moved it over a socket.

### The eight binding rules

ADR-0004's five adapter rules, lifted verbatim and now binding on the agent:

1. **Never auto-commit to the chart.**
2. **Always display the source span** so a clinician can review the basis.
3. **Never rank by clinical risk.**
4. **Never emit content absent from the source.**
5. **State the intended purpose as documentation support.**

Two of those forbid features that were on the original request list. Recording it here rather than
leaving it to be discovered by an implementer who read only the summary:

- **Rule 3 forbids clinical-acuity inbox triage.** Ranking messages or results by how sick the
  patient sounds is ranking by clinical risk. Inbox assistance may classify only by administrative
  category and order only by service-level target. The feature is named "ordering", and the words
  "urgency", "acuity" and "triage" are banned from its strings.
- **Rule 4 forbids patient-facing interpretation of results.** Explaining what a number means is
  emitting content absent from the source. That stays on the curated code-to-plain-language mapping
  ADR-0004 already specified. A model may paraphrase clinician-authored commentary; it may never
  interpret a value.

The three new rules:

6. **Named egress.** A remote endpoint requires two independent settings: the endpoint plus its
   credential, and a **separate acknowledgement value naming the executed agreement and the
   responsible party**. One environment variable must not be able to start PHI flowing. A remote
   base URL configured without the acknowledgement is a hard startup failure of the agent subsystem,
   logged loudly, with the rest of the product unaffected.
7. **The patient surface is a separate decision.** A patient-facing agent is gated behind its own
   flag and its own ADR (ADR-0006, not written). ADR-0004 already graded patient-facing
   interpretation as "the weakest position of all"; shipping staff and patient behind one switch
   would silently adopt ADR-0004's own worst case.
8. **Retrieval, not generation, for clinical content.** A model cannot satisfy the
   independent-review criterion on its own reasoning: a next-token prediction has no disclosable
   basis, and a post-hoc rationale is just another generation. Any sentence that cannot carry a
   citation to a record row and field, or to an identified guideline with title, publisher, version
   and date, must not be emitted. This is enforced by a resolver in code, never by prompting.

### The one place this ADR supersedes rather than extends

ADR-0004 specifies Postgres full-text search for note search. A semantic-retrieval agent would want
embeddings. Our position, stated so it cannot be eroded one pull request at a time: **ship
full-text-search-first**. Embeddings obtained from the same deployer-configured external endpoint
are consistent with ADR-0004, because there is still no local runtime and no weights. **A local
embedding model is not**, and would need its own ADR. A "just a small embedding model" change is
exactly the shape of the decision ADR-0004 exists to stop, and it does not get to arrive
incidentally.

### What binds the architecture

- **Tools call the existing HTTP API with the end user's own credentials.** No tool receives a
  Prisma client and no tool touches the database. Tenant scoping, consent evaluation, policy checks
  and hash-chained audit writes are therefore enforced by middleware that already exists and is
  already tested, so the agent path and the browser path cannot become two doors with different
  locks. Enforced by lint and by test, not by review convention.
- **Deny by default.** A tool is unreachable unless it is granted to the caller's surface and role.
  Adding a tool to the codebase adds it to no surface. An ungranted tool is invisible, not merely
  refused, so the model is never told a capability exists that this caller cannot use.
- **Reader/writer split.** The loop that ingests untrusted content (note text, patient message
  bodies, document text, observation comments) holds retrieval tools only and **no state-changing
  tool at all**. Injection there produces a wrong answer, which is bad, but it cannot produce an
  action. Only ids, codes, enums, numbers and dates cross into the writer; free text never does.
  Enforced structurally, not by prompting.
- **No outbound-communication tool of any kind, ever.** No email, SMS, fax, webhook, URL fetch, file
  attach or external message create. Access to private data plus exposure to untrusted content plus
  the ability to communicate externally is the exfiltration trifecta; an EMR agent has the first two
  by definition, so the third is made structurally impossible.
- **Approval gating is server-side.** Every write tool is approval-always in v1. The approval token
  is bound to a hash of the exact proposed input and is single-use, so an approved "read chart 123"
  cannot be replayed as "read chart 456", and an approved input cannot be swapped after the fact.
- **Never a bare model string.** A provider instance is always constructed explicitly with an
  explicit base URL, banned by lint and asserted by a test, because the provider SDK otherwise
  routes an unqualified model name through a hosted gateway - a silent PHI-egress path nobody
  configured.
- **The agent is never a silent failover.** A fallback endpoint with a different PHI-egress posture
  turns an outage into a breach. Falling back from a local endpoint to a hosted one requires
  explicit deployer configuration and the acknowledgement value.
- **Audit records the agent from day one.** The delegating human stays the actor of record, because
  an access report has to answer "which human saw this chart". Delegation is recorded as an
  immutable, hashed `viaAgent` field carrying the run id, the exact model id, the surface and the
  mode. Those are ids and enums, so hashing them is correct and desirable: the chain can answer
  "which entries had an agent in the loop" permanently. **Free text never enters the hashed
  metadata**, because anything inside the hash can never be redacted, corrected or erased without
  destroying the tenant's chain from that point forward.

### The restated no-telemetry promise

ADR-0004's promise has to be restated precisely, because a configurable external endpoint changes
what it can honestly claim:

> openrunic never phones home. The software transmits nothing to the project, its maintainers, or
> any third party we choose. A deployer may configure an external inference endpoint; if they do,
> data they send to it goes to a processor **they** have contracted with, under an agreement **they**
> hold, and the product states plainly at configuration time and in the product that this is
> happening.

Anything looser misrepresents the project. Anything claiming that hosted inference is not egress is
false.

## Consequences

### Good

- The install story is unchanged. `docker compose up` still yields a complete product on a stock
  Linux box, and the default open-source configuration ships no model, no default endpoint and no
  trial key.
- No weights and no second language runtime enter the repository or the image, so ADR-0004's licence
  and SBOM properties survive intact.
- One authorisation implementation serves both the browser and the agent, because tools are ordinary
  API clients holding the caller's own credentials.
- The sidecar shape keeps the agent a cleanly separable module with its own declared intended
  purpose. If the agent module were ever classified as a device, it would not contaminate the rest
  of openrunic, which preserves the option to certify the agent alone.
- A stuck loop, an exhausted budget, or a dead endpoint costs the clinic its assistant and nothing
  else. That is the operational proof that the agent is genuinely optional.

### Bad, accepted

- One more container to operate, and tools now cross a network boundary to reach data. Both are
  accepted; the second is a security benefit in disguise.
- Self-hosted inference relocates the hardware problem rather than solving it. A clinic box without
  a GPU cannot serve a useful local model, and a server without continuous batching processes
  requests sequentially, so a second concurrent user waits for the first. Beyond roughly two
  concurrent users, local serving needs a real GPU and a batching server. The self-host docs say
  this in those words; "supports local models" must never be read as "runs well on the box you
  already have".
- Bring-your-own-model means the product's clinical behaviour is not reproducible or validatable by
  us. A deployer can point it at anything. This is the strongest independent argument for
  retrieval-grounded, citation-bound output, because it is the only defence a model-agnostic design
  has. The conformance suite is the mitigation: a deployer runs it against their endpoint and learns
  which capability tier they are in before go-live.
- Hosted inference is health-data egress, and saying so plainly costs us the simpler marketing line.
- Enforcement discretion in current decision-support guidance is not a safe harbour. It was chosen
  precisely so it can be withdrawn without changing the underlying statutory position, it is
  non-binding, and it binds no plaintiff in a malpractice or product-liability action.
- The EU line is binary and much less forgiving than the US line. There is effectively no Class I
  path for clinically relevant software: once a module qualifies, it is Class IIa with a notified
  body. We design to the EU line and let the US position follow.

### Not in v1, and why

Recorded here so that each is a decision with a reason rather than a backlog item someone picks up:

- **Generative order-set assembly.** The only defensible version is deterministic retrieval and
  prefill of a facility-authored, human-maintained template that the agent may _select_. The model
  may never author drug, dose, route or frequency. Patient-specific dosing and interaction flagging
  are named as device examples in EU guidance, and current decision-support guidance is
  conspicuously silent on generative models, so there is no shelter to point at.
- **Patient-facing result interpretation.** The device line, plus ADR-0004 rule 4.
- **Any acuity, urgency, triage or medical-necessity determination.** ADR-0004 rule 3, the
  decision-support criteria, and the fact that emergency patient triage is separately classified
  high-risk under EU AI rules regardless of device status. Hard-disabled in code, in every
  jurisdiction profile, and not reachable by configuration.
- **Autonomous claim submission.** False Claims Act exposure. A human submits.
- **Model-driven scheduling optimisation.** Models do not do constraint satisfaction, and a
  plausible schedule that violates an unmodelled constraint - licensure, room, equipment,
  interpreter - is worse than no suggestion. The model parses intent; the deterministic engine
  solves.
- **Ambient audio scribing.** Out of scope. If it ever ships, the source audio is never destroyed.
- **Any outbound-communication tool.** The trifecta argument above.
- **A patient-facing agent.** ADR-0006, its own flag, its own budget pool, its own disclosure
  regime.
- **Consuming third-party tool servers.** Letting the agent consume arbitrary external tool servers
  means arbitrary code paths seeing PHI, and such data flows sit outside at least one major
  provider's agreement coverage. Serving a tool-server facade generated from our own registry is a
  separate, later, off-by-default question.

## Alternatives considered

**Run the loop inside the API process.** Cheapest, and it shares the middleware. Rejected: it puts a
long-lived, high-latency, unbounded-memory workload inside the process that serves chart reads, so a
stuck loop with a large context degrades appointment booking. It violates "never on the request
path" under any reading, including the narrow one this ADR adopts.

**Run the loop in the browser.** Rejected: it puts the provider credential in an untrusted context,
moves tool execution to where the user can rewrite it, and makes server-side audit of agent actions
impossible. For an EMR that is a non-starter.

**Adopt a full agent framework rather than writing the loop.** Rejected for the leading candidate on
a hard ground: it ships a product-analytics client as a direct runtime dependency and has had
repeatedly refiled reports of telemetry transmitting despite the documented kill switch. For a
product whose stated promise is that it never phones home, a dependency with a known-unreliable
telemetry kill switch is disqualifying on principle, independent of whether any particular release
actually leaks. A second candidate, a graph-based durable-execution library, is genuinely
production-grade and was rejected only for v1 and only on fit: it imposes a graph abstraction, and
for a bounded tool set and short turns we would be buying a workflow engine to run a while-loop.
Revisit it if multi-hour clinical workflows ever appear.

**Write the provider layer ourselves too.** Rejected: tool-schema translation, streaming-delta
normalisation, structured-output repair and reasoning-block handling are thankless, high-churn,
per-vendor work with a wide test matrix, and rewriting them costs months for no compliance benefit.
We borrow the provider layer and own the policy layer - approval gating, scope enforcement, tenant
binding, audit writes, redaction and budget caps - because that is roughly three to five hundred
lines, it is where every compliance property lives, and an auditor must be able to read it top to
bottom without first learning a framework's callback lifecycle.

**Give tools direct database access.** Rejected outright, and this is the single most important
rejection in the design. An agent with direct database access is an agent that can quietly cross
tenants, and it would create a second authorisation implementation next to the one the browser
already exercises. Tools are ordinary API clients with no special privileges.

**Rely on a guard model to detect prompt injection.** Rejected as a control, kept only as defence in
depth. Off-the-shelf injection classifiers do not transfer to healthcare: a published benchmark
measured a leading guard model at 0.40 recall, falling further under adaptive attack, and the reason
is structural - most clinical threats are fluent, legitimate-looking requests that carry no attack
signal. Once an agent has ingested untrusted input it must be architecturally incapable of taking a
consequential action on it. Detection is defence in depth; architecture is the defence.

**Do nothing and leave the question to a reading of ADR-0004.** Rejected: leaving "never on the
request path" to a convenient interpretation is not honest, and it would let the dependency-weight
argument silently carry the regulatory conclusion. That is wrong on the law and would be read as
such by anyone reviewing it later.
