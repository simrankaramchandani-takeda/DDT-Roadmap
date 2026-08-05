/**
 * Fixtures transcribed from REAL Jira payloads retrieved during discovery on
 * 2026-08-05, not invented. Field ids, issue type ids, hierarchy levels, status
 * ids, status categories and link directions are all as returned by the API.
 *
 * These exist so the pipeline can be verified without credentials, and so the two
 * failure modes that would silently break the roadmap stay covered:
 *
 *   1. DDTJG-86184 uses issue type "Digital Project", not "Epic".
 *   2. DDTHIK-38 links to its initiative in the OPPOSITE direction to DDTSG-55.
 */

import type { JiraIssue } from '@/lib/jira-client.js';

function project(id: string, key: string, name: string) {
  return { self: '', id, key, name, projectTypeKey: 'software', simplified: key !== 'DDTGMPORT' };
}

function user(accountId: string, displayName: string, emailAddress: string) {
  return { self: '', accountId, displayName, emailAddress, active: true, accountType: 'atlassian' };
}

function status(id: string, name: string, categoryKey: 'new' | 'indeterminate' | 'done') {
  const categoryId = categoryKey === 'new' ? 2 : categoryKey === 'indeterminate' ? 4 : 3;
  const categoryName = categoryKey === 'new' ? 'To Do' : categoryKey === 'indeterminate' ? 'In Progress' : 'Done';
  return {
    self: '',
    id,
    name,
    statusCategory: { self: '', id: categoryId, key: categoryKey, name: categoryName },
  };
}

/** `Polaris work item link`, id 10319 -- the Initiative <-> site relationship. */
const POLARIS_LINK_TYPE = {
  id: '10319',
  name: 'Polaris work item link',
  inward: 'is implemented by',
  outward: 'implements',
  self: '',
};

const EPIC_TYPE = (id: string, entityId?: string) => ({
  self: '',
  id,
  description: 'Epics track collections of related bugs, stories, and tasks.',
  name: 'Epic',
  subtask: false,
  hierarchyLevel: 1,
  ...(entityId ? { entityId } : {}),
});

// ---------------------------------------------------------------------------
// DDTGMPORT-27 -- Initiative (hierarchy level 2)
// Note: RAG lives in customfield_11199, whose name renders as "Asset ID".
// ---------------------------------------------------------------------------

export const DDTGMPORT_27: JiraIssue = {
  id: '18107626',
  key: 'DDTGMPORT-27',
  fields: {
    summary: 'CIM - Project Phoenix',
    issuetype: {
      self: '',
      id: '10269',
      description:
        'A significant solution development effort that captures a substantial investment within the portfolio.',
      name: 'Initiative',
      subtask: false,
      hierarchyLevel: 2,
    },
    project: project('21994', 'DDTGMPORT', 'DDT Global Manufacturing Portfolio'),
    status: status('10320', 'Execute', 'indeterminate'),
    description:
      "**Project Phoenix** is Takeda's **global network infrastructure transformation program** to modernize and replace end-of-life network assets by delivering a **resilient, secure, and future-ready Global Network Platform**, including SD-WAN, LAN and Wi-Fi upgrades, multi-cloud connectivity, and zero-trust security, enabling improved business continuity, digital enablement, and risk reduction across all sites",
    duedate: '2027-10-31',
    customfield_10412: '2024-09-02',
    customfield_11199: 'Green',
    customfield_10710: '1058159',
    customfield_10487: user('6093ee96a56f2f006f4d7cc9', 'Markus Grusch', 'markus.grusch@takeda.com'),
    labels: ['BC-055', 'BC-056', 'CIM', 'Next-Gen-Digital-Core'],
    assignee: null,
    updated: '2026-08-05T03:06:40.296-0500',
    issuelinks: [],
  },
};

