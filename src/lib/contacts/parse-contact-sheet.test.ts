import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseContactSheet } from './parse-contact-sheet';

// Fixture .xlsx real (não montado a partir de outra lib de leitura, para
// não testar a biblioteca aprovada contra si mesma) — um zip minimo com as
// partes XML que o Excel grava (workbook, planilha, styles), gerado uma
// vez com `fflate` (dependência transitiva já aprovada) e commitado como
// binário. Ver `.superpowers/sdd/2026-07-31-adaptacao-escolar/
// task-6-report.md` para como foi gerado.
const FIXTURE_PATH = join(__dirname, '__fixtures__/contacts.xlsx');
// Fixture irmão: mesma origem (fflate), mas a coluna `phone` é gravada como
// célula NUMÉRICA (sem t="inlineStr"/t="s"), reproduzindo o que o Excel
// grava quando a coluna não está formatada como Texto — o caso que
// `cellToString` precisa tratar explicitamente (ver comentário na
// implementação sobre notação científica e zero à esquerda).
const FIXTURE_NUMERIC_PHONE_PATH = join(
  __dirname,
  '__fixtures__/contacts-phone-as-number.xlsx'
);

function loadXlsxFileFrom(path: string, name: string): File {
  const buffer = readFileSync(path);
  return new File([buffer], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function loadXlsxFile(name = 'contacts.xlsx'): File {
  return loadXlsxFileFrom(FIXTURE_PATH, name);
}

function csvFile(content: string, name = 'contacts.csv'): File {
  return new File([content], name, { type: 'text/csv' });
}

describe('parseContactSheet — .xlsx', () => {
  it('lê a planilha e preserva os acentos dos nomes', async () => {
    const { rows } = await parseContactSheet(loadXlsxFile());

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      phone: '553191234567',
      name: 'Angélica Nunes',
      email: 'angelica@escola.com.br',
      company: 'Instituto Emanuel',
    });
    expect(rows[1].name).toBe('Bárbara Souza');
  });

  it('detecta as colunas de tags e company do cabeçalho', async () => {
    const { rows, hasTagsColumn, hasCompanyColumn } = await parseContactSheet(
      loadXlsxFile()
    );

    expect(hasTagsColumn).toBe(true);
    expect(hasCompanyColumn).toBe(true);
    // A célula de tags usa ';' como separador — mesma convenção do CSV.
    expect(rows[0].tagNames).toEqual(['Responsável', '5º ano']);
    // Linha sem tags: coluna existe no cabeçalho, célula vazia.
    expect(rows[1].tagNames).toEqual([]);
  });

  it('detecta o tipo pela extensão, sem diferenciar maiúsculas/minúsculas', async () => {
    const { rows } = await parseContactSheet(loadXlsxFile('CONTATOS.XLSX'));
    expect(rows).toHaveLength(2);
  });

  it('lê telefone gravado como célula numérica (coluna phone sem formatar como Texto no Excel)', async () => {
    const file = loadXlsxFileFrom(
      FIXTURE_NUMERIC_PHONE_PATH,
      'contacts-phone-as-number.xlsx'
    );
    const { rows } = await parseContactSheet(file);

    expect(rows).toHaveLength(1);
    // 13 dígitos, dentro de Number.isSafeInteger — sem notação científica
    // e sem ".0" sobrando.
    expect(rows[0].phone).toBe('5531987654321');
    expect(rows[0].name).toBe('Débora Ramos');
  });
});

describe('parseContactSheet — .csv (delegação)', () => {
  it('delega para o parser de CSV já corrigido, inclusive separador ";" e BOM', async () => {
    const csv = '﻿phone;name\n553191234567;Cátia Lima';
    const { rows } = await parseContactSheet(csvFile(csv));

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Cátia Lima');
  });

  it('continua aceitando vírgula', async () => {
    const csv = 'phone,name\n553191234567,Cátia Lima';
    const { rows } = await parseContactSheet(csvFile(csv));

    expect(rows[0].name).toBe('Cátia Lima');
  });
});
