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
 * ## Two classes of question, one destination
 *
 * This began as speech acts alone - "should I", "is this normal" - and a reader
 * with a result in front of them often asks in neither shape. "Is 5.9 potassium
 * too high?" names a measurement and a magnitude and asks for nothing by name.
 * "Do I keep taking the metformin with this result?" is a plan rather than a
 * request for permission. Both belong on this route, so a second class sits
 * beside the speech acts: a question that names a measured value, either as a
 * number with a unit or by the name of the measurement.
 *
 * That class is a flat set of measurement names in alphabetical order. It has
 * no weights, no ordering and no second outcome: every entry lands on the same
 * words and the same route as "should I", and a set that cannot express a rank
 * cannot apply one, which is what keeps it inside ADR-0004 rule 3. It is also
 * the one place here that reads what a question names rather than only what it
 * asks for, so the line is worth stating plainly. A list of measurements is not
 * a list of things to worry about: there is no condition in it, no symptom, and
 * nothing saying one measurement matters more than another. "Is my chest
 * normal?" and "Is my knee normal?" still land in the same place for the same
 * reason, and "How do I book a blood test?" is still answered from the record.
 *
 * ADR-0006 is the reason this is the honest route rather than a cautious one:
 * no capability granted to this surface returns a measured value, so a question
 * about one has no answer here to give.
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
 * One alternation, `(?:a|b|c)`, out of a list.
 *
 * The patterns below are a pattern wrapped around a vocabulary, and the
 * vocabulary is the part a maintainer reads and adds to. Writing the list as a
 * list keeps it sorted, diffable and countable, and keeps the pattern itself
 * short enough to see at once. Non-capturing because nothing here reads a
 * group; `needsCareTeam` asks only whether a pattern matched.
 */
const oneOf = (words: readonly string[]): string => `(?:${words.join('|')})`;

/**
 * The words a plan for a medicine is made of, in every language this module
 * carries, in one list each.
 *
 * Both lists are alphabetical and hold English and Spanish together, because
 * every pattern runs against every question anyway: separating them would be a
 * distinction the matcher never makes, and one list can only ever match more
 * than two. Conjugated forms sit beside the infinitives because that is how
 * the question is typed, not how a dictionary lists it.
 */
const PLAN_VERBS: readonly string[] = [
  'aumentar',
  'bajar',
  'cambiar',
  'cambio',
  'carry on',
  'carrying on',
  'change',
  'changing',
  'continuar',
  'continue',
  'continuing',
  'continuo',
  'decrease',
  'dejar',
  'dejo',
  'doblar',
  'double',
  'duplicar',
  'halve',
  'increase',
  'keep',
  'keeping',
  'keeps',
  'parar',
  'paro',
  'partir',
  'pause',
  'reduce',
  'reducir',
  'restart',
  'saltar',
  'saltarme',
  'seguir',
  'sigo',
  'skip',
  'split',
  'stop',
  'stopping',
  'subir',
  'suspender',
  'suspendo',
  'swap',
  'switch',
];

