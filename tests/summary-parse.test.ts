/**
 * Fixtures are real summary strings read off the reference screenshots and
 * discovery samples -- not invented examples.
 */

import { describe, expect, it } from 'vitest';
import {
  extractFunctionCode,
  extractFyTag,
  extractSitePrefix,
  extractSpotId,
  parseSummary,
} from '@/lib/summary-parse.js';

describe('extractSpotId', () => {
  it('reads a leading id', () => {
    expect(extractSpotId('1030954 - MBO - AUTO - PI EG & Batch Context & PI Vision')).toBe('1030954');
  });

  it('reads a labelled trailing id', () => {
    expect(extractSpotId('TO MES Elaprase DS - SPOT 1024096')).toBe('1024096');
  });

  it('reads a hyphenated SPOT label', () => {
    expect(
      extractSpotId('TILGC - Remediation of Satellite Communications Cabinets - SPOT-1044760'),
    ).toBe('1044760');
  });

  it('reads a bare trailing id', () => {
    expect(extractSpotId('W34 - Decommissioning Historian IP.21 - 1032397')).toBe('1032397');
    expect(extractSpotId('TO Project Phoenix - 1056412')).toBe('1056412');
  });

  it('reads an underscore-delimited id', () => {
    expect(extractSpotId('Hikari_Network Enhancement FY26_1060201')).toBe('1060201');
  });

  it('returns undefined when there is no id', () => {
    expect(extractSpotId('SIMCA Local Server to Global Server Migration')).toBeUndefined();
    expect(extractSpotId('MBO CIM - NinjaOne Rollout (Tanium Replacement)')).toBeUndefined();
  });

  it('does not mistake equipment or version numbers for ids', () => {
    expect(extractSpotId('PPQ Runs for Bioreactors BRX-2300')).toBeUndefined();
    expect(extractSpotId('EBM Instance 1 V6.0 upgrade')).toBeUndefined();
    expect(extractSpotId('Decommissioning Historian IP.21')).toBeUndefined();
  });

  it('prefers a labelled id over a bare number elsewhere in the string', () => {
    expect(extractSpotId('1099999 project - SPOT 1024096')).toBe('1024096');
  });
});

describe('extractFyTag', () => {
  it('reads a bracketed tag', () => {
    expect(extractFyTag('1059740 - [FY26] - MBO - AUTO - Metasys capital improvements')).toBe('FY26');
    expect(extractFyTag('1059739 - [FY25] - 200SW - AUTO - Cell Bank')).toBe('FY25');
  });

  it('reads an unbracketed tag', () => {
    expect(extractFyTag('Hikari_Network Enhancement FY26_1060201')).toBe('FY26');
  });

  it('normalises a four-digit year', () => {
    expect(extractFyTag('Mise en cybercompliance FY2027')).toBe('FY27');
  });

  it('takes the first year of a range', () => {
    expect(extractFyTag('1058692 - MA Bio Ops Intelligent Automation FY2025-2026')).toBe('FY25');
  });

  it('returns undefined when absent', () => {
    expect(extractFyTag('TO Project Phoenix - 1056412')).toBeUndefined();
  });
});

describe('extractFunctionCode', () => {
  it('reads a delimited code', () => {
    expect(extractFunctionCode('1030954 - MBO - AUTO - PI EG & Batch Context')).toBe('AUTO');
    expect(extractFunctionCode('1053262 - 300SW - QUAL - SmartQC')).toBe('QUAL');
    expect(extractFunctionCode('1052161 - MBO - AGILE - Digital Tier Boards')).toBe('AGILE');
    expect(extractFunctionCode('1054576 - 400SW - DDT - Knowledge Management at MBO')).toBe('DDT');
  });

  it('reads a bracketed code', () => {
    expect(extractFunctionCode('1059652 - [OPEX] - WOF - Warehouse of the Future')).toBe('OPEX');
  });

  it('reads a mixed-case code', () => {
    expect(
      extractFunctionCode('1062568 - MBO TxN - MSci - Northstar Implementation'),
    ).toBe('MSci');
  });

  it('returns undefined for strings with no code segment', () => {
    expect(extractFunctionCode('SIMCA Local Server to Global Server Migration')).toBeUndefined();
  });

  it('does not invent codes from arbitrary uppercase tokens', () => {
    expect(extractFunctionCode('Osaka-New LP building all IT scope')).toBeUndefined();
    expect(extractFunctionCode('TO SAP Enhancement for Elaprase')).toBeUndefined();
  });
});

