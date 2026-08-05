/**
 * The fixture reproduces the ADF structure verified on DDTSG-55, including the
 * real multi-line status description text.
 */

import { describe, expect, it } from 'vitest';
import { parseSpotDescription } from '@/lib/adf.js';

function cell(text: string) {
  return {
    type: 'tableCell',
    attrs: {},
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

function row(label: string, value: unknown) {
  return { type: 'tableRow', content: [cell(label), value] };
}

const DDTSG55_STATUS_DESCRIPTION =
  'PMC endorsed 18Jun26\n\nLAN controller replacement is being planned in May-26\n' +
  'New access points will be delivered to this site in May-26\n' +
  'Hazmat rooms and the bridge AP implementation need onsite survey -> the survey is being scheduled\n' +
  'The target date of this project completion is being discussed';

const ddtsg55 = {
  type: 'doc',
  version: 1,
  content: [
    {
      type: 'table',
      attrs: { isNumberColumnEnabled: false, layout: 'default' },
      content: [
        row('Project Phase', cell('Execute')),
        row('Project State', cell('Active')),
        row('Project URL', {
          type: 'tableCell',
          attrs: {},
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
                      attrs: {
                        href: 'https://tospot.azurewebsites.net/project-hub/f278591a-86a1-420a-9f4f-26a1b17f962d',
                      },
                    },
                  ],
                },
              ],
            },
          ],
        }),
        row('Overall Status Description', cell(DDTSG55_STATUS_DESCRIPTION)),
        row(
          'Recent Accomplishments',
          cell('our network device end of life dates are confirmed\nhigh level task sequence was confirmed'),
        ),
        row('Next Priorities', cell('LAN controller replacement\nNew AP delivery\nPMC presentation')),
      ],
    },
  ],
};

describe('parseSpotDescription', () => {
  it('extracts every mapped row from the verified DDTSG-55 shape', () => {
    const result = parseSpotDescription(ddtsg55);

    expect(result).toBeDefined();
    expect(result!.phase).toBe('Execute');
    expect(result!.state).toBe('Active');
    expect(result!.sourceUrl).toContain('tospot.azurewebsites.net/project-hub/f278591a');
    expect(result!.recentAccomplishments).toContain('end of life dates are confirmed');
    expect(result!.nextPriorities).toContain('LAN controller replacement');
    expect(result!.unmappedLabels).toEqual([]);
  });

  it('preserves the "why" verbatim, including line breaks', () => {
    const result = parseSpotDescription(ddtsg55);
    expect(result!.statusDescription).toContain('PMC endorsed 18Jun26');
    expect(result!.statusDescription).toContain('The target date of this project completion is being discussed');
    // Line breaks separate distinct points a site is making and must survive.
    expect(result!.statusDescription!.split('\n').length).toBeGreaterThan(1);
  });

  it('matches labels loosely across casing and punctuation drift', () => {
    const drifted = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            row('overall status description:', cell('Amber because of a vendor delay')),
            row('PROJECT PHASE', cell('Plan')),
          ],
        },
      ],
    };
    const result = parseSpotDescription(drifted);
    expect(result!.statusDescription).toBe('Amber because of a vendor delay');
    expect(result!.phase).toBe('Plan');
  });

  it('records unmapped labels instead of dropping them silently', () => {
    const extra = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            row('Overall Status Description', cell('All good')),
            row('Some New SPOT Field', cell('value')),
          ],
        },
      ],
    };
    const result = parseSpotDescription(extra);
    expect(result!.statusDescription).toBe('All good');
    expect(result!.unmappedLabels).toEqual(['Some New SPOT Field']);
  });

  it('ignores placeholder values so an empty row is not treated as content', () => {
    const placeholders = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            row('Overall Status Description', cell('N/A')),
            row('Next Priorities', cell('TBD')),
            row('Recent Accomplishments', cell('-')),
            row('Project Phase', cell('Execute')),
          ],
        },
      ],
    };
    const result = parseSpotDescription(placeholders);
    expect(result!.statusDescription).toBeUndefined();
    expect(result!.nextPriorities).toBeUndefined();
    expect(result!.recentAccomplishments).toBeUndefined();
    expect(result!.phase).toBe('Execute');
  });

  it('finds a table nested inside other content', () => {
    const nested = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Intro' }] },
        { type: 'table', content: [row('Project Phase', cell('Closeout'))] },
      ],
    };
    expect(parseSpotDescription(nested)!.phase).toBe('Closeout');
  });

  it('returns undefined rather than throwing on absent or unexpected input', () => {
    // A shape change in the SPOT sync must degrade to "no narrative", never abort
    // a sync of 645 items.
    expect(parseSpotDescription(null)).toBeUndefined();
    expect(parseSpotDescription(undefined)).toBeUndefined();
    expect(parseSpotDescription('a plain string')).toBeUndefined();
    expect(parseSpotDescription({ type: 'doc', content: [] })).toBeUndefined();
    expect(parseSpotDescription({ type: 'doc', content: [{ type: 'paragraph' }] })).toBeUndefined();
    expect(parseSpotDescription({ nonsense: true })).toBeUndefined();
  });

  it('skips rows with fewer than two cells', () => {
    const malformed = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [cell('Orphan label')] },
            row('Project State', cell('Active')),
          ],
        },
      ],
    };
    expect(parseSpotDescription(malformed)!.state).toBe('Active');
  });
});
