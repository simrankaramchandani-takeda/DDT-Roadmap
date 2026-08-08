/**
 * The SPOT narrative through its second transport.
 *
 * Feed #3 returns the SPOT table as Jira wiki markup where REST returns ADF. The
 * narrative is the single most valuable content in the dataset -- the only place a
 * site explains WHY a project is amber or red, present on 299 of 510 items -- so a
 * parser that silently returned nothing would drop 59% of the explanations and the
 * coverage page would report the loss as a finding about the sites rather than a gap
 * in the adapter.
 *
 * The equivalence test at the bottom is the one that matters most: the two transports
 * must produce byte-identical narratives, or the Phase C snapshot diff fills with
 * whitespace noise and a real divergence hides inside it.
 */

import { describe, expect, it } from 'vitest';

import { parseSpotWikiTable } from '@/lib/spot-wiki.js';
import { parseSpotDescription } from '@/lib/adf.js';
import { FIXTURE_SPOT_WIKI } from '@/fixtures/feed3.fixture.js';

const EXPECTED_DESCRIPTION =
  '27/07/2026:\n-confirming next waves with MAN Ops\n\n21/05/2026:\nThe Automation folder was migrated to SharePoint';

describe('parseSpotWikiTable', () => {
  it('reads every mapped row from a real feed value', () => {
    const parsed = parseSpotWikiTable(FIXTURE_SPOT_WIKI);

    expect(parsed).toBeDefined();
    expect(parsed!.phase).toBe('Execute');
    expect(parsed!.state).toBe('Active');
    expect(parsed!.recentAccomplishments).toBe('Pilot migration wave is complete');
    expect(parsed!.nextPriorities).toBe('MAN Ops P1, Engineering folder would be next');
    expect(parsed!.unmappedLabels).toEqual([]);
  });

  it('keeps the line structure of a multi-line, date-separated description', () => {
    // The dates separate distinct updates a site made. Collapsing them would run two
    // unrelated statements together and read as one incoherent sentence.
    expect(parseSpotWikiTable(FIXTURE_SPOT_WIKI)!.statusDescription).toBe(EXPECTED_DESCRIPTION);
  });

  it('survives a value containing internal pipes', () => {
    // The Project URL row is `[Project URL|https://...]` -- a pipe inside a value, in
    // a pipe-delimited format. Line-based splitting gets this wrong.
    expect(parseSpotWikiTable(FIXTURE_SPOT_WIKI)!.sourceUrl).toBe(
      'https://tospot.azurewebsites.net/project-hub?projectId=8260112',
    );
  });

  it('renders a link in a prose row as its display text', () => {
    const parsed = parseSpotWikiTable('|Next Priorities|See [the plan|https://example.invalid/plan] first|');
    expect(parsed!.nextPriorities).toBe('See the plan first');
  });

  it('rejects placeholder values so an empty row cannot count as coverage', () => {
    const parsed = parseSpotWikiTable(
      ['|Project Phase|Execute|', '|Overall Status Description|N/A|', '|Next Priorities|-|'].join('\n'),
    );
    expect(parsed!.phase).toBe('Execute');
    expect(parsed!.statusDescription).toBeUndefined();
    expect(parsed!.nextPriorities).toBeUndefined();
  });

  it('collects an unmapped label rather than dropping it', () => {
    const parsed = parseSpotWikiTable(['|Project Phase|Execute|', '|Steerco Decision|Approved|'].join('\n'));
    expect(parsed!.unmappedLabels).toEqual(['Steerco Decision']);
  });

  it('matches labels loosely, so punctuation drift does not lose content', () => {
    expect(parseSpotWikiTable('|Overall Status Description:|Amber because of vendor delay|')!.statusDescription).toBe(
      'Amber because of vendor delay',
    );
  });

  it('returns undefined rather than throwing on anything that is not a table', () => {
    for (const input of [undefined, null, 42, {}, [], '', 'just some prose', '|||']) {
      expect(() => parseSpotWikiTable(input)).not.toThrow();
      expect(parseSpotWikiTable(input)).toBeUndefined();
    }
  });

  it('degrades a malformed table to whatever it can read, never an exception', () => {
    // A SPOT format change must cost one field on one item, not abort a run of 1371.
    const malformed = '|Project Phase|Execute|\n|Overall Status Description|unterminated row';
    expect(() => parseSpotWikiTable(malformed)).not.toThrow();
    expect(parseSpotWikiTable(malformed)!.phase).toBe('Execute');
  });
});

describe('parseSpotDescription dispatch', () => {
  it('routes a wiki-markup string to the wiki parser', () => {
    // The dispatcher is what keeps `transform.ts` source-agnostic: it never learns
    // which transport delivered the field.
    expect(parseSpotDescription(FIXTURE_SPOT_WIKI)).toEqual(parseSpotWikiTable(FIXTURE_SPOT_WIKI));
  });

  it('still returns undefined for a string that is not a table', () => {
    expect(parseSpotDescription('no table here')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Equivalence
// ---------------------------------------------------------------------------

function text(value: string): { type: 'text'; text: string } {
  return { type: 'text', text: value };
}

const HARD_BREAK = { type: 'hardBreak' };

/** The same SPOT table as FIXTURE_SPOT_WIKI, in the ADF that Jira REST returns. */
const ADF_EQUIVALENT = {
  type: 'doc',
  content: [
    {
      type: 'table',
      content: [
        row('Project Phase', [text('Execute')]),
        row('Project State', [text('Active')]),
        {
          type: 'tableRow',
          content: [
            cell([text('Project URL')]),
            {
              type: 'tableCell',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: 'Project URL',
                      marks: [
                        {
                          type: 'link',
                          attrs: { href: 'https://tospot.azurewebsites.net/project-hub?projectId=8260112' },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        row('Overall Status Description', [
          text('27/07/2026:'),
          HARD_BREAK,
          text('-confirming next waves with MAN Ops'),
          HARD_BREAK,
          HARD_BREAK,
          text('21/05/2026:'),
          HARD_BREAK,
          text('The Automation folder was migrated to SharePoint'),
        ]),
        row('Recent Accomplishments', [text('Pilot migration wave is complete')]),
        row('Next Priorities', [text('MAN Ops P1, Engineering folder would be next')]),
      ],
    },
  ],
};

function cell(content: unknown[]): unknown {
  return { type: 'tableCell', content: [{ type: 'paragraph', content }] };
}

function row(label: string, value: unknown[]): unknown {
  return { type: 'tableRow', content: [cell([text(label)]), cell(value)] };
}

describe('ADF and wiki equivalence', () => {
  it('produces identical narratives for the same underlying table', () => {
    // Anything less than identical shows up as noise in the REST-vs-feed snapshot diff
    // and masks the divergences that gate actually exists to catch.
    expect(parseSpotWikiTable(FIXTURE_SPOT_WIKI)).toEqual(parseSpotDescription(ADF_EQUIVALENT));
  });

  it('agrees on the multi-line description down to the whitespace', () => {
    expect(parseSpotDescription(ADF_EQUIVALENT)!.statusDescription).toBe(EXPECTED_DESCRIPTION);
  });
});
