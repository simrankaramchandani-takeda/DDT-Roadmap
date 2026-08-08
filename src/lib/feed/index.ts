/**
 * The feed layer's public surface.
 *
 * One import site for everything WP4 adds, so a later source switch touches this name
 * and no other. The layer is strictly one-directional: `dto` -> `outcomes` ->
 * `normalise` -> `adapter` -> `repositories`, and nothing below `adapter` knows the
 * domain model exists.
 */

export type {
  Feed3Payload,
  FeedIssueLinkRow,
  FeedIssueRow,
  FeedIssueTypeRow,
  FeedLabelRow,
  FeedOwnerRow,
  FeedServiceMetadata,
} from './dto.js';

export {
  DiagnosticCollector,
  diagnostic,
  error,
  isUsable,
  severityOf,
  valid,
  warning,
  worstSeverity,
  MAX_RENDERED_PER_CODE,
  type Diagnostic,
  type DiagnosticCode,
  type DiagnosticSeverity,
  type Outcome,
  type ValidationSeverity,
} from './outcomes.js';

export {
  canonicalProjectKey,
  classifyFeedProject,
  dedupeByIdentity,
  feedText,
  isInScopeProject,
  mapCustomFieldColumns,
  mapFeedSource,
  normaliseFeedStatus,
  parseFeedDate,
  parseFeedTimestamp,
  readLabelValue,
  resolveFeedSite,
  resolveIssueTypeLevel,
  type FeedProjectScope,
  type FeedSourceMetadata,
  type FeedStatus,
} from './normalise.js';

export {
  adaptCoverage,
  adaptFeedIssues,
  adaptFeedSnapshot,
  adaptInitiatives,
  adaptRoadmapItems,
  adaptSites,
  adaptSourceMetadata,
  type FeedAdaptation,
  type FeedAdapterOptions,
} from './adapter.js';

export { createFeedRepositories, type FeedRepositories } from './repositories.js';
