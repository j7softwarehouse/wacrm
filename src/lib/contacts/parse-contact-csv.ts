/**
 * CSV parsing for the contacts import modal. Shared + unit-tested so
 * tag-column handling stays aligned with phone/name/email/company.
 */

export interface ParsedContactRow {
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  /** Tag names from the optional `tags` column (comma/semicolon separated). */
  tagNames: string[];
}

/** Split a CSV cell into unique tag names (case-insensitive de-dupe). */
export function parseTagCell(value: string | undefined): string[] {
  if (!value?.trim()) return [];

  const seen = new Set<string>();
  const names: string[] = [];

  for (const part of value.split(/[,;]/)) {
    const name = part.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  return names;
}

export interface ParseContactCsvResult {
  rows: ParsedContactRow[];
  /** True when the CSV header includes a `tags` column. */
  hasTagsColumn: boolean;
  /** True when the CSV header includes a `company` column. */
  hasCompanyColumn: boolean;
  /**
   * Preenchido só quando nenhuma coluna de telefone reconhecida foi
   * encontrada — os cabeçalhos originais (sem lowercase) do arquivo,
   * para a tela explicar o que faltou em vez de só mostrar "0 linhas".
   */
  missingPhoneColumnHeaders?: string[];
}

/**
 * Cabeçalhos aceitos por coluna, em inglês e português. A lista real de
 * contatos que motivou a importação em XLSX usa cabeçalho em português
 * ("Telefone", "Nome", "empresa") — reconhecer só o inglês deixaria
 * esse arquivo real inutilizável sem editar a planilha à mão.
 */
export const COLUMN_ALIASES = {
  phone: ['phone', 'telefone'],
  // "nome salvo" é como o WhatsApp rotula o nome exportado dos
  // contatos salvos — é o cabeçalho real da lista da escola.
  name: ['name', 'nome', 'nome salvo'],
  email: ['email'],
  company: ['company', 'empresa'],
  tags: ['tags'],
} as const;

export function findColumnIndex(
  headers: string[],
  aliases: readonly string[],
): number {
  for (const alias of aliases) {
    const idx = headers.indexOf(alias);
    if (idx !== -1) return idx;
  }
  return -1;
}

export function parseContactCsv(text: string): ParseContactCsvResult {
  // O Excel em português salva CSV com ';' e prefixa BOM. Sem tratar os
  // dois, o arquivo vira uma coluna só e os acentos se perdem — a
  // importação falhava inteira e parecia erro do usuário.
  const clean = text.replace(/^﻿/, '');
  const lines = clean.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return { rows: [], hasTagsColumn: false, hasCompanyColumn: false };
  }

  // Vence o separador que produz mais colunas no cabeçalho.
  const delimiter =
    lines[0].split(';').length > lines[0].split(',').length ? ';' : ',';

  const rawHeaders = lines[0]
    .split(delimiter)
    .map((h) => h.trim().replace(/["']/g, ''));
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

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCsvLine(line, delimiter);
    const phone = values[phoneIdx]?.replace(/["']/g, '').trim();
    if (!phone) continue;

    rows.push({
      phone,
      name:
        nameIdx >= 0
          ? values[nameIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      email:
        emailIdx >= 0
          ? values[emailIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      company:
        companyIdx >= 0
          ? values[companyIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      tagNames:
        tagsIdx >= 0 ? parseTagCell(values[tagsIdx]?.replace(/["']/g, '')) : [],
    });
  }

  return {
    rows,
    hasTagsColumn: tagsIdx >= 0,
    hasCompanyColumn: companyIdx >= 0,
  };
}

/** Simple CSV line parse (handles quoted fields). */
function parseCsvLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}
