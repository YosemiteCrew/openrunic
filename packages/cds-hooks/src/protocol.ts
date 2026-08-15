/**
 * CDS HOOKS 2.0, AS TYPES.
 *
 * The open contract by which an EMR asks for advice at the moment a clinician
 * is making a decision, and gets back cards to show them. It is the only
 * standard way a third party's decision support can appear inside somebody
 * else's chart, which is why it is worth implementing exactly rather than
 * approximately: a client written against the specification is a client this
 * server has never seen, and every field it expects has to be where it expects
 * it.
 *
 * The types below are the specification's, named as it names them. Where this
 * server does not implement something the specification allows, it is absent
 * here rather than present and ignored - see `fhirAuthorization` in request.ts
 * for the one that matters.
 */

/** How loudly a card is shown. `critical` interrupts; `info` does not. */
export type Indicator = 'info' | 'warning' | 'critical';

export interface Coding {
  readonly code: string;
  readonly system: string;
  readonly display?: string;
}

/**
 * Where a card came from.
 *
 * Required on every card, and the reason is the whole point of the protocol: a
 * clinician is being shown advice inside their own chart by something that is
 * not their EMR, and they have to be able to see what. A card with a vague
 * source is one nobody can decide how much to trust.
 */
export interface Source {
  readonly label: string;
  readonly url?: string;
  readonly icon?: string;
  readonly topic?: Coding;
}

export interface Action {
  readonly type: 'create' | 'update' | 'delete';
  readonly description: string;
  /** The FHIR resource to create or update. Absent for a delete. */
  readonly resource?: Record<string, unknown>;
  /** The id to delete. Absent for a create. */
  readonly resourceId?: string;
}

export interface Suggestion {
  readonly label: string;
  readonly uuid?: string;
  readonly isRecommended?: boolean;
  readonly actions?: readonly Action[];
}

export interface Link {
  readonly label: string;
  readonly url: string;
  /** `smart` launches an app with context; `absolute` is an ordinary link. */
  readonly type: 'absolute' | 'smart';
  readonly appContext?: string;
}

export interface Card {
  readonly uuid?: string;
  /** One line, shown always. The specification caps it at 140 characters. */
  readonly summary: string;
  /** Markdown, shown when the clinician opens the card. */
  readonly detail?: string;
  readonly indicator: Indicator;
  readonly source: Source;
  readonly suggestions?: readonly Suggestion[];
  /** Required by the specification whenever suggestions are present. */
  readonly selectionBehavior?: 'at-most-one' | 'any';
  readonly overrideReasons?: readonly Coding[];
  readonly links?: readonly Link[];
}

export interface CdsResponse {
  readonly cards: readonly Card[];
  /** Actions the EMR should apply without asking. Deliberately never used here. */
  readonly systemActions?: readonly Action[];
}

/** One service, as the discovery document describes it. */
export interface ServiceDefinition {
  /** The hook it answers: `patient-view`, `order-select`, `order-sign`. */
  readonly hook: string;
  readonly id: string;
  readonly title?: string;
  readonly description: string;
  /**
   * FHIR queries the EMR may run and pass in, saving a round trip.
   *
   * Advertised as a convenience and never depended on: this server reads the
   * chart it already holds. A service that required prefetch would fail against
   * every EMR that chose not to send it, and the specification explicitly allows
   * that choice.
   */
  readonly prefetch?: Readonly<Record<string, string>>;
  readonly usageRequirements?: string;
}

/** The discovery document served at `/cds-services`. */
export interface DiscoveryDocument {
  readonly services: readonly ServiceDefinition[];
}
