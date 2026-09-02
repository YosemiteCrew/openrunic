import { describe, expect, it } from 'vitest';

import { fromFhirCarePlan, toFhirCarePlan, type DomainCarePlan } from './care-plan.js';
import { SYSTEMS } from './systems.js';

/**
 * Care plans, across the boundary and back.
 *
 * Almost all of this is about the narrative, because for this resource the
 * narrative is the payload. US Core's must-support list is `text`, `status`,
 * `intent`, `category` and `subject`, and of those only `text` says anything a
 * receiving clinician did not already know.
 *
 * Which makes the escaping a security property rather than formatting. `text.div`
 * is XHTML, and many clients render it as HTML straight into a chart.
 */

const PATIENT = '0192f1a0-0000-7000-8000-0000000000p1';
const AUTHOR = '0192f1a0-0000-7000-8000-0000000000u1';
const ENCOUNTER = '0192f1a0-0000-7000-8000-0000000000e1';

const PLAN: DomainCarePlan = {
  id: '0192f1a0-0000-7000-8000-0000000000c1',
  patientId: PATIENT,
  encounterId: ENCOUNTER,
  status: 'ACTIVE',
  intent: 'PLAN',
  title: 'Diabetes management',
  narrative: 'Continue metformin.\n\nRecheck HbA1c in three months.',
  periodStart: '2026-08-12T09:00:00.000Z',
  authorId: AUTHOR,
};

describe('toFhirCarePlan', () => {
  it('wraps the narrative as an XHTML div, one paragraph per written block', () => {
    /* A plan served as one unbroken block is materially harder to read than the
       one that was written, and the blank line is what the author meant by a
       break. */
    expect(toFhirCarePlan(PLAN).text?.div).toBe(
      '<div xmlns="http://www.w3.org/1999/xhtml">' +
        '<p>Continue metformin.</p>' +
        '<p>Recheck HbA1c in three months.</p>' +
        '</div>'
    );
  });

  it('escapes every character that would break the div or inject into it', () => {
    /*
     * The one that matters. A client rendering `text.div` as HTML would run
     * this script, and the resource would still be valid FHIR on the way in.
     */
    const hostile = toFhirCarePlan({
      ...PLAN,
      narrative: `<script>alert("x")</script> & O'Brien`,
    });

    expect(hostile.text?.div).not.toContain('<script>');
    expect(hostile.text?.div).toContain('&lt;script&gt;');
    expect(hostile.text?.div).toContain('&amp;');
    expect(hostile.text?.div).toContain('&quot;');
    expect(hostile.text?.div).toContain('&apos;');
  });

  it('escapes the ampersand first, so an escape sequence is not escaped twice', () => {
    /* Order-dependent and silent when wrong: escaping `<` first and `&` after
       turns `&lt;` into `&amp;lt;`, and the reader is shown the escape sequence
       rather than the character. */
    expect(toFhirCarePlan({ ...PLAN, narrative: 'a < b' }).text?.div).toContain('a &lt; b');
  });

  it('declares the narrative as additional rather than generated', () => {
    /* `generated` promises everything in the narrative is also in the structured
       data, and a consumer is entitled to drop it on that promise. Here the
       narrative is the only place the assessment exists. */
    expect(toFhirCarePlan(PLAN).text?.status).toBe('additional');
  });

  it('carries the assess-plan category on every plan', () => {
    /* Fixed rather than a column. US Core requires this code on every
       conforming instance, and a column would let a row claim one it does not
       allow. */
    expect(toFhirCarePlan(PLAN).category).toEqual([
      { coding: [{ system: SYSTEMS.usCoreCategory, code: 'assess-plan' }] },
    ]);
  });

  it('maps every status and every intent to its FHIR code', () => {
    const statuses = (
      ['DRAFT', 'ACTIVE', 'ON_HOLD', 'REVOKED', 'COMPLETED', 'ENTERED_IN_ERROR', 'UNKNOWN'] as const
    ).map((status) => toFhirCarePlan({ ...PLAN, status }).status);
    const intents = (['PROPOSAL', 'PLAN', 'ORDER', 'OPTION'] as const).map(
      (intent) => toFhirCarePlan({ ...PLAN, intent }).intent
    );

    expect(statuses).toEqual([
      'draft',
      'active',
      'on-hold',
      'revoked',
      'completed',
      'entered-in-error',
      'unknown',
    ]);
    expect(intents).toEqual(['proposal', 'plan', 'order', 'option']);
  });
});

