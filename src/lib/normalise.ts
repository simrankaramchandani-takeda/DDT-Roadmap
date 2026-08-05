/**
 * Normalisation of raw Jira values into the domain model.
 *
 * Everything here exists because the same concept is represented differently in
 * different DDT projects. The rule throughout: coalesce over a candidate list,
 * tolerate absence, and report anything unrecognised rather than guessing.
 */

import {
  STATUS_CATEGORY_TO_PHASE,
  STATUS_NAME_TO_PHASE,
  STATUS_SUFFIXES_TO_STRIP,
  type CanonicalPhase,
} from '@config/status-map.js';
import { RAG_VALUE_TO_RISK_LEVEL, type RiskLevel } from '@config/narrative.js';
import {
  OWNER_FIELD_CANDIDATES,
  RAG_FIELD_CANDIDATES,
  SPOT_ID_FIELD_CANDIDATES,
  FIELD_OWNER_TEXT,
} from '@config/fields.js';
import type { AuthoredRag, ItemStatus, Owner } from '@/types/domain.js';

/** Loose shape of a raw Jira issue `fields` object. */
export type JiraFields = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Scalar extraction
// ---------------------------------------------------------------------------

/**
 * Jira represents "a value" half a dozen ways depending on field type: a plain
 * string, `{ value }` for select options, `{ displayName }` for users, or an
 * array of either. This flattens all of them to a string.
 */
export function extractScalar(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'string') return raw.trim() || undefined;
  if (typeof raw === 'number') return String(raw);

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const found = extractScalar(entry);
      if (found) return found;
    }
    return undefined;
  }

  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    for (const key of ['value', 'displayName', 'name', 'emailAddress']) {
      const candidate = obj[key];
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
  }

  return undefined;
}

