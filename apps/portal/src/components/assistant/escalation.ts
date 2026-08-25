/**
 * Questions this surface does not carry, and where they go instead.
 *
 * The assistant looks things up. It cannot say what a number means, whether
 * something is serious, or what to do next, and the honest response to being
 * asked is to say so and hand over the route rather than to improvise an answer
 * and put a caveat under it. A caveat under an answer is read after the answer.
 *
 * Two things this deliberately is not.
 *
 * It is **not a judgement about the reader**. It matches on the shape of the
 * request - "should I", "is this normal" - and never on what the request is
 * about. It has no list of conditions, no list of symptoms, and no notion of
 * how worrying anything is. Every match goes to the same place with the same
 * words, so nothing here ranks or sorts by how bad something sounds, which
 * ADR-0004 rule 3 forbids and ADR-0005 hard-disables.
 *
 * It is **not the control**. ADR-0005 is explicit that detection is defence in
 * depth and architecture is the defence: the reason this surface cannot
 * interpret a result is that no capability granted to it returns one and every
 * sentence has to carry a citation to a stored row. This check exists so that
 * a question with an obvious answer gets the obvious answer immediately,
 * without a round trip to a service that would have to decline it. It fails in
 * the safe direction by construction - a miss lands on a surface that still
 * cannot interpret anything, and a false match sends somebody to their care
 * team, which is never the wrong place.
 *
 * ## Every language's patterns, against every question
 *
 * The portal renders in the reader's language, so a reader asks in it. This
 * matched English speech acts only, which meant the redirect quietly stopped
 * applying to anybody reading Spanish: "should I stop taking the tablets" was
 * handed to the care team and "¿Debo dejar de tomar las pastillas?" was not.
 *
 * The fix is not to select the reader's patterns by locale. That would put a
 * fail-open case in the middle of a safety path: a language that ships words
 * but no speech acts would match nothing at all, and nothing about the portal
 * would look wrong. Every language's patterns run against every question
 * instead, so a locale can only ever add matches and never remove them.
 *
 * The cost of that choice is a question in one language matching a pattern
 * written for another. The paragraph above already says what happens then: a
 * false match sends somebody to their care team, which is never the wrong
 * place. Trading a false match for a fail-open gap is the whole reason this
 * runs the union.
 */

/**
 * Speech acts that ask for a judgement rather than for a record.
 *
 * Written as whole phrases, checked against the words of the question rather
 * than as substrings, so "should" inside "shoulder" does not match.
 *
 * Grouped by the language they were written for, because that is the unit
 * somebody adding a language works in and the grouping is what makes a missing
 * language visible. They are all applied regardless of what the reader chose.
 */
