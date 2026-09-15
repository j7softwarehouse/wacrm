// ============================================================
// Busca de texto DENTRO de uma conversa, no estilo do WhatsApp.
//
// Roda inteiramente no navegador porque a thread já carrega todas as
// mensagens da conversa de uma vez (ver o efeito de fetch em
// `message-thread.tsx`) — não há paginação para justificar uma consulta
// nova ao banco a cada tecla digitada.
//
// Comparação insensível a maiúsculas E a acentos: em português, digitar
// "curriculo" e não achar "currículo" é a diferença entre a busca
// parecer quebrada e parecer certa.
// ============================================================

import type { Message } from '@/types';

/** Minúsculas + sem acento, para comparar. Preserva o COMPRIMENTO em
 *  caracteres — `splitHighlight` depende disso para recortar o texto
 *  original pelos índices encontrados na versão normalizada. */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    // Marcas diacríticas combinantes (U+0300–U+036F) que o NFD separou.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Ids das mensagens que casam com a busca, na ordem em que aparecem.
 *
 * Mensagem apagada nunca casa: o `content_text` continua no banco
 * (apagar nunca o toca), mas a bolha mostra "Mensagem apagada" — achar
 * por um texto que ninguém consegue ler seria confuso.
 */
export function findMessageMatches(messages: Message[], query: string): string[] {
  const needle = normalize(query.trim());
  if (!needle) return [];

  return messages
    .filter((m) => {
      if (m.deleted_at) return false;
      const text = m.content_text;
      return !!text && normalize(text).includes(needle);
    })
    .map((m) => m.id);
}

export interface HighlightChunk {
  text: string;
  match: boolean;
}

/**
 * Reparte o texto em pedaços, marcando as ocorrências da busca, para a
 * bolha destacar o trecho encontrado sem perder o texto original (com
 * acentos e maiúsculas como foram escritos).
 */
export function splitHighlight(text: string, query: string): HighlightChunk[] {
  const needle = normalize(query.trim());
  if (!needle) return [{ text, match: false }];

  const haystack = normalize(text);
  const chunks: HighlightChunk[] = [];
  let cursor = 0;

  for (;;) {
    const at = haystack.indexOf(needle, cursor);
    if (at === -1) break;
    if (at > cursor) chunks.push({ text: text.slice(cursor, at), match: false });
    chunks.push({ text: text.slice(at, at + needle.length), match: true });
    cursor = at + needle.length;
  }

  if (cursor < text.length) chunks.push({ text: text.slice(cursor), match: false });
  return chunks.length > 0 ? chunks : [{ text, match: false }];
}
