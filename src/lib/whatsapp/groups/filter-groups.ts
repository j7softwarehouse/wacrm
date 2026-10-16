/** Minúsculas + sem acento, para comparar (mesma regra da busca dentro
 *  da conversa: digitar "bale" precisa achar "Balé"). */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    // Marcas diacríticas combinantes (U+0300–U+036F) que o NFD separou.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Filtra a lista de grupos de Configurações > Grupos pelo nome. Busca
 * vazia devolve o MESMO array (sem trabalho nem re-render à toa); grupo
 * sem nome nunca casa com uma busca preenchida.
 */
export function filterGroupsByName<T extends { name: string | null }>(
  groups: T[],
  query: string,
): T[] {
  const needle = normalize(query.trim());
  if (!needle) return groups;
  return groups.filter((g) => !!g.name && normalize(g.name).includes(needle));
}
