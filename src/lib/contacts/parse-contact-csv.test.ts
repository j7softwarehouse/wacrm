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

describe('parseContactCsv — cabecalho em portugues', () => {
  // A lista real da escola (o motivo desta importacao existir) usa
  // cabecalho em portugues -- "Nome Salvo", "Telefone", "empresa".
  // So reconhecer o ingles deixaria o arquivo real inutilizavel sem
  // editar a planilha a mao.
  it('aceita "telefone" como sinonimo de "phone"', () => {
    const csv = 'Telefone,Nome\n553183886076,Ramon';
    const { rows } = parseContactCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].phone).toBe('553183886076');
    expect(rows[0].name).toBe('Ramon');
  });

  it('aceita "nome salvo" como sinonimo de "name" (cabecalho real de exportacao do WhatsApp)', () => {
    const csv = 'Telefone,Nome Salvo\n553189891123,Familia Silva';
    const { rows } = parseContactCsv(csv);
    expect(rows[0].name).toBe('Familia Silva');
  });

  it('aceita "empresa" como sinonimo de "company"', () => {
    const csv = 'phone,empresa\n553183886076,Instituto Emanuel';
    const { rows, hasCompanyColumn } = parseContactCsv(csv);
    expect(hasCompanyColumn).toBe(true);
    expect(rows[0].company).toBe('Instituto Emanuel');
  });

  it('devolve os cabecalhos encontrados quando nenhuma coluna de telefone bate', () => {
    // Mesmo cabecalho real da lista_emanuel.xlsx, sem nenhuma coluna
    // de telefone reconhecida (nem "phone" nem "telefone").
    const csv = 'Nome Salvo,email,empresa\nRamon,ramon@escola.com,Instituto';
    const result = parseContactCsv(csv);
    expect(result.rows).toEqual([]);
    expect(result.missingPhoneColumnHeaders).toEqual([
      'Nome Salvo',
      'email',
      'empresa',
    ]);
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