describe('round trip', () => {
  it('returns every field it was given', () => {
    expect(fromFhirCarePlan(toFhirCarePlan(PLAN))).toEqual(PLAN);
  });

  it('returns the author text exactly, escapes and all', () => {
    /* The failure this guards is a narrative that survives one round trip and
       degrades on the next: each pass adding an `&amp;` until the chart reads
       `&amp;amp;amp;`. */
    const awkward = { ...PLAN, narrative: `Rx: warfarin & aspirin. Watch INR < 3.` };

    expect(fromFhirCarePlan(toFhirCarePlan(awkward)).narrative).toBe(awkward.narrative);
    expect(
      fromFhirCarePlan(toFhirCarePlan(fromFhirCarePlan(toFhirCarePlan(awkward)))).narrative
    ).toBe(awkward.narrative);
  });

  it('survives a plan with nothing but a subject, a status and a narrative', () => {
    const bare: DomainCarePlan = {
      id: '0192f1a0-0000-7000-8000-0000000000c2',
      patientId: PATIENT,
      status: 'ACTIVE',
      intent: 'PLAN',
      narrative: 'Reassess at the next visit.',
    };

    expect(fromFhirCarePlan(toFhirCarePlan(bare))).toEqual(bare);
  });

  it('keeps a single-paragraph plan single, rather than splitting on every newline', () => {
    /* A soft-wrapped line is one paragraph. Splitting on `\n` would turn a
       wrapped sentence into a list of fragments. */
    const wrapped = { ...PLAN, narrative: 'Continue metformin\nand recheck in three months.' };

    expect(fromFhirCarePlan(toFhirCarePlan(wrapped)).narrative).toBe(wrapped.narrative);
  });
});

