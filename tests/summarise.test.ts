import { describe, expect, it } from 'vitest';
import { buildNarrative, extractDescriptionExcerpt, generateSummary } from '@/lib/summarise.js';
import { assessRisk } from '@/lib/risk.js';
import type { ItemStatus } from '@/types/domain.js';
import type { SpotNarrative } from '@/lib/adf.js';

const ASOF = '2026-08-05';

function status(raw: string, phase: ItemStatus['phase'], category: ItemStatus['category']): ItemStatus {
  return { raw, phase, category };
}

const executing = status('Execute', 'execute', 'in-progress');

function riskFor(overrides: Parameters<typeof assessRisk>[0] extends infer T ? Partial<T> : never) {
  return assessRisk({
    status: executing,
    daysSinceUpdate: 5,
    blockers: [],
    asOf: ASOF,
    ...(overrides as object),
  } as Parameters<typeof assessRisk>[0]);
}

describe('source precedence', () => {
  it('uses the SPOT status description verbatim when present', () => {
    const spot: SpotNarrative = {
      statusDescription: 'The target date of this project completion is being discussed',
      recentAccomplishments: 'EOL dates confirmed',
      nextPriorities: 'LAN controller replacement',
      phase: 'Execute',
      unmappedLabels: [],
    };

    const narrative = buildNarrative({
      risk: riskFor({ start: '2026-06-30', end: '2028-04-01' }),
      phase: 'execute',
      statusRaw: 'In Progress',
      start: '2026-06-30',
      goLive: '2028-04-01',
      daysSinceUpdate: 9,
      updatedAt: '2026-07-27T01:45:41.890-0500',
      spot,
      description: 'A description that should be ignored in favour of SPOT.',
    });

    expect(narrative.summarySource).toBe('spot');
    expect(narrative.executiveSummary).toBe(spot.statusDescription);
    expect(narrative.recentAccomplishments).toBe('EOL dates confirmed');
    expect(narrative.summaryBasis).toBeUndefined();
  });

  it('falls back to the Jira description when SPOT has no status text', () => {
    const narrative = buildNarrative({
      risk: riskFor({ start: '2026-01-01', end: '2027-01-01' }),
      phase: 'execute',
      statusRaw: 'Execute',
      daysSinceUpdate: 5,
      updatedAt: '2026-08-01T00:00:00.000Z',
      description:
        'Deploy APMS to enable predictive maintenance capabilities, improving asset reliability and reducing unplanned downtime.',
    });

    expect(narrative.summarySource).toBe('jira-description');
    expect(narrative.executiveSummary).toContain('Deploy APMS');
  });

  it('carries SPOT accomplishments through even when using the description fallback', () => {
    const narrative = buildNarrative({
      risk: riskFor({ start: '2026-01-01', end: '2027-01-01' }),
      phase: 'execute',
      statusRaw: 'Execute',
      daysSinceUpdate: 5,
      updatedAt: '2026-08-01T00:00:00.000Z',
      spot: { recentAccomplishments: 'Survey scheduled', unmappedLabels: [] },
      description: 'Replace the end-of-life network assets across the site estate.',
    });

    expect(narrative.summarySource).toBe('jira-description');
    expect(narrative.recentAccomplishments).toBe('Survey scheduled');
  });

  it('generates a summary when neither SPOT nor a description exists', () => {
    const narrative = buildNarrative({
      risk: riskFor({ start: '2025-06-01', end: '2026-03-31' }),
      phase: 'execute',
      statusRaw: 'Execute',
      start: '2025-06-01',
      goLive: '2026-03-31',
      daysSinceUpdate: 5,
      updatedAt: '2026-08-01T00:00:00.000Z',
    });

    expect(narrative.summarySource).toBe('generated');
    expect(narrative.summaryBasis).toBeDefined();
    expect(narrative.executiveSummary.length).toBeGreaterThan(0);
  });

  it('always produces a non-empty summary', () => {
    // Worst case: nothing known at all.
    const narrative = buildNarrative({
      risk: riskFor({}),
      phase: 'demand',
      statusRaw: 'Demand',
      daysSinceUpdate: 0,
      updatedAt: '2026-08-05T00:00:00.000Z',
    });
    expect(narrative.executiveSummary.trim().length).toBeGreaterThan(0);
  });
});

