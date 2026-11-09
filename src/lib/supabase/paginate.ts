/**
 * Leitura completa de tabelas pelo PostgREST, sem o corte silencioso.
 *
 * O PostgREST devolve no máximo `max_rows` linhas por resposta (1000 por
 * padrão). Uma consulta sem `range` que passa desse limite perde linhas em
 * silêncio, sem erro. Por isso toda leitura que precisa ser completa
 * (audiência de Broadcast, lista da Inbox, destinatários) passa por aqui.
 *
 * Regras:
 * - A ordenação precisa ser estável: use `.order('id')` (chave primária)
 *   ou outra coluna imutável. Ordenar por campo que muda (ex.:
 *   last_message_at) faz linhas se repetirem ou sumirem entre páginas.
 * - O avanço usa o tamanho REAL da página devolvida, não o pedido. Assim
 *   funciona mesmo que o servidor corte abaixo de 1000.
 * - Para só quando uma página vem vazia.
 */

/** Tamanho pedido por página. */
export const PAGE_SIZE = 1000;

/** Trava: 200 páginas = 200 mil linhas. Acima disso é erro, nunca lista parcial. */
export const MAX_PAGES = 200;

export class PaginationLimitError extends Error {
  constructor() {
    super(
      `A leitura excedeu ${MAX_PAGES} páginas e foi interrompida para não usar uma lista parcial.`,
    );
    this.name = 'PaginationLimitError';
  }
}

/**
 * Lê todas as linhas de uma consulta paginada por `range`.
 *
 * `fetchPage(from, to)` recebe índices inclusivos. Devolve `{ data, error }`.
 * Erro de consulta volta como `{ data: null, error }` (nunca lista parcial).
 * Estourar o teto de páginas lança `PaginationLimitError`.
 */
export async function fetchAllPages<T, E = unknown>(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: E | null }>,
  pageSize: number = PAGE_SIZE,
): Promise<{ data: T[] | null; error: E | null }> {
  const all: T[] = [];
  let from = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) return { data: null, error };
    const rows = data ?? [];
    if (rows.length === 0) return { data: all, error: null };
    all.push(...rows);
    from += rows.length;
  }
  throw new PaginationLimitError();
}

/**
 * Consulta com lista de ids (`.in(coluna, ids)`), quebrada em lotes para não
 * estourar o tamanho da URL. Cada lote é lido por inteiro com `fetchAllPages`
 * se a função chamadora precisar.
 */
export async function fetchInChunks<I, R>(
  ids: I[],
  chunkSize: number,
  fetchChunk: (slice: I[]) => Promise<R[]>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    out.push(...(await fetchChunk(ids.slice(i, i + chunkSize))));
  }
  return out;
}
