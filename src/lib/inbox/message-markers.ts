// ============================================================
// Marcadores de mensagem — "onde eu parei" dentro de uma conversa.
// Ver docs/superpowers/specs/2026-09-16-marcadores-de-mensagem-design.md.
//
// Pure, unit-testable — sem I/O. As telas (chip no balão, painel
// "Marcadores (N)" no cabeçalho, aba "Meus marcadores" em
// Notificações) chamam estas funções sobre dados já buscados.
// ============================================================

/** Quem pode remover um marcador: quem marcou (o dono), quem atribuiu
 *  (se foi atribuído a outra pessoa), ou admin+. Mesma regra da
 *  política `message_markers_delete`. */
export function canRemoveMarker(
  marker: { created_by: string; assigned_by?: string | null },
  currentUserId: string,
  isAdmin: boolean,
): boolean {
  return (
    marker.created_by === currentUserId ||
    marker.assigned_by === currentUserId ||
    isAdmin
  );
}

/** Texto do chip no balão: "Financeiro · Paulo", ou só "Paulo" quando
 *  não há rótulo (ou é só espaços em branco). */
export function markerChipText(label: string | null | undefined, authorName: string): string {
  const trimmed = label?.trim();
  return trimmed ? `${trimmed} · ${authorName}` : authorName;
}

/** Um marcador já enriquecido com o necessário pra montar a lista
 *  "Meus marcadores" — a busca que monta isto faz o join com
 *  `conversations`/`contacts`/`messages`; esta função só agrupa. */
export interface MarkerWithContext {
  id: string;
  conversationId: string;
  messageId: string;
  label: string | null;
  createdAt: string;
  /** Nome de exibição da conversa (contato ou grupo). */
  contactName: string | null;
  /** Trecho da mensagem marcada, para dar contexto sem abrir a conversa. */
  messagePreview: string | null;
}

export interface MarkerGroup {
  conversationId: string;
  contactName: string | null;
  markers: MarkerWithContext[];
}

/**
 * Agrupa marcadores por conversa — a aba "Meus marcadores" mostra uma
 * entrada por conversa, com a lista de assuntos pendentes dentro dela.
 * Grupos ordenados pelo marcador mais recente primeiro; dentro do
 * grupo, marcadores também do mais recente pro mais antigo.
 */
export function groupMarkersByConversation(markers: MarkerWithContext[]): MarkerGroup[] {
  const byConversation = new Map<string, MarkerWithContext[]>();
  for (const marker of markers) {
    const list = byConversation.get(marker.conversationId);
    if (list) {
      list.push(marker);
    } else {
      byConversation.set(marker.conversationId, [marker]);
    }
  }

  const groups: MarkerGroup[] = Array.from(byConversation.entries()).map(
    ([conversationId, groupMarkers]) => {
      const sorted = [...groupMarkers].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      return {
        conversationId,
        contactName: sorted[0].contactName,
        markers: sorted,
      };
    },
  );

  groups.sort(
    (a, b) => new Date(b.markers[0].createdAt).getTime() - new Date(a.markers[0].createdAt).getTime(),
  );

  return groups;
}