/** What such a plan acts on. A medicine, a dose, or the form one comes in. */
const PLAN_OBJECTS: readonly string[] = [
  'comprimido',
  'comprimidos',
  'dosage',
  'dose',
  'doses',
  'dosis',
  'estatina',
  'estatinas',
  'inhalador',
  'inhaler',
  'injection',
  'insulin',
  'insulina',
  'inyeccion',
  'medicamento',
  'medicamentos',
  'medication',
  'medications',
  'medicina',
  'medicinas',
  'medicine',
  'medicines',
  'pastilla',
  'pastillas',
  'pildora',
  'pildoras',
  'pill',
  'pills',
  'puff',
  'puffs',
  'statin',
  'statins',
  'tablet',
  'tablets',
  'take',
  'taking',
  'tomando',
  'tomar',
  'tomo',
];

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
  any: [
    /* A plan for a medicine or a dose, rather than a request for permission to
       have one. "Can I stop the tablets" is already above; "Do I keep taking
       the metformin with this result?" and "¿Sigo tomando la metformina?" are
       the same question with the asking taken out of it, and read as a
       statement of what the reader is about to do.

       One list rather than one per language, because every pattern runs
       against every question anyway: splitting these would be a distinction
       the matcher never makes, and the merged list can only ever match more.
       The conjugated forms sit beside the infinitives because that is how the
       question is actually typed.

       The verb and the thing it acts on are both required, which is what keeps
       "How do I change my address?" and "¿Cómo cambio mi dirección?"
       answerable: `change` and `cambio` are ordinary words on this screen. No
       medicine is named here, only the words for the kind of thing one is. */
    new RegExp(String.raw`\b${oneOf(PLAN_VERBS)}\b[a-z0-9 ]{0,20}\b${oneOf(PLAN_OBJECTS)}\b`),
  ],
  en: [
    /\bshould i\b/,
    /\bdo i need\b/,
    /\bdo i have to\b/,
    /* "Is X normal", whatever X is. The judgement being asked for is in the verb
       and the adjective; what sits between them is not read and does not matter,
       which is what keeps this from becoming a list of things to worry about. */
    new RegExp(
      String.raw`\b${oneOf(['is', 'are', 'was', 'were'])}\b[a-z0-9 ]{0,40}\b${oneOf([
        'abnormal',
        'bad',
        'better',
        'dangerous',
        'elevated',
        'fine',
        'harmful',
        'high',
        'higher',
        'low',
        'lower',
        'normal',
        'ok',
        'okay',
        'out of range',
        'raised',
        'safe',
        'serious',
        'worse',
      ])}\b`
    ),
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
   * Several of these are narrower than their English counterparts, and each time
   * for the same reason: the Spanish word does two jobs and only one of them is
   * a request for a judgement. Each would otherwise fire on one of the three
   * things the intro copy tells a patient this page is for.
   *
   * - `debo` is both "I should" and "I owe", so it counts only in front of an
   *   infinitive. That keeps "¿Cuánto debo?" answerable, and this screen
   *   invites that question by name. It does **not** disambiguate the verb:
   *   "¿Cuánto debo pagar?" is a balance and is redirected, because "pagar" is
   *   an infinitive like any other. That is an accepted false match on the
   *   terms below, not an invariant to build on. `deberia` is left broad
   *   instead, for the same reason.
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
   * `deberia` is left broad for the same reason, and the counterexample is
   * worth naming because it is real: "¿Cuánto debería pagar según mi factura?"
   * is a question about a balance and it is redirected. The conditional is not
   * purely the advice mood, so narrowing it would mean deciding which verbs and
   * objects make an amount question - the enumeration the paragraph above rules
   * out, on the mood where the advice reading is strongest. The natural ways to
   * ask that question are "¿Cuánto debo?" and "¿Cuánto tengo que pagar?", and
   * the first is answered from the record.
   *
   * So it stays broad and "¿Qué tengo que pagar?" is redirected, which is the
   * trade the note at the top already describes. A false match sends somebody
   * to their care team and is never the wrong place; a miss leaves a health
   * question with the inference endpoint. Narrowing traded the cheap failure
   * for the expensive one.
   */
  es: [
    /* Two clitic slots, because Spanish stacks them: "tomármelo" is
       tomar + me + lo and folds to "tomarmelo". One slot caught
       "tomarme" and "tomarlo" and missed the compound. */
    /\bdebo [a-z]+r(me|te|se|nos|os)?(lo|la|los|las|le|les)?\b/,
    /\bdeberia\b/,
    /\btengo que\b/,
    /\bnecesito (que me|ir)\b/,
    /\bpuedo (dejar|empezar|tomar|saltarme|doblar|cambiar|parar)\b/,
    new RegExp(
      String.raw`\b${oneOf(['es', 'son', 'era', 'eran', 'esta', 'estan'])}\b[a-z0-9 ]{0,40}\b${oneOf(
        [
          'alta',
          'altas',
          'alto',
          'altos',
          'anormal',
          'anormales',
          'baja',
          'bajas',
          'bajo',
          'bajos',
          'bien',
          'elevada',
          'elevadas',
          'elevado',
          'elevados',
          'fuera de rango',
          'grave',
          'graves',
          'mala',
          'malo',
          'mejor',
          'normal',
          'normales',
          'peligrosa',
          'peligroso',
          'peor',
          'segura',
          'seguro',
        ]
      )}\b`
    ),
    /\bque (significa|significan|quiere decir)\b/,
    /\bque me pasa\b/,
    /\bque tengo\s*$/,
    /\bque hago\b/,
    /\bque haria usted\b/,
    /\b(diagnosticame|diagnosticar)\b/,
    /\bestoy (bien|mal|grave|enfermo|enferma|muriendo)\b/,
  ],
};

