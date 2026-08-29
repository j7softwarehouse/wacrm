// ============================================================
// Núcleo de ingestão de mensagens recebidas — independente de
// provedor.
//
// As rotas de webhook (Meta e, na Parte B, UAZAPI) ficam finas:
// autenticam, traduzem o payload do provedor para `InboundContent`,
// e chamam `ingestInboundMessage`. Toda a lógica de negócio —
// achar/criar contato, achar/criar conversa, gravar a mensagem,
// disparar automations/flows/AI/webhooks — vive aqui.
//
// O que deliberadamente NÃO vive aqui: qualquer coisa específica de
// um provedor. A resolução de URL de mídia é o caso emblemático — a
// rota da Meta verifica o media id no Graph API antes de montar a URL
// do proxy; a UAZAPI (Parte B) vai apontar para o Storage. O ingest só
// recebe `content.mediaUrl` já resolvido, ou nada.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { dispatchInboundToAiReply } from "@/lib/ai/auto-reply";
import { runAutomationsForTrigger } from "@/lib/automations/engine";
import { findExistingContact, isUniqueViolation } from "@/lib/contacts/dedupe";
import { CONTACT_SOURCE } from "@/lib/contacts/source";
import { dispatchInboundToFlows } from "@/lib/flows/engine";
import {
  resolveGroupConversation,
  type ResolvedGroupConversation,
} from "@/lib/whatsapp/groups/resolve-group-conversation";
import { dispatchWebhookEvent } from "@/lib/webhooks/deliver";
import type { WhatsAppChannel } from "@/types";

export interface InboundContent {
  type:
    | "text"
    | "image"
    | "video"
    | "document"
    | "audio"
    | "sticker"
    | "location"
    | "interactive"
    | "reaction";
  /** Corpo do texto, ou a legenda de uma mídia. */
  text?: string;
  mediaUrl?: string;
  mediaType?: string;
  /** Id do botão/linha tocado, quando o cliente responde a um interativo. */
  interactiveReplyId?: string;
  /**
   * Preenchido apenas quando `type === 'reaction'`. Emoji vazio =
   * remoção (spec da Cloud API da Meta; a UAZAPI expõe a mesma
   * semântica no seu campo `reaction`).
   */
  reaction?: { targetProviderMessageId: string; emoji: string };
}

export interface IngestParams {
  channel: WhatsAppChannel;
  /** Telefone do remetente, já normalizado pela rota. */
  from: string;
  /** Nome do perfil no WhatsApp, quando o provedor informa. */
  pushName?: string;
  /** Id da mensagem no provedor — a chave de idempotência. */
  providerMessageId: string;
  /** Epoch em segundos. */
  timestamp: number;
  content: InboundContent;
  replyToProviderMessageId?: string;
  /**
   * Presente só quando a mensagem veio de um grupo. Ausente = 1:1,
   * exatamente como antes — o caminho existente não muda.
   */
  group?: {
    groupJid: string;
    participantJid: string;
    participantName?: string;
  };
}

export interface IngestResult {
  /**
   * UUID interno da mensagem gravada. String vazia para reações, que
   * não geram linha em `messages` — são estado por (alvo, autor).
   */
  messageId: string;
  conversationId: string;
  contactId: string;
  /** true quando a mensagem já existia — reentrega do webhook. */
  deduped: boolean;
}

/** Texto mostrado na lista de conversas. */
export function buildConversationPreview(content: InboundContent): string {
  if (content.text) return content.text;
  return `[${content.type}]`;
}

/**
 * Mensagem de grupo NUNCA aciona flows, automations ou resposta
 * automática de IA. Fase 1 é leitura; um motor respondendo dentro de
 * um grupo é o pior erro possível desta entrega, porque a mensagem
 * indevida chega a terceiros e não há como desfazer.
 */
export function shouldDispatchEngines(params: {
  group?: { groupJid: string; participantJid: string; participantName?: string };
}): boolean {
  return !params.group;
}

/**
 * Postgres devolve 23505 em violação de índice único. No insert de uma
 * mensagem recebida isso só pode significar uma reentrega do webhook —
 * que precisa ser silenciosa, senão o provedor recebe 500 e tenta de
 * novo em loop.
 *
 * ATENÇÃO: hoje `messages.message_id` NÃO tem índice único. A 001 cria
 * apenas `idx_messages_message_id` (não-único), e a 009 documenta o
 * porquê: ids da Meta se repetem entre números diferentes. Ou seja,
 * este caminho está escrito e testado, mas fica inerte até existir uma
 * migração com UNIQUE (conversation_id, message_id) — o par que é
 * realmente único. Até lá, uma reentrega ainda grava linha duplicada,
 * como sempre gravou.
 */