describe('extractSitePrefix', () => {
  it('reads known prefixes', () => {
    expect(extractSitePrefix('TO MES Elaprase DS - SPOT 1024096')).toBe('TO');
    expect(extractSitePrefix('TILGC - MES - MBR Migration')).toBe('TILGC');
    expect(extractSitePrefix('IE BRAY Siemens MES Upgrade')).toBe('IE BRAY');
    expect(extractSitePrefix('BP MES Platform Upgrade')).toBe('BP');
  });

  it('requires a boundary so it does not match inside a word', () => {
    expect(extractSitePrefix('TOOLING refresh')).toBeUndefined();
    expect(extractSitePrefix('BPMS integration')).toBeUndefined();
  });
});

describe('parseSummary', () => {
  it('strips a full taxonomy down to a readable title', () => {
    const parsed = parseSummary(
      '1059740 - [FY26] - MBO - AUTO - Metasys capital improvements and architecture',
    );
    expect(parsed.spotId).toBe('1059740');
    expect(parsed.fyTag).toBe('FY26');
    expect(parsed.functionCode).toBe('AUTO');
    expect(parsed.cleanTitle).toBe('MBO - Metasys capital improvements and architecture');
  });

  it('strips a trailing SPOT label', () => {
    const parsed = parseSummary('TO MES Elaprase DS - SPOT 1024096');
    expect(parsed.spotId).toBe('1024096');
    expect(parsed.cleanTitle).toBe('TO MES Elaprase DS');
  });

  it('leaves a summary with no taxonomy untouched', () => {
    const raw = 'SIMCA Local Server to Global Server Migration';
    const parsed = parseSummary(raw);
    expect(parsed.spotId).toBeUndefined();
    expect(parsed.fyTag).toBeUndefined();
    expect(parsed.cleanTitle).toBe(raw);
    expect(parsed.raw).toBe(raw);
  });

  it('handles an underscore-delimited summary', () => {
    const parsed = parseSummary('Hikari_Network Enhancement FY26_1060201');
    expect(parsed.spotId).toBe('1060201');
    expect(parsed.fyTag).toBe('FY26');
    expect(parsed.cleanTitle).toBe('Hikari_Network Enhancement');
  });

  it('strips capacity codes', () => {
    const parsed = parseSummary('1053262 - 300SW - QUAL - SmartQC');
    expect(parsed.cleanTitle).toBe('SmartQC');
  });

  it('never produces an empty title, even from a metadata-only summary', () => {
    const raw = '1030954 - [FY26] - AUTO';
    const parsed = parseSummary(raw);
    expect(parsed.cleanTitle.length).toBeGreaterThan(0);
    expect(parsed.raw).toBe(raw);
  });

  it('always retains the raw summary', () => {
    const raw = '1062516 - MBO TxN - OSP - Fast-Track OpsTrakker Deployment';
    expect(parseSummary(raw).raw).toBe(raw);
  });

  it('handles non-English summaries without mangling them', () => {
    // DDTLESS and DDTSNG carry French and German summaries.
    const fr = parseSummary('Mise en cybercompliance systemes DD&T 2027');
    expect(fr.cleanTitle).toBe('Mise en cybercompliance systemes DD&T 2027');

    const de = parseSummary('SIN- Video Uberwachung - Update und Ausbau  - 1054415');
    expect(de.spotId).toBe('1054415');
    expect(de.cleanTitle).toContain('Video');
  });

  it('tolerates an empty summary', () => {
    const parsed = parseSummary('');
    expect(parsed.raw).toBe('');
    expect(parsed.cleanTitle).toBe('');
  });
});
