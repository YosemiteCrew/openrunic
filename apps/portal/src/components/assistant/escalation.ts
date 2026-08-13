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
 */

/**
 * Speech acts that ask for a judgement rather than for a record.
 *
 * Written as whole phrases, checked against the words of the question rather
 * than as substrings, so "should" inside "shoulder" does not match.
 */
const ASKS_FOR_A_JUDGEMENT: readonly RegExp[] = [
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
];

/**
 * Whether the honest answer is "ask your care team".
 *
 * Punctuation and case are stripped first so that "Should I?" and "should i"
 * are one question, which is how the person typing thinks of them.
 */
export function needsCareTeam(question: string): boolean {
  const words = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return ASKS_FOR_A_JUDGEMENT.some((pattern) => pattern.test(words));
}