export function isDuplicateMessage(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: string }).code === "23505";
}

// A CHECK constraint de messages.content_type (ampliada na migração 010
// para incluir 'interactive') aceita:
//   text, image, document, audio, video, location, template, interactive
// Tipos que não estão nessa lista são mapeados para o valor permitido
// mais próximo, senão o INSERT falha na constraint.
const ALLOWED_CONTENT_TYPES = new Set([
  "text",
  "image",
  "document",
  "audio",
  "video",
  "location",
  "template",
  "interactive",
]);

function toDbContentType(type: string): string {
  if (ALLOWED_CONTENT_TYPES.has(type)) return type;
  if (type === "sticker") return "image"; // figurinhas são imagens
  return "text"; // reaction, desconhecido → texto
}

/**
 * Resolve o message_id do provedor no UUID interno correspondente,
 * escopado a uma conversa. Devolve null quando nunca recebemos a
 * mensagem pai (ex.: resposta a algo anterior a esta instalação).
 */
async function lookupInternalIdByProviderMessageId(
  db: SupabaseClient,
  providerMessageId: string,
  conversationId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("messages")
    .select("id")
    .eq("message_id", providerMessageId)
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (error) {
    console.error("[webhook] lookupInternalIdByMetaId failed:", error.message);
    return null;
  }
  return data?.id ?? null;
}

/**
 * Persiste uma reação recebida. Reações não são mensagens novas —
 * são estado por (alvo, autor). Fazemos upsert / delete em
 * `message_reactions`, nunca insert em `messages`.
 *
 * Best-effort: um alvo ausente (nunca recebemos a mensagem) é logado e
 * ignorado, para o webhook ainda responder 200 ao provedor.
 */
async function applyReaction(
  db: SupabaseClient,
  reaction: { targetProviderMessageId: string; emoji: string },
  conversationId: string,
  contactId: string,
) {
  if (!reaction.targetProviderMessageId) return;

  const targetInternalId = await lookupInternalIdByProviderMessageId(
    db,
    reaction.targetProviderMessageId,
    conversationId,
  );
  if (!targetInternalId) {
    console.warn(
      "[webhook] reaction target message not found; skipping",
      reaction.targetProviderMessageId,
    );
    return;
  }

  // Emoji vazio = remoção (spec da Cloud API da Meta).
  if (!reaction.emoji) {
    const { error: delError } = await db
      .from("message_reactions")
      .delete()
      .eq("message_id", targetInternalId)
      .eq("actor_type", "customer")
      .eq("actor_id", contactId);
    if (delError) {
      console.error("[webhook] reaction delete failed:", delError.message);
    }
    return;
  }

  const { error: upsertError } = await db.from("message_reactions").upsert(
    {
      message_id: targetInternalId,
      conversation_id: conversationId,
      actor_type: "customer",
      actor_id: contactId,
      emoji: reaction.emoji,
    },
    { onConflict: "message_id,actor_type,actor_id" },
  );
  if (upsertError) {
    console.error("[webhook] reaction upsert failed:", upsertError.message);
  }
}

/**
 * Se o remetente de uma mensagem recebida está numa linha de
 * broadcast_recipients ainda sem resposta, marca como `replied` para o
 * contador de respostas do broadcast avançar.
 *
 * Best-effort — falhas aqui não podem quebrar o fluxo principal, então
 * os erros são engolidos com log.
 */
