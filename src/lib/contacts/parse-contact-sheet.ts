/**
 * Detecta se o arquivo do import de contatos é uma planilha `.xlsx` ou um
 * `.csv` e devolve o mesmo formato de resultado nos dois casos (`rows` +
 * `hasTagsColumn` + `hasCompanyColumn`), para o modal de importação não
 * precisar tratar os dois formatos de jeitos diferentes.
 *
 * O modal roda inteiramente no navegador ('use client'), por isso a leitura
 * do `.xlsx` usa a build "browser" da `read-excel-file` — ela lê o `File`
 * direto via `Blob.arrayBuffer()`, sem precisar de Node/Buffer nem de
 * mandar o arquivo pro servidor só para poder pré-visualizá-lo.
 *
 * Biblioteca escolhida (aprovada pelo usuário) depois de levantar
 * alternativas: ver `.superpowers/sdd/2026-07-31-adaptacao-escolar/
 * task-6-xlsx-library-options.md`. O pacote `xlsx` (SheetJS) do npm foi
 * descartado por estar abandonado nesse registro e ter CVEs conhecidos sem
 * correção nessa versão.
 */
import { readSheet, type Row } from 'read-excel-file/browser';
import {
  COLUMN_ALIASES,
  findColumnIndex,
  parseContactCsv,
  parseTagCell,
  type ParseContactCsvResult,
  type ParsedContactRow,
} from './parse-contact-csv';

export type {
  ParsedContactRow,
  ParseContactCsvResult,
} from './parse-contact-csv';

function isXlsxFile(file: File): boolean {
  return /\.xlsx$/i.test(file.name);
}

/**
 * Normaliza uma célula da planilha para string, do mesmo jeito que o parser
 * de CSV já entrega os valores (string "crua", sem aspas nem formatação).
 */
function cellToString(value: Row[number]): string {
  if (value === null || value === undefined) return '';
  // Célula que o Excel formatou como data — não esperado nas colunas de
  // contato, mas convertida para não virar "[object Date]" na tela.
  if (value instanceof Date) return value.toISOString();

  if (typeof value === 'number') {
    // Quando a coluna (a mais comum é `phone`, a única obrigatória) não
    // está formatada como Texto no Excel — o padrão quando alguém só
    // digita os dígitos, exatamente o que uma secretária preenchendo
    // telefone sem configurar a coluna faria —, a read-excel-file devolve
    // a célula como `number`, não `string`.
    //
    // IMPORTANTE — zero à esquerda: se o Excel já gravou o telefone como
    // número, um eventual zero à esquerda (comum em alguns formatos, ex.
    // DDD começando com 0) já foi perdido pelo próprio Excel antes de
    // chegar aqui — não tem como recuperar isso no parser. É uma
    // limitação de como o Excel grava número vs. texto, não um bug deste
    // código; a mitigação de verdade é formatar a coluna como Texto antes
    // de digitar o telefone.

    // Notação científica do `String()` só aparece para magnitude >= 1e21
    // — nenhum telefone real chega perto disso —, então um inteiro não
    // precisa de tratamento especial: `value.toString(10)` já é exato,
    // sem exponencial e sem ".0" sobrando.
    if (Number.isInteger(value)) {
      return value.toString(10);
    }

    // Não é inteiro: a célula tem casas decimais espúrias — acontece
    // quando o valor veio colado de uma fórmula, ou a coluna está
    // formatada como número genérico, mesmo contendo o que deveria ser
    // um telefone inteiro (ex.: 551198765.4321). Telefone não tem casas
    // decimais, então qualquer resto fracionário é artefato de
    // formatação do Excel, não dígito significativo — truncar e manter
    // só a parte inteira é mais seguro do que deixar o "." vazar pro
    // campo `phone` (`String(551198765.4321)` daria
    // `"551198765.4321"` sem truncar).
    return Math.trunc(value).toString(10);
  }

  return String(value).trim();
}

/** Mesma lógica de mapeamento de colunas do parser de CSV, mas lendo linhas
 * de planilha (`Row[]`, já tipadas pela read-excel-file) em vez de texto. */
function parseXlsxRows(sheet: Row[]): ParseContactCsvResult {
  if (sheet.length < 2) {
    return { rows: [], hasTagsColumn: false, hasCompanyColumn: false };
  }

  const rawHeaders = sheet[0].map((cell) => cellToString(cell));
  const headers = rawHeaders.map((h) => h.toLowerCase());

  const phoneIdx = findColumnIndex(headers, COLUMN_ALIASES.phone);
  if (phoneIdx === -1) {
    return {
      rows: [],
      hasTagsColumn: false,
      hasCompanyColumn: false,
      missingPhoneColumnHeaders: rawHeaders,
    };
  }

  const nameIdx = findColumnIndex(headers, COLUMN_ALIASES.name);
  const emailIdx = findColumnIndex(headers, COLUMN_ALIASES.email);
  const companyIdx = findColumnIndex(headers, COLUMN_ALIASES.company);
  const tagsIdx = findColumnIndex(headers, COLUMN_ALIASES.tags);

  const rows: ParsedContactRow[] = [];

  for (let i = 1; i < sheet.length; i++) {
    const line = sheet[i];
    const phone = cellToString(line[phoneIdx]);
    if (!phone) continue;

    rows.push({
      phone,
      name:
        nameIdx >= 0 ? cellToString(line[nameIdx]) || undefined : undefined,
      email:
        emailIdx >= 0 ? cellToString(line[emailIdx]) || undefined : undefined,
      company:
        companyIdx >= 0
          ? cellToString(line[companyIdx]) || undefined
          : undefined,
      tagNames: tagsIdx >= 0 ? parseTagCell(cellToString(line[tagsIdx])) : [],
    });
  }

  return {
    rows,
    hasTagsColumn: tagsIdx >= 0,
    hasCompanyColumn: companyIdx >= 0,
  };
}

/**
 * Lê o arquivo de importação de contatos, aceitando tanto `.xlsx` quanto
 * `.csv`. O tipo é detectado pela extensão do nome do arquivo — o mesmo
 * critério usado no `accept` do input de upload no modal.
 */
export async function parseContactSheet(
  file: File
): Promise<ParseContactCsvResult> {
  if (isXlsxFile(file)) {
    const sheet = await readSheet(file);
    return parseXlsxRows(sheet);
  }

  // .csv (ou qualquer outra extensão que passe pelo filtro do input) cai no
  // parser já corrigido para separador ';' e BOM do Excel pt-BR.
  const text = await file.text();
  return parseContactCsv(text);
}
