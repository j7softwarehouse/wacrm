// ============================================================
// Varredura (somente leitura) do histórico da UAZAPI numa janela de
// tempo — base tanto da prévia (`previewRecovery`, conta quantas
// mensagens existem) quanto da gravação de verdade (`recovery.ts`, que
// usa os objetos crus retornados aqui pra reconstruir cada mensagem).
//
// NUNCA grava nada: só consulta `/chat/find` + `/message/find` (que
// guardam o histórico da própria UAZAPI, independente do nosso
// webhook).
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

/** Mensagem crua da UAZAPI (schema `Message` do OpenAPI) — só os
 *  campos que `normalizeUazapiEvent` (normalize.ts) precisa pra
 *  reconstruir a mensagem, mais os usados aqui pra filtrar/ordenar. */
export interface UazapiMessageRow {
  messageid?: string;
  id?: string;
  chatid?: string;
  isGroup?: boolean;
  fromMe?: boolean;
  wasSentByApi?: boolean;
  messageType?: string;
  messageTimestamp?: number;
  text?: string;
  content?: unknown;
  sender?: string;
  sender_pn?: string;
  senderName?: string;
  quoted?: string;
  edited?: string;
  buttonOrListid?: string;
}

export interface ChatMessages {
  chatid: string;
  isGroup: boolean;
  messages: UazapiMessageRow[];
  /** true quando algum limite de paginação foi atingido pra ESTE chat
   *  — pode haver mais mensagens na janela do que as retornadas. */
  truncated: boolean;
}

export interface MessagesInWindowResult {
  chatsScanned: number;
  byChat: ChatMessages[];
  /** true quando algum limite global (nº de páginas de chat) foi
   *  atingido — a lista de CHATS pode estar incompleta. */
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

async function findRawMessagesInWindow(
  client: ReadOnlyUazapiClient,
  chatid: string,
  window: RecoveryWindow,
): Promise<{ messages: UazapiMessageRow[]; truncated: boolean }> {
  const messages: UazapiMessageRow[] = [];
  let offset = 0;

  for (let page = 0; page < MAX_MESSAGE_PAGES_PER_CHAT; page++) {
    const resp = await client.post<MessageFindResponse>('/message/find', {
      chatid,
      limit: MESSAGE_PAGE_SIZE,
      offset,
    });
    const page_ = resp.messages ?? [];
    if (page_.length === 0) break;

    let sawOlderThanWindow = false;
    for (const m of page_) {
      const ts = toMs(m.messageTimestamp);
      if (ts < window.sinceMs) {
        sawOlderThanWindow = true;
        continue;
      }
      if (ts > window.untilMs) continue;
      // Eco do nosso próprio envio pelo CRM, ou mensagem mandada pelo
      // PRÓPRIO celular da escola direto no app (fora do CRM) — o
      // webhook ao vivo descarta as duas (normalize.ts:
      // normalizeUazapiEvent), então a recuperação tem que casar
      // exatamente com o que o webhook teria ingerido se estivesse no
      // ar.
      if (m.wasSentByApi === true || m.fromMe === true) continue;

      if (m.messageid || m.id) messages.push(m);
    }

    // Resultados vêm mais recentes primeiro — assim que uma página
    // cruza o início da janela, as próximas só ficam mais antigas.
    if (sawOlderThanWindow) break;
    if (page_.length < MESSAGE_PAGE_SIZE) break;

    offset += MESSAGE_PAGE_SIZE;
    if (page === MAX_MESSAGE_PAGES_PER_CHAT - 1) {
      return { messages, truncated: true };
    }
  }

  return { messages, truncated: false };
}

/**
 * Varre o histórico da UAZAPI numa janela de tempo e devolve, por
 * chat, os objetos de mensagem crus (filtrados e já sem eco do CRM).
 *
 * `onlyChatid` pula a listagem de chats e varre só esse — usado pra
 * rodar a recuperação num lote pequeno antes de confiar no resultado
 * pra conta inteira.
 */
export async function findMessagesInWindow(
  client: ReadOnlyUazapiClient,
  window: RecoveryWindow,
  options?: { onlyChatid?: string; onlyIsGroup?: boolean },
): Promise<MessagesInWindowResult> {
  if (options?.onlyChatid) {
    const { messages, truncated } = await findRawMessagesInWindow(
      client,
      options.onlyChatid,
      window,
    );
    return {
      chatsScanned: 1,
      truncated,
      byChat:
        messages.length > 0
          ? [
              {
                chatid: options.onlyChatid,
                isGroup: !!options.onlyIsGroup,
                messages,
                truncated,
              },
            ]
          : [],
    };
  }

  const byChat: ChatMessages[] = [];
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
    // o fim dela, SEM consultar `/message/find` ainda — isso mantém o
    // corte barato mesmo numa página com centenas de chats.
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
      const { messages, truncated: chatTruncated } = await findRawMessagesInWindow(
        client,
        chat.wa_chatid!,
        window,
      );
      if (chatTruncated) truncated = true;
      if (messages.length > 0) {
        byChat.push({
          chatid: chat.wa_chatid!,
          isGroup: !!chat.wa_isGroup,
          messages,
          truncated: chatTruncated,
        });
      }
    });

    if (hitOlderChat) break;
    if (chats.length < CHAT_PAGE_SIZE) break;
    offset += CHAT_PAGE_SIZE;
    if (page === MAX_CHAT_PAGES - 1) truncated = true;
  }

  return { chatsScanned, byChat, truncated };
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
  truncated: boolean;
}

/** Prévia só de contagem — usada pela rota .../recover-messages/preview. */
export async function previewRecovery(
  client: ReadOnlyUazapiClient,
  window: RecoveryWindow,
): Promise<RecoveryPreviewResult> {
  const scan = await findMessagesInWindow(client, window);

  const byChat: ChatRecoverySummary[] = scan.byChat.map((c) => ({
    chatid: c.chatid,
    isGroup: c.isGroup,
    count: c.messages.length,
    messageIds: c.messages.map((m) => (m.messageid || m.id)!),
  }));

  return {
    chatsScanned: scan.chatsScanned,
    chatsWithMessages: byChat.length,
    totalMessages: byChat.reduce((sum, c) => sum + c.count, 0),
    byChat,
    truncated: scan.truncated,
  };
}