async function flagBroadcastReplyIfAny(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
) {
  try {
    // Broadcast enviado mais recente nesta conta que ainda não teve
    // resposta. Escopado por conta, para uma resposta na caixa
    // compartilhada marcar o broadcast independentemente de qual
    // colega o disparou.
    const { data: recs, error } = await db
      .from("broadcast_recipients")
      .select("id, status, broadcast_id, broadcasts!inner(account_id)")
      .eq("contact_id", contactId)
      .eq("broadcasts.account_id", accountId)
      .in("status", ["sent", "delivered", "read"])
      .order("created_at", { ascending: false })
      .limit(1);

    if (error || !recs || recs.length === 0) return;

    const row = recs[0];
    const { error: updErr } = await db
      .from("broadcast_recipients")
      .update({ status: "replied", replied_at: new Date().toISOString() })
      .eq("id", row.id);

    if (updErr) {
      console.error("Error marking broadcast recipient replied:", updErr);
    }
  } catch (err) {
    console.error("flagBroadcastReplyIfAny failed:", err);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContactRow = any;

interface ContactOutcome {
  contact: ContactRow;
  /** True quando esta chamada criou a linha; controla o disparo do
   *  trigger new_contact_created. */
  wasCreated: boolean;
}

/**
 * Contatos são compartilhados entre canais dentro de uma conta — o
 * mesmo número que fala com a recepção e com o financeiro é uma
 * pessoa só. Por isso a busca é escopada por conta, nunca por canal.
 */
async function findOrCreateContact(
  db: SupabaseClient,
  accountId: string,
  configOwnerUserId: string,
  phone: string,
  name: string | undefined,
): Promise<ContactOutcome | null> {
  // Procura um contato existente desta conta por telefone. O helper
  // compartilhado pré-filtra em SQL pelo sufixo de 8 dígitos (para não
  // puxar todos os contatos a cada mensagem) e aplica o `phonesMatch`
  // estrito em JS no conjunto pequeno de candidatos. O mesmo helper
  // atende o formulário manual e o import de CSV, então os três
  // caminhos concordam sobre o que é "o mesmo número" (issue #212).
  const existingContact = await findExistingContact(db, accountId, phone);

  if (existingContact) {
    // Atualiza o nome se mudou
    if (name && name !== existingContact.name) {
      await db
        .from("contacts")
        .update({ name, updated_at: new Date().toISOString() })
        .eq("id", existingContact.id);
    }
    return { contact: existingContact, wasCreated: false };
  }

  // Cria o contato. account_id é a coluna de tenancy; user_id é a
  // coluna de auditoria NOT NULL (nenhuma mensagem recebida tem um
  // "usuário que criou" — atribuímos ao dono da configuração do canal
  // como padrão estável).
  const { data: newContact, error: createError } = await db
    .from("contacts")
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      phone,
      name: name || phone,
      source: CONTACT_SOURCE.WHATSAPP,
    })
    .select()
    .single();

  if (createError) {
    // Perdeu uma corrida: uma entrega concorrente (ou outro caminho)
    // criou este contato entre a busca e o insert, e o índice único
    // (migração 022) rejeitou a duplicata. Re-resolve a linha existente
    // em vez de descartar a mensagem.
    if (isUniqueViolation(createError)) {
      const raced = await findExistingContact(db, accountId, phone);
      if (raced) return { contact: raced, wasCreated: false };
    }
    console.error("Error creating contact:", createError);
    return null;
  }

  return { contact: newContact, wasCreated: true };
}

/**
 * Adota uma conversa órfã (channel_id NULL) para este canal.
 *
 * O `.is('channel_id', null)` deixa a operação idempotente e sem
 * corrida: se outro writer já reivindicou a linha, o UPDATE não casa
 * nada. Best-effort — falhar aqui só mantém o status quo (a linha segue
 * órfã e a busca tolerante continua achando ela).
 */
async function adoptOrphanConversation(
  db: SupabaseClient,
  conversation: { id: string; channel_id?: string | null },
  channelId: string,
): Promise<void> {
  if (conversation.channel_id) return;
  const { error } = await db
    .from("conversations")
    .update({ channel_id: channelId })
    .eq("id", conversation.id)
    .is("channel_id", null);
  if (error) {
    console.error("Error backfilling conversation channel_id:", error.message);
    return;
  }
  // Mantém o objeto em memória coerente com o banco para o restante da
  // ingestão (e para o retorno ao chamador).
  conversation.channel_id = channelId;
}