/** Normalises a Jira date field to `YYYY-MM-DD`, or undefined. */
export function extractDate(raw: unknown): string | undefined {
  const value = extractScalar(raw);
  if (!value) return undefined;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : undefined;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Strips a trailing type qualifier. DDTJG statuses read `To Do - Epic`,
 * `In Progress - Epic`; without stripping, none of them match.
 */
export function stripStatusSuffix(name: string): string {
  const parts = name.split(/\s+-\s+/);
  if (parts.length < 2) return name;

  const last = parts[parts.length - 1]!.trim().toLowerCase();
  if (STATUS_SUFFIXES_TO_STRIP.includes(last)) {
    return parts.slice(0, -1).join(' - ').trim();
  }
  return name;
}

export interface NormalisedStatus extends ItemStatus {
  /** True when the name was unrecognised and the category fallback was used. */
  usedCategoryFallback: boolean;
}

/**
 * Resolves a Jira status to a canonical phase.
 * Never keys on status ID -- discovery found `Execute` under eight different IDs
 * across projects, so IDs cannot be compared.
 */
export function normaliseStatus(raw: unknown): NormalisedStatus {
  const status = (raw ?? {}) as Record<string, unknown>;
  const name = typeof status['name'] === 'string' ? status['name'] : 'Unknown';

  const category = status['statusCategory'] as Record<string, unknown> | undefined;
  const categoryKey = typeof category?.['key'] === 'string' ? category['key'] : 'new';

  const mappedCategory: ItemStatus['category'] =
    categoryKey === 'done' ? 'done' : categoryKey === 'indeterminate' ? 'in-progress' : 'todo';

  const lookupKey = stripStatusSuffix(name).toLowerCase().trim();
  const byName = STATUS_NAME_TO_PHASE[lookupKey];

  if (byName) {
    return { raw: name, phase: byName, category: mappedCategory, usedCategoryFallback: false };
  }

  const fallback: CanonicalPhase = STATUS_CATEGORY_TO_PHASE[categoryKey] ?? 'execute';
  return { raw: name, phase: fallback, category: mappedCategory, usedCategoryFallback: true };
}

// ---------------------------------------------------------------------------
// RAG / health
// ---------------------------------------------------------------------------

export interface NormalisedRag {
  level: RiskLevel;
  authored: AuthoredRag;
  isSpot: boolean;
}

/**
 * Resolves an authored RAG by coalescing the candidate fields in priority order.
 * SPOT `Overall Status` wins, per the approved decision.
 *
 * A recognisable-but-unmapped value (e.g. a new option like "On Hold") returns
 * undefined so the item falls through to derived risk rather than being coerced
 * into the wrong bucket.
 */
export function normaliseAuthoredRag(
  fields: JiraFields,
  updatedAt: string | undefined,
  candidates: readonly { id: string; label: string; isSpot: boolean }[] = RAG_FIELD_CANDIDATES,
): NormalisedRag | undefined {
  for (const candidate of candidates) {
    const value = extractScalar(fields[candidate.id]);
    if (!value) continue;

    const level = RAG_VALUE_TO_RISK_LEVEL[value.toLowerCase().trim()];
    if (!level) continue;

    return {
      level,
      isSpot: candidate.isSpot,
      authored: {
        value,
        fieldId: candidate.id,
        sourceLabel: candidate.label,
        ...(updatedAt ? { asOf: updatedAt } : {}),
      },
    };
  }

  return undefined;
}

/** Raw RAG values that were present but unmapped, for the warnings report. */
export function findUnmappedRagValues(
  fields: JiraFields,
  candidates: readonly { id: string; label: string }[] = RAG_FIELD_CANDIDATES,
): { fieldId: string; value: string }[] {
  const out: { fieldId: string; value: string }[] = [];
  for (const candidate of candidates) {
    const value = extractScalar(fields[candidate.id]);
    if (value && !RAG_VALUE_TO_RISK_LEVEL[value.toLowerCase().trim()]) {
      out.push({ fieldId: candidate.id, value });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Owners
// ---------------------------------------------------------------------------

/**
 * Collects owners across the candidate fields plus `assignee`, de-duplicated by
 * person. The same individual often appears as both assignee and delivery lead;
 * showing them twice reads as sloppy to an executive.
 */
export function normaliseOwners(fields: JiraFields): Owner[] {
  const owners: Owner[] = [];
  const seen = new Set<string>();

  const push = (role: string, name: string | undefined) => {
    if (!name) return;
    const dedupeKey = name.toLowerCase();
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    owners.push({ role, name });
  };

  for (const candidate of OWNER_FIELD_CANDIDATES) {
    push(candidate.role, extractScalar(fields[candidate.id]));
  }

  push('Assignee', extractScalar(fields['assignee']));
  push('Delivery Lead', extractScalar(fields[FIELD_OWNER_TEXT]));

  return owners;
}

// ---------------------------------------------------------------------------
// SPOT identifiers
// ---------------------------------------------------------------------------

/** SPOT ID from a dedicated field. Populated on only ~8 items; the summary
 *  parser recovers the rest. */
export function normaliseSpotIdFromField(fields: JiraFields): string | undefined {
  for (const fieldId of SPOT_ID_FIELD_CANDIDATES) {
    const value = extractScalar(fields[fieldId]);
    if (value && /^\d{6,8}$/.test(value.trim())) return value.trim();
  }
  return undefined;
}

/** Deep link into SPOT for a project id. */
export function spotUrlFor(spotId: string): string {
  return `https://tospot.azurewebsites.net/project-hub?projectId=${encodeURIComponent(spotId)}`;
}

// ---------------------------------------------------------------------------
// Description text
// ---------------------------------------------------------------------------

/**
 * Flattens an ADF document (or a markdown string, depending on the response
 * format) to plain text. Used for the description fallback in the executive
 * summary chain.
 */
export function flattenToText(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'string') return raw.trim() || undefined;

  if (typeof raw !== 'object') return undefined;

  const parts: string[] = [];

  const walk = (node: unknown): void => {
    if (node == null) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== 'object') return;

    const obj = node as Record<string, unknown>;
    if (obj['type'] === 'text' && typeof obj['text'] === 'string') {
      parts.push(obj['text']);
    }
    if (obj['type'] === 'hardBreak' || obj['type'] === 'paragraph') {
      parts.push('\n');
    }
    if (Array.isArray(obj['content'])) walk(obj['content']);
  };

  walk(raw);

  const text = parts
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text || undefined;
}
