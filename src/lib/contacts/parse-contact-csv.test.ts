import { describe, expect, it } from 'vitest';
import { parseContactCsv, parseTagCell } from './parse-contact-csv';

describe('parseTagCell', () => {
  it('splits comma-separated tags and trims whitespace', () => {
    expect(parseTagCell(' VIP , Lead ,  ')).toEqual(['VIP', 'Lead']);
  });

  it('splits semicolon-separated tags', () => {
    expect(parseTagCell('VIP; Lead; Customer')).toEqual([
      'VIP',
      'Lead',
      'Customer',
    ]);
  });

  it('de-dupes case-insensitively', () => {
    expect(parseTagCell('vip, VIP, Lead')).toEqual(['vip', 'Lead']);
  });

  it('returns empty for blank values', () => {
    expect(parseTagCell('')).toEqual([]);
    expect(parseTagCell(undefined)).toEqual([]);
  });
});

describe('parseContactCsv', () => {
  it('parses optional tags column', () => {
    const csv = `phone,name,tags
+15551234567,Alice,"VIP, Lead"
+15559876543,Bob,Customer`;

    expect(parseContactCsv(csv)).toEqual({
      hasTagsColumn: true,
      hasCompanyColumn: false,
      rows: [
        {
          phone: '+15551234567',
          name: 'Alice',
          email: undefined,
          company: undefined,
          tagNames: ['VIP', 'Lead'],
        },
        {
          phone: '+15559876543',
          name: 'Bob',
          email: undefined,
          company: undefined,
          tagNames: ['Customer'],
        },
      ],
    });
  });

  it('returns empty tagNames when tags column is absent', () => {
    const csv = `phone,name
+15551234567,Alice`;

    expect(parseContactCsv(csv)).toEqual({
      hasTagsColumn: false,
      hasCompanyColumn: false,
      rows: [
        {
          phone: '+15551234567',
          name: 'Alice',
          email: undefined,
          company: undefined,
          tagNames: [],
        },
      ],
    });
  });
});

describe('parseContactCsv — compatibilidade com Excel pt-BR', () => {
  it('aceita ponto e virgula como separador', () => {
    // Excel em portugues salva CSV com ';'. Com split(',') o arquivo
    // virava uma coluna so e a importacao falhava inteira.
    const csv = 'phone;name\n553191234567;Angélica Nunes';
    const { rows } = parseContactCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].phone).toBe('553191234567');
    expect(rows[0].name).toBe('Angélica Nunes');
  });

  it('continua aceitando virgula', () => {
    const csv = 'phone,name\n553191234567,Angélica Nunes';
    const { rows } = parseContactCsv(csv);
    expect(rows[0].name).toBe('Angélica Nunes');
  });

  it('descarta o BOM que o Excel escreve no inicio do arquivo', () => {
    const csv = '﻿phone;name\n553191234567;Bárbara';
    const { rows } = parseContactCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Bárbara');
  });
});
