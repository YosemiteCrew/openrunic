/// <reference types="fhir" preserve="true" />

import { enumMapping } from './enum-mapping.js';
import { compact, period, present, readString, setOptional } from './primitives.js';
import { fhirReference, referenceId } from './reference.js';
import { SYSTEMS } from './systems.js';

/**
 * The assessment and plan: what the clinician concluded and what happens next.
 *
 * ## The narrative is the resource
 *
 * Most resources here carry codes and the narrative is a courtesy. This one is
 * the other way round: US Core's must-support list for `CarePlan` is `text`,
 * `status`, `intent`, `category` and `subject`, and of those only `text` says
 * anything a receiving clinician did not already know. So the narrative is the
 * payload, and everything below it is about carrying that payload safely.
 *
 * ## Which means the escaping is a security property, not formatting
 *
 * `text.div` is XHTML, and a great many clients render it as HTML directly into
 * a chart. Narrative reaches this mapper as plain text authored by a person, so
 * an ampersand in "MI & CHF" would produce a div that is not well-formed XML,
 * and a `<` would produce whatever the client's parser made of it. Escaping is
 * what makes the difference between a document and an injection point, and it
 * happens here rather than at the storage boundary because this is the only
 * place that knows the destination is markup.
 */

export type DomainCarePlanStatus =
  'DRAFT' | 'ACTIVE' | 'ON_HOLD' | 'REVOKED' | 'COMPLETED' | 'ENTERED_IN_ERROR' | 'UNKNOWN';

export type DomainCarePlanIntent = 'PROPOSAL' | 'PLAN' | 'ORDER' | 'OPTION';

export const CARE_PLAN_STATUS = enumMapping<
  DomainCarePlanStatus,
  NonNullable<fhir4.CarePlan['status']>
>({
  map: {
    DRAFT: 'draft',
    ACTIVE: 'active',
    ON_HOLD: 'on-hold',
    REVOKED: 'revoked',
    COMPLETED: 'completed',
    ENTERED_IN_ERROR: 'entered-in-error',
    UNKNOWN: 'unknown',
  },
  fallback: 'UNKNOWN',
});

export const CARE_PLAN_INTENT = enumMapping<
  DomainCarePlanIntent,
  NonNullable<fhir4.CarePlan['intent']>
>({
  map: { PROPOSAL: 'proposal', PLAN: 'plan', ORDER: 'order', OPTION: 'option' },
  fallback: 'PLAN',
});

/**
 * The category every plan this server serves carries.
 *
 * Fixed rather than a column. US Core profiles `CarePlan` for exactly one
 * purpose, the assessment and plan, and requires this code on every conforming
 * instance. A column would let a row claim a category the profile does not
 * allow, and the resource would then fail validation somewhere downstream with
 * nothing here to explain why.
 */
const ASSESS_PLAN: fhir4.CodeableConcept = {
  coding: [{ system: SYSTEMS.usCoreCategory, code: 'assess-plan' }],
};

export interface DomainCarePlan {
  id: string;
  patientId: string;
  encounterId?: string;
  status: DomainCarePlanStatus;
  intent: DomainCarePlanIntent;
  title?: string;
  /** The assessment and plan, as plain text. Never markup. */
  narrative: string;
  periodStart?: string;
  periodEnd?: string;
  authorId?: string;
  /**
   * The goals this plan is working towards.
   *
   * The link is stored the other way round - a `Goal` row carries the
   * `carePlanId` it belongs to - and it is projected here because this is the
   * direction FHIR R4 defines. `Goal.addresses` points at the conditions a goal
   * concerns, not at a plan, so a plan-goal association emitted there was
   * invalid and was removed; `CarePlan.goal` is the conformant home for it, and
   * until it was projected the FHIR surface carried no plan-goal association at
   * all.
   *
   * Absent and empty are the same thing here and both mean "no goals on this
   * plan", which is the ordinary case: a plan is an assessment first, and most
   * carry none.
   */
  goalIds?: readonly string[];
}