// ---------------------------------------------------------------------------
// DDTSG-55 -- Singapore Phoenix rollout.
// The one item in the whole portfolio with a full SPOT narrative.
// Its portfolio counterpart appears as `outwardIssue`.
// ---------------------------------------------------------------------------

const DDTSG55_SPOT_ADF = {
  type: 'doc',
  version: 1,
  content: [
    {
      type: 'table',
      attrs: { isNumberColumnEnabled: false, layout: 'default' },
      content: [
        ['Project Phase', 'Execute'],
        ['Project State', 'Active'],
        [
          'Overall Status Description',
          'PMC endorsed 18Jun26\n\nLAN controller replacement is being planned in May-26\nNew access points will be delivered to this site in May-26\nHazmat rooms and the bridge AP implementation need onsite survey -> the survey is being scheduled\nThe target date of this project completion is being discussed',
        ],
        [
          'Recent Accomplishments',
          'our network device end of life dates are confirmed\nhigh level task sequence was confirmed',
        ],
        ['Next Priorities', 'LAN controller replacement\nNew AP delivery\nPMC presentation'],
      ].map(([label, value]) => ({
        type: 'tableRow',
        content: [label, value].map((text) => ({
          type: 'tableCell',
          attrs: {},
          content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
        })),
      })),
    },
  ],
};

