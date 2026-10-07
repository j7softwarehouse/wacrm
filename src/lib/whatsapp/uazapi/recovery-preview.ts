// ============================================================
// Prévia (somente leitura) de mensagens perdidas durante a queda de
// produção em 2026-10-07 — a Vercel bloqueou o projeto (402
// DEPLOYMENT_DISABLED) e o webhook da UAZAPI não teve pra onde
// entregar eventos nesse intervalo.
//
// NUNCA grava nada: só consulta `/chat/find` + `/message/find` da
// UAZAPI (que guarda seu próprio histórico, independente do nosso
// webhook) e devolve uma contagem. A decisão de ingerir de verdade
// fica pra uma etapa separada, só depois de alguém revisar este
// resultado.
//
// Varre por `/chat/find` ordenado por `-wa_lastMsgTimestamp` (mais
// recente primeiro) e para assim que um chat tem a última mensagem
// mais antiga que o início da janela — não existe sintaxe de filtro
// por timestamp confirmada ao vivo pra esse endpoint, então preferimos
// paginar e cortar no cliente a arriscar um filtro mal formado que
// devolveria silenciosamente zero resultados.
// ============================================================

export interface RecoveryWindow {
  /** Início da janela, epoch em milissegundos (inclusive). */
  sinceMs: number;
  /** Fim da janela, epoch em milissegundos (inclusive). */
  untilMs: number;
}

export interface ChatRecoverySummary {
  chatid: string;
  isGroup: boolean;
  count: number;
  messageIds: string[];
}

export interface RecoveryPreviewResult {
  chatsScanned: number;
  chatsWithMessages: number;
  totalMessages: number;
  byChat: ChatRecoverySummary[];
  /** true quando algum limite de paginação foi atingido — o resultado
   *  pode estar incompleto e a janela merece ser revisada em partes
   *  menores. */
  truncated: boolean;
}

interface UazapiChatRow {
  wa_chatid?: string;
  wa_isGroup?: boolean;
  wa_lastMsgTimestamp?: number;
}

interface ChatFindResponse {
  chats?: UazapiChatRow[];
}

interface UazapiMessageRow {
  messageid?: string;
  id?: string;
  messageTimestamp?: number;
  wasSentByApi?: boolean;
}

interface MessageFindResponse {
  messages?: UazapiMessageRow[];
}

export type ReadOnlyUazapiClient = { post<T>(path: string, body: unknown): Promise<T> };

const CHAT_PAGE_SIZE = 50;
const MAX_CHAT_PAGES = 10;
const MESSAGE_PAGE_SIZE = 100;
const MAX_MESSAGE_PAGES_PER_CHAT = 5;
/** Quantos chats consultamos em paralelo. Uma conta com centenas de
 *  conversas ativas no dia estouraria o tempo da função rodando uma
 *  chamada de cada vez — isto é I/O (espera de rede), não CPU, então
 *  paralelizar é seguro; o limite existe só pra não martelar a UAZAPI
 *  com dezenas de requisições simultâneas de uma vez. */
const CHAT_CONCURRENCY = 8;

/** Roda `fn` sobre `items` com no máximo `limit` chamadas em voo ao
 *  mesmo tempo, preservando a ordem do resultado. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** A UAZAPI já foi vista mandando timestamp em segundos OU em
 *  milissegundos (ver normalize.ts) — mesma heurística: acima de
 *  1e12 só pode ser milissegundos. */
function toMs(raw: number | undefined): number {
  if (!raw) return 0;
  return raw > 1e12 ? raw : raw * 1000;
}

async function collectMessagesInWindow(
  client: ReadOnlyUazapiClient,
  chatid: string,
  window: RecoveryWindow,
): Promise<{ ids: string[]; truncated: boolean }> {
  const ids: string[] = [];
  let offset = 0;

  for (let page = 0; page < MAX_MESSAGE_PAGES_PER_CHAT; page++) {
    const resp = await client.post<MessageFindResponse>('/message/find', {
      chatid,
      limit: MESSAGE_PAGE_SIZE,
      offset,
    });
    const messages = resp.messages ?? [];
    if (messages.length === 0) break;

    let sawOlderThanWindow = false;
    for (const m of messages) {
      const ts = toMs(m.messageTimestamp);
      if (ts < window.sinceMs) {
        sawOlderThanWindow = true;
        continue;
      }
      if (ts > window.untilMs) continue;
      // Eco do nosso próprio envio pelo CRM — já está no nosso banco
      // (foi gravado na hora do envio), recuperar duplicaria.
      if (m.wasSentByApi === true) continue;

      const id = m.messageid || m.id;
      if (id) ids.push(id);
    }

    // Resultados vêm mais recentes primeiro — assim que uma página
    // cruza o início da janela, as próximas só ficam mais antigas.
    if (sawOlderThanWindow) break;
    if (messages.length < MESSAGE_PAGE_SIZE) break;

    offset += MESSAGE_PAGE_SIZE;
    if (page === MAX_MESSAGE_PAGES_PER_CHAT - 1) {
      return { ids, truncated: true };
    }
  }

  return { ids, truncated: false };
}

export async function previewRecovery(
  client: ReadOnlyUazapiClient,
  window: RecoveryWindow,
): Promise<RecoveryPreviewResult> {
  const byChat: ChatRecoverySummary[] = [];
  let chatsScanned = 0;
  let truncated = false;
  let offset = 0;

  for (let page = 0; page < MAX_CHAT_PAGES; page++) {
    const resp = await client.post<ChatFindResponse>('/chat/find', {
      sort: '-wa_lastMsgTimestamp',
      limit: CHAT_PAGE_SIZE,
      offset,
    });
    const chats = resp.chats ?? [];
    if (chats.length === 0) break;
    chatsScanned += chats.length;

    // Separa os chats elegíveis (dentro da janela) dos que já indicam
    // o fim dela, SEM consultar `/message/find` ainda — isso só
    // acontece depois, em paralelo, pro `break chatPages` abaixo
    // continuar barato mesmo numa página com centenas de chats.
    const eligible: UazapiChatRow[] = [];
    let hitOlderChat = false;
    for (const chat of chats) {
      const lastMs = toMs(chat.wa_lastMsgTimestamp);
      if (lastMs < window.sinceMs) {
        // Ordenado do mais recente pro mais antigo — daqui em diante
        // só tem chat sem mensagem na janela.
        hitOlderChat = true;
        break;
      }
      if (chat.wa_chatid) eligible.push(chat);
    }

    await mapWithConcurrency(eligible, CHAT_CONCURRENCY, async (chat) => {
      const { ids, truncated: chatTruncated } = await collectMessagesInWindow(
        client,
        chat.wa_chatid!,
        window,
      );
      if (chatTruncated) truncated = true;
      if (ids.length > 0) {
        byChat.push({
          chatid: chat.wa_chatid!,
          isGroup: !!chat.wa_isGroup,
          count: ids.length,
          messageIds: ids,
        });
      }
    });

    if (hitOlderChat) break;
    if (chats.length < CHAT_PAGE_SIZE) break;
    offset += CHAT_PAGE_SIZE;
    if (page === MAX_CHAT_PAGES - 1) truncated = true;
  }

  return {
    chatsScanned,
    chatsWithMessages: byChat.length,
    totalMessages: byChat.reduce((sum, c) => sum + c.count, 0),
    byChat,
    truncated,
  };
}