/**
 * Escapes text for an XHTML text node.
 *
 * All five, not the three that are strictly required in content position. `"`
 * and `'` matter because the div is XML and a consumer may re-serialise this
 * text into an attribute; escaping them costs nothing and removes a class of
 * bug that only appears two systems downstream.
 *
 * The ampersand goes first. Escaping it after the others would rewrite the
 * ampersands they just introduced, turning `&lt;` into `&amp;lt;` and showing
 * the reader the escape sequence instead of the character.
 */
function escapeXhtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

const XHTML_NS = 'http://www.w3.org/1999/xhtml';

/**
 * Wraps authored text as an XHTML narrative.
 *
 * Blank lines become paragraphs, because that is what a clinician typing into a
 * plan box means by them, and a plan served as one unbroken block is materially
 * harder to read than the one that was written. Nothing else in the text is
 * interpreted: no lists, no emphasis, no links. Interpreting more would mean
 * deciding that some authored characters are markup, which is the decision that
 * turns a narrative into an injection point.
 */
function narrativeDiv(text: string): string {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block !== '');

  const body =
    paragraphs.length === 0
      ? ''
      : paragraphs.map((block) => `<p>${escapeXhtml(block)}</p>`).join('');
  return `<div xmlns="${XHTML_NS}">${body}</div>`;
}

/**
 * Reads the authored text back out of a narrative div.
 *
 * Scanned rather than matched with a regular expression, and deliberately.
 * `text.div` arrives inside a resource posted by another system, so it is
 * hostile input; the obvious `/<p>([\s\S]*?)<\/p>/g` costs the square of the
 * length on a div full of unclosed paragraph tags, which is three characters of
 * attack per unit of work. `indexOf` in a loop is linear by construction rather
 * than by argument, and there is no engine behaviour to reason about.
 */
function narrativeText(div: string | undefined): string {
  if (div === undefined) return '';

  const paragraphs: string[] = [];
  let cursor = 0;
  for (;;) {
    const open = div.indexOf('<p>', cursor);
    if (open === -1) break;
    const close = div.indexOf('</p>', open + 3);
    /* An unclosed paragraph ends the read. Treating the rest of the div as its
       content would invent a paragraph boundary the author did not write. */
    if (close === -1) break;
    paragraphs.push(div.slice(open + 3, close));
    cursor = close + 4;
  }

  /* A div with no paragraphs is either empty or was written by something that
     does not use them, and then the whole body is the text. */
  const source = paragraphs.length > 0 ? paragraphs : [div];
  return source
    .map((part) => unescapeXhtml(stripTags(part)))
    .join('\n\n')
    .trim();
}

/**
 * Element names that separate the text around them.
 *
 * The distinction is the whole point of this list. `<b>` inside a sentence is
 * not a boundary, so dropping it must leave "Increase lisinopril." intact
 * rather than "Increase lisinopril ." with a space before the full stop. A
 * `<br>` between two instructions is a boundary, and dropping it welds them
 * into "Increase doseMonitor BP", which is not a formatting complaint but a
 * different instruction.
 *
 * Deliberately short. Anything not named here is treated as inline, which is
 * the safe default: a missing break is easier to read past than an invented
 * one in the middle of a word.
 */
const BLOCK_ELEMENTS: ReadonlySet<string> = new Set([
  'br',
  'p',
  'div',
  'li',
  'ul',
  'ol',
  'tr',
  'td',
  'th',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'hr',
]);

/**
 * The element name inside a tag body, lowercased, or nothing.
 *
 * Takes the leading run of name characters, so `br /`, `/p` and `p class="x"`
 * all answer with the element. Scanned rather than matched, like everything
 * else that reads foreign input here.
 */
function elementName(body: string): string {
  const start = body.startsWith('/') ? 1 : 0;
  let end = start;
  while (end < body.length && /[A-Za-z0-9]/.test(body[end] ?? '')) end += 1;
  return body.slice(start, end).toLowerCase();
}

/**
 * Drops element tags, keeping the text between them.
 *
 * A block-level tag becomes a newline, because it is a boundary the author put
 * there; an inline one becomes nothing. A single newline survives the trip back
 * out, since the writer splits paragraphs on blank lines only.
 *
 * Same reasoning as the paragraph scan for the loop itself: linear by
 * construction. A `<` with no `>` after it ends the string, because the
 * alternative is to treat the rest as text and hand a consumer back something
 * that looks like markup.
 */