/**
 * Conversas SÃO escopadas por canal: o mesmo contato falando com dois
 * números da conta são duas conversas distintas. É o que a migração
 * 037 formalizou ao trocar a UNIQUE para
 * (account_id, contact_id, channel_id).
 *
 * Com uma tolerância deliberada: a busca também aceita `channel_id`
 * NULL, e adota a linha órfã para este canal quando encontra uma.
 *
 * Por quê: os criadores de conversa do lado de SAÍDA (o composer do
 * dashboard e a API pública) só conhecem a conta, e por isso criavam a
 * conversa com channel_id NULL. Um filtro estritamente `.eq(channel.id)`
 * nunca acha essa linha (NULL ≠ chan-1), então a primeira resposta do
 * contato abriria uma SEGUNDA conversa — e o envio seguinte pelo
 * dashboard esbarraria na fatia única `(conta, contato, NULL)` que a
 * órfã já ocupa, virando 500 permanente. O mesmo vale para a órfã que o
 * "Resetar configuração" produz: apagar o canal dispara
 * ON DELETE SET NULL em toda conversa da conta.
 *
 * Aceitar-e-adotar converge os dois lados numa linha só, e cura o dado
 * existente em vez de apenas parar de piorá-lo.
 */
async function findOrCreateConversation(
  db: SupabaseClient,
  channel: WhatsAppChannel,
  contactId: string,
) {
  // `channel.id` é o UUID da linha de `whatsapp_channels` que a rota já
  // resolveu (pelo phone_number_id / webhook_secret do provedor) — nunca
  // texto vindo do payload — então interpolá-lo na gramática de filtro
  // `or` do PostgREST é seguro.
  const channelFilter = `channel_id.eq.${channel.id},channel_id.is.null`;

  // Procura uma conversa existente deste canal — ou órfã, ver acima —
  // mais antiga primeiro.
  //
  // Deliberadamente NÃO usamos `.single()` aqui. `.single()` dá erro
  // tanto com 0 linhas quanto com ≥2, e o código antigo tratava
  // qualquer erro como "não achou" e inseria uma linha nova. Assim,
  // uma vez que duas conversas existissem para um contato (por uma
  // corrida — a Meta reentrega, ou um lote abre execuções
  // concorrentes), toda mensagem seguinte dava erro na busca e criava
  // mais uma conversa, virando uma parede de chats duplicados
  // (issue #363).
  //
  // Ordenar do mais antigo e pegar uma linha faz a busca convergir
  // para o mesmo sobrevivente canônico que a migração de dedup (036)
  // mantém, então duplicatas pré-existentes convergem em vez de
  // se multiplicarem.
  const { data: existingRows, error: findError } = await db
    .from("conversations")
    .select("*")
    .eq("account_id", channel.account_id)
    .eq("contact_id", contactId)
    .or(channelFilter)
    .order("created_at", { ascending: true })
    .limit(1);

  if (findError) {
    console.error("Error finding conversation:", findError);
    return null;
  }

  if (existingRows && existingRows.length > 0) {
    await adoptOrphanConversation(db, existingRows[0], channel.id);
    return { conversation: existingRows[0], created: false };
  }

  // Cria a conversa. Mesma separação tenancy + auditoria do
  // findOrCreateContact acima.
  const { data: newConv, error: createError } = await db
    .from("conversations")
    .insert({
      account_id: channel.account_id,
      user_id: channel.user_id,
      contact_id: contactId,
      channel_id: channel.id,
    })
    .select()
    .single();

  if (createError) {
    // Perdeu uma corrida: uma entrega concorrente criou a conversa
    // entre a busca e o insert, e o índice único (036, ampliado pela
    // 037) rejeitou a duplicata. Re-resolve a linha vencedora em vez
    // de descartar a mensagem — espelha o findOrCreateContact.
    //
    // O filtro por canal precisa estar aqui também: sem ele, uma
    // corrida num canal poderia resolver para a conversa de OUTRO
    // canal do mesmo contato. Mesma tolerância a NULL da busca inicial —
    // a corrida perdida pode ter sido justamente contra a fatia
    // `(conta, contato, NULL)` de uma órfã.
    if (isUniqueViolation(createError)) {
      const { data: raced } = await db
        .from("conversations")
        .select("*")
        .eq("account_id", channel.account_id)
        .eq("contact_id", contactId)
        .or(channelFilter)
        .order("created_at", { ascending: true })
        .limit(1);
      if (raced && raced.length > 0) {
        await adoptOrphanConversation(db, raced[0], channel.id);
        return { conversation: raced[0], created: false };
      }
    }
    console.error("Error creating conversation:", createError);
    return null;
  }

  return { conversation: newConv, created: true };
}

/**
 * Grava a mensagem de um grupo já resolvido (conversa + participante).
 * Caminho deliberadamente separado do 1:1: não há contato a achar ou
 * criar — o participante mora em `group_participants`, nunca em
 * `contacts`. Não dispara flows/automations/IA (isso é decidido antes,
 * por `shouldDispatchEngines`, no caminho comum de quem chama).
 */
