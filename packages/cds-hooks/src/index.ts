/**
 * CDS Hooks 2.0: the open contract by which an EMR asks for advice at the
 * moment a clinician is deciding, and gets back cards to show them.
 *
 * This package is the protocol half - types, request validation, discovery and
 * card construction - and holds no clinical logic and no chart access. What the
 * cards actually say is decided in `apps/api`, where the repositories are, so
 * that this can be tested without a database and so the security-relevant
 * reading of a request has one place to be reviewed.
 */

export { CdsHooksError } from './errors.js';
export { card } from './cards.js';
export type { CardInput } from './cards.js';
export { discoveryDocument, serviceById } from './discovery.js';
export { contextString, draftOrders, parseRequest, requireContextString } from './request.js';
export type { CdsRequest } from './request.js';
export type {
  Action,
  Card,
  CdsResponse,
  Coding,
  DiscoveryDocument,
  Indicator,
  Link,
  ServiceDefinition,
  Source,
  Suggestion,
} from './protocol.js';
