# packages/agent and packages/agent-tools

The assistant loop, and the tool catalogue it is allowed to reach.

Three ADRs bind this code, and they are not background reading. Read them before changing anything
here, because most of the rules below are invisible in the code they govern: the code looks like it
would work fine without them.

- `docs/adr/0004-no-ml-runtime-in-core.md` - no weights, no Python, no inference inside the
  deployment.
- `docs/adr/0005-agentic-layer.md` - the eight binding rules.
- `docs/adr/0006-patient-agent-surface.md` - what changes when the reader is a patient.

## The properties that must stay true

Each of these is a test somewhere. If your change makes one of them awkward, the change is wrong,
not the rule.

**Off by default.** No endpoint configured means the routes answer 404, no surface renders, and the
product is byte-for-byte an EMR with no assistant in it. That is the shipped state, and it is a
normal state rather than an error one.

**Named egress needs two independent settings.** An endpoint plus a credential is not enough: a
separate acknowledgement must name the executed agreement and the responsible party. One environment
variable must never be able to start health data flowing.

**Never on a clinical request path.** A misconfigured or unreachable assistant costs a clinic its
assistant and nothing else. No booking, note, order or claim may depend on this package answering.

**Propose, never commit.** A proposal renders with no way to accept it. This is structural, not
procedural: there is no accept handler to find.

**Retrieval, not generation.** Every claim carries a link to the record behind it. A sentence that
cannot carry a citation to a row and field is not emitted. Nothing is shown that cannot be checked
against a source.

**Never rank by clinical risk.** The assistant does not decide which patient is sicker.

## The compartment is the part to be careful with

`packages/agent-tools` holds the allowlist and the compartment rules. A patient surface reaches
exactly one chart, its own, and the guard for that is written against `TOOL_ALLOWLIST.patient`
rather than against a hard-coded list of tool names, so that granting a new tool cannot widen the
compartment without the test noticing.

If you add a tool, the question is not "does it work" but "what can it reach, and who is asking".
Be conservative: three tools that are certainly safe beat ten that are arguable.

## No database import, ever

Neither package may import `@prisma/client` or `@openrunic/database`. There is a test whose only job
is to fail if that import appears. The loop reaches data through the API's own boundary, with the
caller's credential, so the API authorises the human rather than the agent.

```bash
pnpm --filter @openrunic/agent test
pnpm --filter @openrunic/agent-tools test
```