describe('extractDescriptionExcerpt', () => {
  it('prefers the paragraph after an objective heading', () => {
    // The DDTJG description shape.
    const description = [
      '**Business Problem & Objective**',
      'Deploy APMS to enable predictive maintenance capabilities, improving asset reliability.',
      '**Scope (In/Out)**',
      '**In:** APMS deployment, asset connectivity.',
    ].join('\n\n');

    const excerpt = extractDescriptionExcerpt(description);
    expect(excerpt).toBe(
      'Deploy APMS to enable predictive maintenance capabilities, improving asset reliability.',
    );
  });

  it('skips a heading-only first paragraph', () => {
    const excerpt = extractDescriptionExcerpt('**Summary**\n\nActual prose describing the work.');
    expect(excerpt).toBe('Actual prose describing the work.');
  });

  it('strips markdown emphasis', () => {
    const excerpt = extractDescriptionExcerpt('**LPMS** is Takeda’s standard OEE monitoring platform.');
    expect(excerpt).toBe('LPMS is Takeda’s standard OEE monitoring platform.');
  });

  it('trims long text on a sentence boundary', () => {
    const long = `${'A'.repeat(150)}. ${'B'.repeat(200)}.`;
    const excerpt = extractDescriptionExcerpt(long)!;
    expect(excerpt.length).toBeLessThanOrEqual(241);
    expect(excerpt.endsWith('.')).toBe(true);
  });

  it('returns undefined for empty or whitespace input', () => {
    expect(extractDescriptionExcerpt(undefined)).toBeUndefined();
    expect(extractDescriptionExcerpt('')).toBeUndefined();
    expect(extractDescriptionExcerpt('   \n  ')).toBeUndefined();
  });
});