function stripTags(value: string): string {
  let out = '';
  let cursor = 0;
  for (;;) {
    const open = value.indexOf('<', cursor);
    if (open === -1) return out + value.slice(cursor);
    out += value.slice(cursor, open);
    const close = value.indexOf('>', open + 1);
    if (close === -1) return out;
    /* One break per boundary, however many tags mark it. `</li><li>` is two
       tags and one boundary, and emitting two newlines would make it a blank
       line, which the writer reads back as a paragraph break: the number of
       paragraphs would then depend on how the sender happened to nest its
       markup. */
    if (BLOCK_ELEMENTS.has(elementName(value.slice(open + 1, close))) && !out.endsWith('\n')) {
      out += '\n';
    }
    cursor = close + 1;
  }
}

/**
 * The inverse of {@link escapeXhtml}.
 *
 * The ampersand goes last here, mirroring the reason it goes first there: undo
 * it early and `&amp;lt;` would become `&lt;` and then `<`, resurrecting a
 * character the author had written literally as an escape sequence.
 */
function unescapeXhtml(text: string): string {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

/** Maps a {@link DomainCarePlan} to a FHIR R4 `CarePlan`. */
export function toFhirCarePlan(input: DomainCarePlan): fhir4.CarePlan {
  return compact<fhir4.CarePlan>({
    resourceType: 'CarePlan',
    id: input.id,
    /*
     * `additional`, not `generated`. `generated` promises that everything in
     * the narrative is also in the structured data, and a consumer is entitled
     * to drop it on that promise. Here the narrative is the only place the
     * assessment exists.
     */
    text: { status: 'additional', div: narrativeDiv(input.narrative) },
    status: CARE_PLAN_STATUS.toFhir(input.status),
    intent: CARE_PLAN_INTENT.toFhir(input.intent),
    category: [ASSESS_PLAN],
    title: input.title,
    subject: fhirReference('Patient', input.patientId),
    encounter:
      input.encounterId === undefined ? undefined : fhirReference('Encounter', input.encounterId),
    period: period(input.periodStart, input.periodEnd),
    author:
      input.authorId === undefined ? undefined : fhirReference('Practitioner', input.authorId),
    /* `compact` drops an empty array, so a plan with no goals emits no element
       rather than `goal: []` - which a consumer would read as a claim that the
       plan was checked and found to have none. */
    goal: present((input.goalIds ?? []).map((id) => fhirReference('Goal', id))),
  });
}

/** Maps a FHIR R4 `CarePlan` back to a {@link DomainCarePlan}. */
export function fromFhirCarePlan(resource: fhir4.CarePlan): DomainCarePlan {
  const domain: DomainCarePlan = {
    id: resource.id ?? '',
    patientId: referenceId(resource.subject, 'Patient') ?? '',
    status: CARE_PLAN_STATUS.fromFhir(resource.status),
    intent: CARE_PLAN_INTENT.fromFhir(resource.intent),
    narrative: narrativeText(resource.text?.div),
  };

  setOptional(domain, 'encounterId', referenceId(resource.encounter, 'Encounter'));
  setOptional(domain, 'title', readString(resource.title));
  setOptional(domain, 'periodStart', readString(resource.period?.start));
  setOptional(domain, 'periodEnd', readString(resource.period?.end));
  setOptional(domain, 'authorId', referenceId(resource.author, 'Practitioner'));

  /*
   * Read back only when the resource carried at least one. An absent `goal` and
   * an empty one both mean no goals, and writing `goalIds: []` for the first
   * would make a round trip report a field the sender never sent.
   *
   * A reference to anything other than a Goal is dropped rather than kept as an
   * id: `referenceId` refuses the type mismatch, and a plan that listed some
   * other resource among its goals is not a plan this system can hold.
   */
  const goalIds = present((resource.goal ?? []).map((one) => referenceId(one, 'Goal')));
  if (goalIds.length > 0) domain.goalIds = goalIds;
  return domain;
}