async function ingestGroupMessage(
  db: SupabaseClient,
  params: IngestParams,
  resolved: ResolvedGroupConversation,
): Promise<IngestResult | null> {
  const { data: message, error } = await db
    .from("messages")
    .insert({
      conversation_id: resolved.conversationId,
      sender_type: "customer",
      participant_id: resolved.participantId,
      content_type: params.content.type,
      content_text: params.content.text ?? null,
      media_url: params.content.mediaUrl ?? null,
      message_id: params.providerMessageId,
      status: "received",
    })
    .select("id")
    .single();

  if (error || !message) return null;

  await db
    .from("conversations")
    .update({
      last_message_text: buildConversationPreview(params.content),
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", resolved.conversationId);

  return {
    messageId: message.id,
    conversationId: resolved.conversationId,
    // Conversa de grupo não tem contato — o campo existe no contrato
    // por causa do caminho 1:1.
    contactId: "",
    deduped: false,
  };
}

/**
 * Ingere uma mensagem recebida, venha de qual provedor vier.
 *
 * Devolve `null` quando nada foi ingerido — contato/conversa não
 * resolveram, ou o insert falhou por um erro real de banco. Todos
 * esses casos já foram logados aqui dentro; a rota não precisa (nem
 * deve) transformá-los em 500 para o provedor, exatamente como antes
 * da extração.
 */
export async function ingestInboundMessage(
  db: SupabaseClient,
  params: IngestParams,
): Promise<IngestResult | null> {
  const { channel, content, providerMessageId } = params;
  // Tenancy — dirige toda busca de contato / conversa e o dispatch
  // dos motores.
  const accountId = channel.account_id;
  // Remetente-de-registro para inserts que precisam de um user_id FK
  // NOT NULL (contacts, conversations). Sempre o admin que salvou a
  // configuração do canal; a escolha é arbitrária pós-017 mas estável.
  const configOwnerUserId = channel.user_id;

  // Grupo tem caminho próprio: não há contato a criar, e o
  // participante mora em `group_participants`. Precisa vir antes de
  // findOrCreateContact — senão um "contato" seria criado a partir do
  // telefone do participante do grupo, violando a restrição de
  // produto de que participante nunca vira contato.
  if (params.group) {
    const resolved = await resolveGroupConversation(
      db,
      accountId,
      channel.id,
      configOwnerUserId,
      params.group,
    );
    // Grupo não habilitado (ou recém-descoberto): nada entra na inbox.
    if (!resolved) return null;

    return await ingestGroupMessage(db, params, resolved);
  }

  // Acha ou cria o contato
  const contactOutcome = await findOrCreateContact(
    db,
    accountId,
    configOwnerUserId,
    params.from,
    params.pushName,
  );
  if (!contactOutcome) return null;
  const contactRecord = contactOutcome.contact;

  // Acha ou cria a conversa
  const convResult = await findOrCreateConversation(
    db,
    channel,
    contactRecord.id,
  );
  if (!convResult) return null;
  const conversation = convResult.conversation;

  // Emite conversation.created assim que a thread é aberta — ANTES do
  // curto-circuito de reação abaixo — para que uma conversa aberta por
  // uma reação também dispare o evento, e um assinante sempre veja a
  // thread abrir antes do primeiro message.received.
  if (convResult.created) {
    await dispatchWebhookEvent(db, accountId, "conversation.created", {
      conversation_id: conversation.id,
      contact_id: contactRecord.id,
    });
  }

  // Reações fazem curto-circuito aqui — não são mensagens. Nunca
  // inserimos em `messages`, nunca incrementamos unread_count, nunca
  // atualizamos last_message_text.
  if (content.type === "reaction") {
    if (content.reaction) {
      await applyReaction(
        db,
        content.reaction,
        conversation.id,
        contactRecord.id,
      );
    }
    return {
      messageId: "",
      conversationId: conversation.id,
      contactId: contactRecord.id,
      deduped: false,
    };
  }

  const contentText = content.text ?? null;
  const interactiveReplyId = content.interactiveReplyId ?? null;

  // Resolve o contexto de resposta (swipe-reply) se houver. Um pai
  // ausente é aceitável — gravamos NULL e a UI renderiza a mensagem
  // sem a citação.
  let replyToInternalId: string | null = null;
  if (params.replyToProviderMessageId) {
    replyToInternalId = await lookupInternalIdByProviderMessageId(
      db,
      params.replyToProviderMessageId,
      conversation.id,
    );
    if (!replyToInternalId) {
      console.warn(
        "[webhook] reply context parent not found:",
        params.replyToProviderMessageId,
      );
    }
  }

  // Insere a mensagem — os nomes de campo PRECISAM bater com o schema
  // da tabela messages (supabase/migrations/001_initial_schema.sql):
  //   conversation_id, sender_type, content_type, content_text,
  //   media_url, template_name, message_id, status, created_at
  // `content.mediaType` é intencionalmente ignorado — o schema não tem
  // coluna media_type; o MIME só serve para a rota montar a URL.
  const contentType = toDbContentType(content.type);

  // Descobre se esta é a primeiríssima mensagem recebida do contato
  // ANTES de inserir, para a contagem ser exata. Cobre o caso em que a
  // linha do contato já existe (cadastro manual / import de CSV) mas
  // ele nunca nos escreveu — que new_contact_created não pegaria.
  const { count: priorCustomerMsgCount } = await db
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversation.id)
    .eq("sender_type", "customer");
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0;

  const { data: insertedMessage, error: msgError } = await db
    .from("messages")
    .insert({
      conversation_id: conversation.id,
      sender_type: "customer",
      content_type: contentType,
      content_text: contentText,
      media_url: content.mediaUrl ?? null,
      message_id: providerMessageId,
      status: "delivered",
      created_at: new Date(params.timestamp * 1000).toISOString(),
      reply_to_message_id: replyToInternalId,
      // Só preenchido para content_type='interactive'. A migração 010
      // adicionou a coluna; null para todo o resto, então os inserts
      // existentes se comportam igual.
      interactive_reply_id: interactiveReplyId,
    })
    .select("id")
    .single();

  if (msgError) {
    // Reentrega do webhook: a mensagem já foi ingerida numa entrega
    // anterior, com todos os efeitos colaterais (flows, automations,
    // AI, webhook) já disparados. Devolvemos a linha existente sem
    // repetir nada disso. Ver a nota em `isDuplicateMessage`: sem
    // índice único em messages, este ramo ainda não é alcançável.
    if (isDuplicateMessage(msgError)) {
      const existingId = await lookupInternalIdByProviderMessageId(
        db,
        providerMessageId,
        conversation.id,
      );
      if (existingId) {
        return {
          messageId: existingId,
          conversationId: conversation.id,
          contactId: contactRecord.id,
          deduped: true,
        };
      }
    }
    console.error("Error inserting message:", msgError);
    return null;
  }

  // Atualiza a conversa
  const { error: convError } = await db
    .from("conversations")
    .update({
      last_message_text: buildConversationPreview(content),
      last_message_at: new Date().toISOString(),
      unread_count: (conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversation.id);

  if (convError) {
    console.error("Error updating conversation:", convError);
  }

  // Grupo nunca aciona os motores (flows, automations, IA). Ver
  // `shouldDispatchEngines`: defesa em profundidade enquanto grupo
  // ainda passa por este mesmo caminho de ingestão do 1:1.
  if (shouldDispatchEngines(params)) {
    // Se este contato recebeu um broadcast recente, marca a resposta
    // para o `replied_count` do broadcast avançar (via o trigger de
    // agregação instalado na migração 003).
    await flagBroadcastReplyIfAny(db, accountId, contactRecord.id);

    // ============================================================
    // Dispatch do runner de flows.
    //
    // Se o runner consumir a mensagem (avançou uma execução ativa ou
    // iniciou uma nova), suprimimos os triggers `new_message_received` +
    // `keyword_match` para esta entrada. O cliente está navegando o menu
    // do bot, não mandando uma palavra-gatilho nova que deveria se
    // ramificar em automations.
    //
    // Os triggers de relacionamento (`new_contact_created`,
    // `first_inbound_message`) continuam disparando mesmo quando
    // consumida — eles são sobre QUEM está escrevendo, não sobre o quê.
    //
    // Aguardado (não fire-and-forget) porque precisamos do resultado
    // `consumed` antes de decidir se disparamos as automations. O runner
    // tem o próprio try/catch e nunca lança. Contas sem flows ativos
    // pegam o atalho "no_match" praticamente de graça (um SELECT
    // indexado pela execução ativa).
    // ============================================================
    const flowResult = await dispatchInboundToFlows({
      accountId,
      userId: configOwnerUserId,
      contactId: contactRecord.id,
      conversationId: conversation.id,
      message: interactiveReplyId
        ? {
            kind: "interactive_reply",
            reply_id: interactiveReplyId,
            reply_title: contentText ?? "",
            meta_message_id: providerMessageId,
          }
        : {
            kind: "text",
            text: contentText ?? "",
            meta_message_id: providerMessageId,
          },
      isFirstInboundMessage,
    });
    const flowConsumed = flowResult.consumed;

    // Dispara as automations que reagem a este evento. Todos os
    // dispatches ficam aqui (não antes) para que contato, conversa e
    // mensagem já existam antes de qualquer passo — inclusive
    // send_message — rodar. Fire-and-forget: uma automation lenta ou com
    // falha não pode segurar o 200 OK do webhook.
    const inboundText = contentText ?? "";
    const automationTriggers: (
      | "new_contact_created"
      | "first_inbound_message"
      | "new_message_received"
      | "keyword_match"
      | "interactive_reply"
    )[] = [];
    // Triggers de conteúdo são suprimidos quando um flow consumiu a
    // mensagem — ver o bloco de comentário acima.
    if (!flowConsumed) {
      automationTriggers.push("new_message_received", "keyword_match");
      // Toque em interativo → dispara também o trigger interactive_reply
      // (só faz sentido quando uma resposta de botão/lista realmente
      // chegou). Habilita menus encadeados só com automations; quando um
      // Flow é dono do menu ele terá consumido a resposta e isto é
      // pulado.
      if (interactiveReplyId) {
        automationTriggers.push("interactive_reply");
      }
    }
    // new_contact_created dispara só quando o webhook acabou de criar a
    // linha do contato. first_inbound_message dispara sempre que esta é
    // a primeira mensagem enviada pelo cliente — um superconjunto que
    // também pega contatos importados manualmente escrevendo pela
    // primeira vez. Disparamos os dois para o usuário escolher a
    // semântica que quiser; uma automation que escuta só um dos dois
    // roda só quando aquele trigger casa.
    if (contactOutcome.wasCreated)
      automationTriggers.unshift("new_contact_created");
    if (isFirstInboundMessage) automationTriggers.unshift("first_inbound_message");
    for (const triggerType of automationTriggers) {
      runAutomationsForTrigger({
        accountId,
        triggerType,
        contactId: contactRecord.id,
        context: {
          message_text: inboundText,
          conversation_id: conversation.id,
          // Só preenchido em toques em interativo; dirige o match exato
          // por id do trigger interactive_reply.
          interactive_reply_id: interactiveReplyId ?? undefined,
        },
      }).catch((err) => console.error("[automations] dispatch failed:", err));
    }

    // Resposta automática por IA. Roda só para texto puro que o runner
    // determinístico NÃO consumiu (flows ganham do LLM), e só quando a
    // conta habilitou. Aguardado dentro do `after()` da rota (mesmo
    // motivo do webhook abaixo); `dispatchInboundToAiReply` é dono dos
    // próprios gates de elegibilidade + try/catch e nunca lança.
    if (!flowConsumed && !interactiveReplyId && inboundText.trim()) {
      await dispatchInboundToAiReply({
        accountId,
        conversationId: conversation.id,
        contactId: contactRecord.id,
        configOwnerUserId,
      });
    }
  }

  // Webhook message.received (API pública). Aguardado — não
  // fire-and-forget — porque estamos dentro do bloco `after()` da
  // rota, que só mantém a função viva para promessas que ele enxerga;
  // uma promessa solta poderia ser congelada antes de entregar.
  // `dispatchWebhookEvent` sai cedo quando a conta não tem endpoint
  // correspondente e nunca lança. (conversation.created é emitido
  // antes, assim que a thread é aberta.)
  await dispatchWebhookEvent(db, accountId, "message.received", {
    conversation_id: conversation.id,
    contact_id: contactRecord.id,
    whatsapp_message_id: providerMessageId,
    content_type: contentType,
    text: contentText,
  });

  return {
    messageId: insertedMessage.id,
    conversationId: conversation.id,
    contactId: contactRecord.id,
    deduped: false,
  };
}