/**
 * Questions that name a measured value.
 *
 * A number with a unit, or the name of a measurement. Nothing here is a speech
 * act, which is why it is a record of its own rather than more entries above:
 * the name of that one says what it holds, and this would make it untrue.
 *
 * Read the note at the top of the file before adding to this. It is a flat set
 * of names, and every entry produces the same single outcome. There is no
 * weight, no threshold and no second destination, so nothing here can express
 * how worrying anything is. Adding a condition or a symptom would be a
 * different kind of list and is not what this is for.
 *
 * The name lists are alphabetical, because that is the order a maintainer can
 * check. The unit list is the one exception and is longest first, for the
 * reason written where it sits.
 *
 * `any` holds the forms that are spelled the same whatever the reader writes
 * in: digits, SI units and the abbreviations a report prints. The language
 * groups hold the words, and are kept separate for the same reason the speech
 * acts are - a language with no entry is visible as an empty line rather than
 * as silence.
 */
const ABOUT_A_MEASURED_VALUE: Readonly<Record<string, readonly RegExp[]>> = {
  any: [
    /* A number with a unit. The normaliser turns punctuation into spaces, so
       "5.9" arrives as "5 9" and "120/80 mmHg" as "120 80 mmhg"; the optional
       second group of digits is that, not a second number. Longer units come
       first so "mmol" is not read as "mm" followed by nothing. */
    new RegExp(
      /* No boundary before the unit, so "5mg" counts as well as "5 mg". */
      String.raw`\b\d+(?: \d+)? ?${oneOf([
        'mmhg',
        'mmol',
        'umol',
        'nmol',
        'pmol',
        'percent',
        'mcg',
        'bpm',
        'kpa',
        'ng',
        'ug',
        'mg',
        'iu',
        'kg',
        'ml',
        'dl',
        'cm',
        'mm',
      ])}\b`
    ),
    /* What a report prints where a word would be too long. `alt` is left out on
       purpose: it is an ordinary English word and this is the one entry that
       would fire on a question about something else entirely. */
    new RegExp(
      String.raw`\b${oneOf([
        'a1c',
        'alp',
        'ast',
        'bnp',
        'cd4',
        'crp',
        'egfr',
        'esr',
        'gfr',
        'ggt',
        'hba1c',
        'hdl',
        'inr',
        'ldl',
        'mcv',
        'o2',
        'psa',
        'spo2',
        'tsh',
        'wbc',
      ])}\b`
    ),
  ],
  en: [
    /* "blood" is not here on its own, so "How do I book a blood test?" is
       answered; the compounds that are the name of a measurement are. */
    new RegExp(
      String.raw`\b${oneOf([
        'albumin',
        'bicarbonate',
        'bilirubin',
        'blood count',
        'blood pressure',
        'blood sugar',
        'calcium',
        'chloride',
        'cholesterol',
        'creatinine',
        'ferritin',
        'folate',
        'glucose',
        'haemoglobin',
        'heart rate',
        'hemoglobin',
        'magnesium',
        'oxygen saturation',
        'phosphate',
        'platelets',
        'potassium',
        'pulse rate',
        'sodium',
        'triglycerides',
        'troponin',
        'urate',
        'urea',
        'uric acid',
        'vitamin d',
        'white cell count',
      ])}\b`
    ),
  ],
  es: [
    new RegExp(
      String.raw`\b${oneOf([
        'acido urico',
        'albumina',
        'azucar en sangre',
        'bicarbonato',
        'bilirrubina',
        'calcio',
        'cloruro',
        'colesterol',
        'creatinina',
        'ferritina',
        'folato',
        'fosfato',
        'frecuencia cardiaca',
        'glucosa',
        'hemoglobina',
        'hemograma',
        'magnesio',
        'plaquetas',
        'potasio',
        'presion arterial',
        'saturacion de oxigeno',
        'sodio',
        'tension arterial',
        'trigliceridos',
        'troponina',
        'urato',
        'urea',
        'vitamina d',
      ])}\b`
    ),
  ],
};

/**
 * Both classes, flattened once.
 *
 * The union is the whole point and is taken in one place: a pattern can only
 * ever add a match here, never take one away, whichever record or language it
 * was written in.
 */
const EVERY_PATTERN: readonly RegExp[] = [
  ...Object.values(ASKS_FOR_A_JUDGEMENT),
  ...Object.values(ABOUT_A_MEASURED_VALUE),
].flat();

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