describe('generateSummary', () => {
  it('leads with the problem for an overdue project', () => {
    const risk = riskFor({ start: '2025-06-01', end: '2026-03-31' });
    const { text, basis } = generateSummary({
      risk,
      phase: 'execute',
      statusRaw: 'Execute',
      start: '2025-06-01',
      goLive: '2026-03-31',
      daysSinceUpdate: 5,
      updatedAt: '2026-08-01T00:00:00.000Z',
    });

    expect(text).toContain('Leadership Attention Required');
    expect(text).toContain('127 days overdue');
    expect(basis).toContain('risk.level=attention');
    expect(basis).toContain('primary reason=delayed-milestone');
  });

  it('states the schedule position for a healthy project', () => {
    const risk = riskFor({ start: '2026-06-30', end: '2028-04-01' });
    const { text } = generateSummary({
      risk,
      phase: 'execute',
      statusRaw: 'Execute',
      start: '2026-06-30',
      goLive: '2028-04-01',
      daysSinceUpdate: 5,
      updatedAt: '2026-08-01T00:00:00.000Z',
      childCount: { total: 14, done: 8 },
    });

    expect(text).toContain('On Track');
    expect(text).toContain('30 Jun 2026');
    expect(text).toContain('1 Apr 2028');
    expect(text).toContain('8 of 14 child items complete');
  });

  it('states missing data as a finding rather than omitting it', () => {
    const risk = riskFor({});
    const { text } = generateSummary({
      risk,
      phase: 'demand',
      statusRaw: 'Demand',
      daysSinceUpdate: 182,
      updatedAt: '2026-02-04T00:00:00.000Z',
    });

    expect(text).toContain('No Status Reported');
    expect(text).toContain('No start or go-live date recorded in Jira');
  });

  it('includes rollout context when the item belongs to an initiative', () => {
    const risk = riskFor({ start: '2026-01-01', end: '2027-01-01' });
    const { text } = generateSummary({
      risk,
      phase: 'execute',
      statusRaw: 'Execute',
      start: '2026-01-01',
      goLive: '2027-01-01',
      daysSinceUpdate: 5,
      updatedAt: '2026-08-01T00:00:00.000Z',
      initiativeSummary: 'CIM - Project Phoenix',
      initiativeSiteCount: 11,
    });

    expect(text).toContain('Part of CIM - Project Phoenix (11 sites)');
  });

  it('mentions staleness when it is not already a risk reason', () => {
    const risk = riskFor({ start: '2026-01-01', end: '2027-01-01', daysSinceUpdate: 70 });
    const { text } = generateSummary({
      risk,
      phase: 'execute',
      statusRaw: 'Execute',
      start: '2026-01-01',
      goLive: '2027-01-01',
      daysSinceUpdate: 70,
      updatedAt: '2026-05-27T00:00:00.000Z',
    });
    expect(text).toContain('Last updated in Jira 70 days ago');
  });

  it('does not repeat staleness when it is already the risk reason', () => {
    const risk = riskFor({ start: '2026-01-01', end: '2027-01-01', daysSinceUpdate: 120 });
    const { text } = generateSummary({
      risk,
      phase: 'execute',
      statusRaw: 'Execute',
      start: '2026-01-01',
      goLive: '2027-01-01',
      daysSinceUpdate: 120,
      updatedAt: '2026-04-07T00:00:00.000Z',
    });
    expect(text).toContain('No update in Jira for 120 days');
    expect(text).not.toContain('Last updated in Jira 120 days ago');
  });

  it('omits child progress for a completed project', () => {
    const risk = riskFor({ status: status('Done', 'complete', 'done'), end: '2026-01-01' });
    const { text } = generateSummary({
      risk,
      phase: 'complete',
      statusRaw: 'Done',
      goLive: '2026-01-01',
      daysSinceUpdate: 5,
      updatedAt: '2026-08-01T00:00:00.000Z',
      childCount: { total: 10, done: 10 },
    });
    expect(text).toContain('Complete');
    expect(text).not.toContain('10 of 10');
  });

  it('records every fact it used, so any sentence can be traced back', () => {
    const risk = riskFor({ start: '2025-06-01', end: '2026-03-31' });
    const { text, basis } = generateSummary({
      risk,
      phase: 'execute',
      statusRaw: 'Execute',
      start: '2025-06-01',
      goLive: '2026-03-31',
      daysSinceUpdate: 5,
      updatedAt: '2026-08-01T00:00:00.000Z',
      initiativeSummary: 'MES',
      childCount: { total: 4, done: 1 },
    });

    expect(basis.length).toBeGreaterThan(2);
    if (text.includes('MES')) expect(basis).toContain('initiative=MES');
    if (text.includes('1 of 4')) expect(basis).toContain('childCount=1/4');
  });

  it('never asserts a cause the data does not support', () => {
    const risk = riskFor({ start: '2025-06-01', end: '2026-03-31', daysSinceUpdate: 200 });
    const { text } = generateSummary({
      risk,
      phase: 'execute',
      statusRaw: 'Execute',
      start: '2025-06-01',
      goLive: '2026-03-31',
      daysSinceUpdate: 200,
      updatedAt: '2026-01-17T00:00:00.000Z',
    });

    for (const forbidden of ['resource', 'vendor', 'budget', 'scope creep', 'because of']) {
      expect(text.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('produces no double spaces or dangling punctuation', () => {
    const risk = riskFor({ start: '2026-01-01', end: '2027-01-01' });
    const { text } = generateSummary({
      risk,
      phase: 'execute',
      statusRaw: 'Execute',
      start: '2026-01-01',
      goLive: '2027-01-01',
      daysSinceUpdate: 5,
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(text).not.toMatch(/\s{2,}/);
    expect(text).not.toMatch(/\.\s*\./);
    expect(text.trim()).toBe(text);
  });
});
