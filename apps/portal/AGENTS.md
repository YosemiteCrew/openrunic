# apps/portal

Next.js 16. The patient portal, including the patient-facing assistant.

## The reader is not a clinician

Everything here is read by someone with no clinical training, often anxious, sometimes on a phone in
a waiting room. That is a design constraint, not a tone preference.

- Plain language. No clinical shorthand, no abbreviation a patient would have to look up.
- The portal is calmer and plainer than the staff app on purpose. Do not import the staff app's
  density.
- When the honest answer is "ask your care team", say that and offer the route, rather than
  improvising something that reads as advice.

## One chart, and it is theirs

A patient reaches exactly their own record. The compartment is enforced in `packages/agent-tools`
for the assistant and by the API's scoping everywhere else, and the test that guards it is written
against the allowlist rather than a list of tool names, so a new grant cannot widen it quietly.

Nothing here may show another person's data, raw clinical scoring, or anything that reads as
diagnosis. `docs/adr/0006-patient-agent-surface.md` is the decision record; read it before touching
the assistant.

## The assistant is off unless configured

Same rule as the clinician surface: no endpoint means no surface, a broken probe means no surface,
and an in-flight probe means no surface. It fails shut rather than appearing half-alive, and there
are tests for all three states.

## Styles come from the library

`@openrunic/ui` ships the stylesheet and its fonts. Import it; do not copy it into `public/`. That
workaround existed once because the package did not ship its font binaries, and it cost a
render-blocking request and uncacheable fonts until it was removed.

```bash
pnpm --filter portal test
pnpm --filter portal lint
```