export const DDTSG_55: JiraIssue = {
  id: '18268871',
  key: 'DDTSG-55',
  fields: {
    summary: 'Phoenix (Network Modernization)',
    issuetype: EPIC_TYPE('19568', '050d734c-6d98-42ab-b9db-d7e9a8431b7f'),
    project: project('20539', 'DDTSG', 'DDT Singapore'),
    status: status('19921', 'In Progress', 'indeterminate'),
    description: null,
    duedate: '2028-04-01',
    customfield_10412: '2026-06-30',
    customfield_24266: { self: '', value: 'Green', id: '30962' },
    customfield_24265: DDTSG55_SPOT_ADF,
    customfield_19886: '1062480',
    customfield_10467: 'dark_green',
    labels: [],
    assignee: user(
      '712020:38ef87fe-1181-4eb5-bbfa-9ab562abd015',
      'Ralph Andrew Calleja',
      'ralph-andrew.calleja@takeda.com',
    ),
    updated: '2026-07-27T01:45:41.890-0500',
    issuelinks: [
      {
        id: '1762156',
        type: POLARIS_LINK_TYPE,
        // The portfolio counterpart is OUTWARD here.
        outwardIssue: {
          id: '18107626',
          key: 'DDTGMPORT-27',
          fields: {
            summary: 'CIM - Project Phoenix',
            status: status('10320', 'Execute', 'indeterminate'),
          },
        },
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// DDTHIK-38 -- Hikari network work.
// Its portfolio counterpart appears as `inwardIssue`: the OPPOSITE direction to
// DDTSG-55. Honouring link direction would drop this relationship entirely.
// Summary is underscore-delimited, which broke the first regex implementation.
// ---------------------------------------------------------------------------

export const DDTHIK_38: JiraIssue = {
  id: '18190223',
  key: 'DDTHIK-38',
  fields: {
    summary: 'Hikari_Network Enhancement FY26_1060201 ',
    issuetype: EPIC_TYPE('21576', '1c7607a9-4b6c-4fa5-aefe-ca5e2072b413'),
    project: project('22472', 'DDTHIK', 'DDT Hikari'),
    status: status('22460', 'Initiate', 'indeterminate'),
    duedate: '2026-09-30',
    customfield_10412: '2026-04-01',
    labels: [],
    assignee: null,
    updated: '2026-06-15T00:00:00.000-0500',
    issuelinks: [
      {
        id: '1774737',
        type: POLARIS_LINK_TYPE,
        // Reversed relative to DDTSG-55.
        inwardIssue: {
          id: '18107626',
          key: 'DDTGMPORT-27',
          fields: {
            summary: 'CIM - Project Phoenix',
            status: status('10320', 'Execute', 'indeterminate'),
          },
        },
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// DDTGC-24 -- Grange Castle. Badly overdue, no authored status: the canonical
// "inferred attention" case. Summary carries a SPOT-<id> label.
// ---------------------------------------------------------------------------

export const DDTGC_24: JiraIssue = {
  id: '17613468',
  key: 'DDTGC-24',
  fields: {
    summary: 'TILGC - Shopfloor End of Life replacement Grange Castle- FY26 - SPOT-1059534',
    issuetype: EPIC_TYPE('18329', '3852093c-166c-4e97-b8c1-f0e0a29b7eff'),
    project: project('19191', 'DDTGC', 'DDT Grange Castle'),
    status: status('18571', 'Demand', 'new'),
    duedate: '2026-03-31',
    customfield_10412: '2025-06-01',
    labels: ['FY26'],
    assignee: null,
    updated: '2026-04-12T00:00:00.000-0500',
    issuelinks: [
      {
        id: '1731101',
        type: POLARIS_LINK_TYPE,
        inwardIssue: {
          id: '18107626',
          key: 'DDTGMPORT-27',
          fields: {
            summary: 'CIM - Project Phoenix',
            status: status('10320', 'Execute', 'indeterminate'),
          },
        },
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// DDTJG-86184 -- Jaguariuna.
// Issue type "Digital Project", NOT "Epic". Status name suffixed "- Epic".
// This is the regression case the hierarchy-level model exists for.
// ---------------------------------------------------------------------------

export const DDTJG_86184: JiraIssue = {
  id: '17642078',
  key: 'DDTJG-86184',
  fields: {
    summary: 'Digital Fluency, and upskilling workforce FY25',
    issuetype: {
      self: '',
      id: '12048',
      description: 'Use this as an umbrella to hold all tasks for a digital project ',
      name: 'Digital Project',
      subtask: false,
      hierarchyLevel: 1,
      entityId: '6352e070-43d4-4245-a6f9-9ff9e560b981',
    },
    project: project('12074', 'DDTJG', 'DD&T - Digital Jaguariúna'),
    status: status('20431', 'To Do - Epic', 'new'),
    description:
      '**Business Problem & Objective**  \nEnhance workforce digital fluency and upskill employees in FY25 to accelerate adoption of DD&T initiatives, strengthen digital capabilities, and support business transformation objectives.\n\n**Scope (In/Out)**  \n**In:** Digital skills training, learning programs, awareness campaigns, adoption initiatives, and capability-building activities aligned with the DD&T roadmap.',
    duedate: '2026-03-31',
    customfield_10412: '2025-04-01',
    labels: [],
    assignee: user('5e78e6483c888c0c298497d7', 'Daniel Bonesi', 'daniel.bonesi@takeda.com'),
    updated: '2026-07-30T00:00:00.000-0500',
    issuelinks: [],
  },
};

// ---------------------------------------------------------------------------
// DDTLESS-96 -- Lessines.
// Authored Health = Green (non-SPOT). Declared FY26. NO dates.
// Its Polaris links point OUTSIDE the portfolio (LESOPS-77, DDTLESS-159), so it
// must resolve as site-local, not as programme-aligned.
// ---------------------------------------------------------------------------

export const DDTLESS_96: JiraIssue = {
  id: '17594607',
  key: 'DDTLESS-96',
  fields: {
    summary: 'Suivi des Échantillons de Soumission',
    issuetype: EPIC_TYPE('14598', '5a85e439-76a5-4149-bba8-c317a302cb50'),
    project: project('14924', 'DDTLESS', 'DDT Lessines'),
    status: status('14925', 'Done', 'done'),
    description: null,
    duedate: null,
    customfield_10412: null,
    customfield_15784: { self: '', value: 'Green', id: '21574' },
    customfield_23746: { self: '', value: 'FY26', id: '30569' },
    customfield_16868: [user('5f030d28fe23000022e38f27', 'Philippe Moins', 'philippe.moins@takeda.com')],
    customfield_24406: 'Philippe Moins',
    labels: ['PowerBI'],
    assignee: user('5f030d28fe23000022e38f27', 'Philippe Moins', 'philippe.moins@takeda.com'),
    updated: '2026-07-17T04:12:13.029-0500',
    issuelinks: [
      {
        id: '1731894',
        type: POLARIS_LINK_TYPE,
        outwardIssue: {
          id: '18052931',
          key: 'LESOPS-77',
          fields: { summary: 'VSM', status: status('15655', 'In Progress', 'indeterminate') },
        },
      },
      {
        id: '1731895',
        type: POLARIS_LINK_TYPE,
        outwardIssue: {
          id: '18055333',
          key: 'DDTLESS-159',
          fields: {
            summary: 'VSM optimization : Cycle Time Fullfillment (CTFF)',
            status: status('14926', 'In progress', 'indeterminate'),
          },
        },
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// DDTLESS-133 -- "Will not do".
// Jira gives this statusCategory `done`, so a category-first implementation
// reports abandoned work as DELIVERED. Regression fixture for that bug.
// ---------------------------------------------------------------------------

export const DDTLESS_133: JiraIssue = {
  id: '17647669',
  key: 'DDTLESS-133',
  fields: {
    summary: 'Ecrans extérieurs pour Bornes DC',
    issuetype: EPIC_TYPE('14598', '5a85e439-76a5-4149-bba8-c317a302cb50'),
    project: project('14924', 'DDTLESS', 'DDT Lessines'),
    status: status('15910', 'Will not do', 'done'),
    duedate: '2026-06-30',
    customfield_10412: '2025-12-02',
    labels: ['FY26'],
    assignee: user('712020:42a9adc8-23ee-48dc-91b6-bada044ea5e2', 'Benny Boutry', 'benny.boutry@takeda.com'),
    updated: '2026-07-23T07:05:55.117-0500',
    issuelinks: [],
  },
};

// ---------------------------------------------------------------------------
// A level-0 Story: operational detail that must be excluded from the roadmap,
// but counted as a child of its parent.
// ---------------------------------------------------------------------------

export const DDTSG_CHILD_STORY: JiraIssue = {
  id: '18268999',
  key: 'DDTSG-56',
  fields: {
    summary: 'Order replacement access points',
    issuetype: {
      self: '',
      id: '19570',
      description: 'Stories track functionality or features expressed as user goals.',
      name: 'Story',
      subtask: false,
      hierarchyLevel: 0,
    },
    project: project('20539', 'DDTSG', 'DDT Singapore'),
    status: status('19925', 'Done', 'done'),
    parent: { id: '18268871', key: 'DDTSG-55' },
    duedate: null,
    labels: [],
    assignee: null,
    updated: '2026-07-01T00:00:00.000-0500',
    issuelinks: [],
  },
};

/** A subtask (level -1), which must also be excluded. */
export const DDTSG_SUBTASK: JiraIssue = {
  id: '18269000',
  key: 'DDTSG-57',
  fields: {
    summary: 'Raise purchase order',
    issuetype: { self: '', id: '19571', name: 'Subtask', subtask: true, hierarchyLevel: -1 },
    project: project('20539', 'DDTSG', 'DDT Singapore'),
    status: status('19925', 'Done', 'done'),
    duedate: null,
    labels: [],
    assignee: null,
    updated: '2026-07-01T00:00:00.000-0500',
    issuelinks: [],
  },
};

/** Everything a sync would return for this slice of the portfolio. */
export const ALL_FIXTURES: JiraIssue[] = [
  DDTGMPORT_27,
  DDTSG_55,
  DDTHIK_38,
  DDTGC_24,
  DDTJG_86184,
  DDTLESS_96,
  DDTLESS_133,
  DDTSG_CHILD_STORY,
  DDTSG_SUBTASK,
];