const ASKS_FOR_A_JUDGEMENT: Readonly<Record<string, readonly RegExp[]>> = {
  en: [
    /\bshould i\b/,
    /\bdo i need\b/,
    /\bdo i have to\b/,
    /* "Is X normal", whatever X is. The judgement being asked for is in the verb
       and the adjective; what sits between them is not read and does not matter,
       which is what keeps this from becoming a list of things to worry about. */
    /\b(is|are|was|were)\b[a-z0-9 ]{0,40}\b(normal|serious|safe|dangerous|harmful|bad|ok|okay|fine)\b/,
    /\bwhat does (it|this|that|the result|my result) mean\b/,
    /\bwhat do (my|these|the) results mean\b/,
    /\bwhat is wrong with me\b/,
    /\bwhats wrong with me\b/,
    /\bcan i (stop|start|take|skip|double|change)\b/,
    /\bwhat should i\b/,
    /\bwhat would you\b/,
    /\bdiagnose\b/,
    /\bam i (ok|okay|alright|dying|ill)\b/,
  ],
  /*
   * Spanish.
   *
   * Written against the folded form, so no accents appear here: the normaliser
   * below turns "qué" into "que" and "años" into "anos" before any of these are
   * tried.
   *
   * `deberia` is the ordinary way to put this speech act, the way "should I" is
   * in English. `debo` and `tengo que` are the obligation forms of the same
   * request. None of the three is exceptional; they are three moods of one
   * thing, and a maintainer adding a fourth should treat them as a set.
   *
   * Three of these are narrower than their English counterparts, and each time
   * for the same reason: the Spanish word does two jobs and only one of them is
   * a request for a judgement. Each would otherwise fire on one of the three
   * things the intro copy tells a patient this page is for.
   *
   * - `debo` is both "I should" and "I owe", so it counts only in front of an
   *   infinitive. "¿Cuánto debo?" with nothing after it is a balance, and this
   *   screen invites that question by name. `deberia` needs no such narrowing:
   *   the conditional has no reading about a balance.
   * - `diagnostic-` is the noun the health record uses for a condition, so only
   *   the verb forms count. "¿Qué diagnósticos tengo?" asks for a list of rows.
   * - `necesito` in front of a bare verb is usually "I need to see my bill", so
   *   only the forms that ask somebody to act count.
   * - `que tengo` is "what is wrong with me" only when nothing follows it.
   *   "¿Qué tengo pendiente de pago?" is a balance again.
   *
   * `tengo que` is deliberately **not** narrowed, and the reasoning is worth
   * keeping because the obvious narrowing is wrong. An earlier version read it
   * as a record question whenever an interrogative introduced it, on the
   * strength of "¿Qué tengo que pagar?" being a balance. But "¿Qué tengo que
   * hacer?" is the plainest way there is to ask somebody to decide, and it is
   * introduced by the same word. The interrogative does not carry the
   * distinction; the verb after it does, and enumerating verbs is how this
   * becomes the list of things to worry about that the note at the top forbids.
   *
   * So it stays broad and "¿Qué tengo que pagar?" is redirected, which is the
   * trade the note at the top already describes. A false match sends somebody
   * to their care team and is never the wrong place; a miss leaves a health
   * question with the inference endpoint. Narrowing traded the cheap failure
   * for the expensive one.
   */
  es: [
    /\bdebo [a-z]+r(me|te|lo|la|se|los|las|nos)?\b/,
    /\bdeberia\b/,
    /\btengo que\b/,
    /\bnecesito (que me|ir)\b/,
    /\bpuedo (dejar|empezar|tomar|saltarme|doblar|cambiar|parar)\b/,
    /\b(es|son|era|eran|esta|estan)\b[a-z0-9 ]{0,40}\b(normal|normales|grave|graves|seguro|segura|peligroso|peligrosa|malo|mala|bien)\b/,
    /\bque (significa|significan|quiere decir)\b/,
    /\bque me pasa\b/,
    /\bque tengo\s*$/,
    /\bque hago\b/,
    /\bque haria usted\b/,
    /\b(diagnosticame|diagnosticar)\b/,
    /\bestoy (bien|mal|grave|enfermo|enferma|muriendo)\b/,
  ],
};

const EVERY_PATTERN: readonly RegExp[] = Object.values(ASKS_FOR_A_JUDGEMENT).flat();

/**
 * The question, reduced to the words a pattern is written against.
 *
 * Punctuation and case go first so that "Should I?" and "should i" are one
 * question, which is how the person typing thinks of them.
 *
 * Accents are **folded rather than dropped**. This used to strip everything
 * outside `[a-z0-9\s]`, which deleted the letter along with its mark: "años"
 * became "a os" and "qué" became "qu", so a Spanish pattern could not have
 * matched even once one existed. Decomposing first and removing the combining
 * marks leaves "anos" and "que", which is the form the patterns above are
 * written in.
 */
function foldedWords(question: string): string {
  return (
    question
      .toLowerCase()
      .normalize('NFD')
      // The combining diacritical marks block. Removing these after decomposition
      // is what turns an accented letter into its base letter rather than into a
      // gap where a letter used to be.
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Whether the honest answer is "ask your care team". */
export function needsCareTeam(question: string): boolean {
  const words = foldedWords(question);
  return EVERY_PATTERN.some((pattern) => pattern.test(words));
}