describe('fromFhirCarePlan, on input it did not write', () => {
  const foreign = (div: string): fhir4.CarePlan => ({
    resourceType: 'CarePlan',
    id: 'external-1',
    status: 'active',
    intent: 'plan',
    text: { status: 'generated', div },
    subject: { reference: `Patient/${PATIENT}` },
  });

  it('reads a div that uses no paragraphs at all', () => {
    expect(
      fromFhirCarePlan(
        foreign('<div xmlns="http://www.w3.org/1999/xhtml">Reassess in a week.</div>')
      ).narrative
    ).toBe('Reassess in a week.');
  });

  it('drops markup another system put inside a paragraph', () => {
    /* Kept as text, it would be re-escaped on the way out and the reader would
       see the tags. Dropped, they read the words. */
    expect(
      fromFhirCarePlan(
        foreign(
          '<div xmlns="http://www.w3.org/1999/xhtml"><p>Increase <b>lisinopril</b>.</p></div>'
        )
      ).narrative
    ).toBe('Increase lisinopril.');
  });

  it('keeps a line break as a break rather than welding two instructions', () => {
    /*
     * The failure worth naming: dropping the tag gives "Increase doseMonitor
     * BP", which is not a formatting complaint but a different instruction, and
     * it reads as one word so nobody spots it.
     */
    expect(
      fromFhirCarePlan(
        foreign(
          '<div xmlns="http://www.w3.org/1999/xhtml"><p>Increase dose<br/>Monitor BP</p></div>'
        )
      ).narrative
    ).toBe('Increase dose\nMonitor BP');
  });

  it('does not put a space where an inline tag was', () => {
    /* The other half. Treating every tag as a boundary gives "Increase
       lisinopril ." with a space before the full stop, which is why the
       distinction between block and inline has to exist. */
    expect(
      fromFhirCarePlan(
        foreign(
          '<div xmlns="http://www.w3.org/1999/xhtml"><p>Increase <b>lisinopril</b>.</p></div>'
        )
      ).narrative
    ).toBe('Increase lisinopril.');
  });

  it('breaks between list items', () => {
    /* A plan written as a list is common, and run together it becomes one
       sentence that says something else. */
    expect(
      fromFhirCarePlan(
        foreign(
          '<div xmlns="http://www.w3.org/1999/xhtml"><ul><li>Stop aspirin</li><li>Start warfarin</li></ul></div>'
        )
      ).narrative
    ).toBe('Stop aspirin\nStart warfarin');
  });

  it('reads a tag with attributes and a self-closing slash as the same element', () => {
    /* `<br/>`, `<br />` and `<p class="x">` all name an element that separates.
       Reading the whole tag body as the name would treat them as inline. */
    expect(
      fromFhirCarePlan(
        foreign(
          '<div xmlns="http://www.w3.org/1999/xhtml">First<br />Second<p class="x">Third</p></div>'
        )
      ).narrative
    ).toBe('First\nSecond\nThird');
  });

  it('stops at an unclosed paragraph rather than inventing its end', () => {
    /* Treating the rest of the div as the paragraph's content would fabricate a
       boundary the author never wrote. */
    expect(
      fromFhirCarePlan(
        foreign('<div xmlns="http://www.w3.org/1999/xhtml"><p>First.</p><p>Never closed')
      ).narrative
    ).toBe('First.');
  });

  it('reads a plan with no narrative as an empty one rather than failing', () => {
    /* `text` is optional in the base resource even though US Core requires it,
       so a conforming-enough resource can arrive without one. */
    const domain = fromFhirCarePlan({
      resourceType: 'CarePlan',
      status: 'active',
      intent: 'plan',
      subject: { reference: `Patient/${PATIENT}` },
    });

    expect(domain.narrative).toBe('');
  });

  it('falls back to UNKNOWN and PLAN for codes outside the value sets', () => {
    const domain = fromFhirCarePlan({
      resourceType: 'CarePlan',
      status: 'nonsense' as fhir4.CarePlan['status'],
      intent: 'nonsense' as fhir4.CarePlan['intent'],
      subject: { reference: `Patient/${PATIENT}` },
    });

    expect(domain.status).toBe('UNKNOWN');
    expect(domain.intent).toBe('PLAN');
  });
});

describe('the narrative reader stays linear on hostile input', () => {
  /*
   * `text.div` arrives inside a resource posted by another system. The obvious
   * `/<p>([\s\S]*?)<\/p>/g` costs the square of the length on a div full of
   * unclosed paragraph tags: three characters of attack per unit of work. The
   * reader scans with `indexOf` instead, and this is the evidence rather than
   * the argument.
   *
   * The budget is loose enough to survive a loaded CI runner and tight enough
   * that a reintroduced backtracker cannot pass.
   */
  const BUDGET_MS = 1_000;
  const RUN = 100_000;

  function elapsed(work: () => void): number {
    const started = performance.now();
    work();
    return performance.now() - started;
  }

  function read(div: string): string {
    return fromFhirCarePlan({
      resourceType: 'CarePlan',
      status: 'active',
      intent: 'plan',
      text: { status: 'generated', div },
      subject: { reference: `Patient/${PATIENT}` },
    }).narrative;
  }

  it('handles a div that is nothing but unclosed paragraph tags', () => {
    expect(elapsed(() => read('<p>'.repeat(RUN)))).toBeLessThan(BUDGET_MS);
  });

  it('handles a div that is nothing but unclosed element tags', () => {
    expect(elapsed(() => read(`<p>${'<'.repeat(RUN)}</p>`))).toBeLessThan(BUDGET_MS);
  });

  it('handles a very long run of escape sequences', () => {
    expect(elapsed(() => read(`<p>${'&amp;'.repeat(RUN)}</p>`))).toBeLessThan(BUDGET_MS);
  });

  it('handles a narrative that is nothing but blank lines, on the way out', () => {
    const plan = { ...PLAN, narrative: '\n'.repeat(RUN) };

    expect(elapsed(() => toFhirCarePlan(plan))).toBeLessThan(BUDGET_MS);
  });
});
