import { NextResponse, after } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { ingestInboundMessage } from "@/lib/whatsapp/inbound/ingest";
import {
  mapInstanceStatus,
  mapUazapiMessageStatus,
  type CrmMessageStatus,
} from "@/lib/whatsapp/uazapi/connection";
import { extractEventType, normalizeUazapiEvent } from "@/lib/whatsapp/uazapi/normalize";
import { getProviderForChannel } from "@/lib/whatsapp/providers/resolve";
import type { WhatsAppChannel } from "@/types";

export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _adminClient;
}

/**
 * Entrada de eventos da UAZAPI.
 *
 * O segredo vive no caminho da URL porque o objeto `Webhook` da UAZAPI
 * só tem o campo `url` — não há onde declarar header customizado nem
 * segredo compartilhado, diferente da Meta que assina o corpo com
 * HMAC. Um único lookup por `webhook_secret` identifica QUAL dos N
 * canais falou e prova que quem chamou conhece o segredo.
 *
 * A rota é catch-all (`[...secret]`) por precaução: se alguém ativar
 * `addUrlEvents` no painel da UAZAPI, chegam segmentos extras à
 * direita, e é melhor ignorá-los do que devolver 404 silencioso.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ secret: string[] }> },
) {
  const { secret } = await params;
  const token = secret?.[0];

  if (!token) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { data: channel } = await supabaseAdmin()
    .from("whatsapp_channels")
    .select("*")
    .eq("webhook_secret", token)
    .maybeSingle();

  if (!channel) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);

  // Responde 200 imediatamente e processa depois: a UAZAPI reentrega
  // em caso de timeout, e reentrega significa histórico duplicado.
  after(async () => {
    try {
      await handleEvent(channel as WhatsAppChannel, body);
    } catch (err) {
      console.error(
        "[uazapi/webhook] falha ao processar evento:",
        err instanceof Error ? err.message : err,
      );
    }
  });

  return NextResponse.json({ ok: true });
}

/** Uma linha de `messages` que pertence a este canal, com os campos
 *  que as funções abaixo precisam pra decidir a atualização. */
interface OwnedMessageRow {
  id: string;
  conversation_id: string | null;
  content_text: string | null;
  original_content_text: string | null;
}

/**
 * Localiza, entre os `message_id` informados, só as mensagens que
 * pertencem a ESTE canal/conta.
 *
 * O escopo é obrigatório: o `webhook_secret` é uma credencial que TODO
 * tenant possui para o próprio canal (a UI de canais mostra a URL
 * completa), diferente do HMAC server-side da Meta. Sem o filtro, um
 * tenant poderia forjar um evento com o `message_id` de outra conta e
 * mexer no histórico alheio — `messages.message_id` não é único por
 * conta.
 *
 * Duas etapas em vez de um embed (`conversations!inner(...)`): o embed
 * depende do schema cache do PostgREST, que fica obsoleto logo após
 * migrações e derruba a query inteira com PGRST200.
 *
 * Compartilhada por status/exclusão/edição (2026-09-11) — as três
 * precisam exatamente da mesma checagem de posse antes de escrever.
 */
async function findOwnedMessages(
  channel: WhatsAppChannel,
  providerMessageIds: string[],
): Promise<OwnedMessageRow[]> {
  const db = supabaseAdmin();

  const { data: messages, error: findError } = await db
    .from("messages")
    .select("id, conversation_id, content_text, original_content_text")
    .in("message_id", providerMessageIds);

  if (findError) {
    console.error(
      "[uazapi/webhook] falha ao localizar mensagem:",
      findError.message,
    );
    return [];
  }
  if (!messages || messages.length === 0) return [];

  const conversationIds = [
    ...new Set(
      (messages as OwnedMessageRow[])
        .map((m) => m.conversation_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (conversationIds.length === 0) return [];

  const { data: owned, error: convError } = await db
    .from("conversations")
    .select("id")
    .in("id", conversationIds)
    .eq("account_id", channel.account_id)
    .eq("channel_id", channel.id);

  if (convError) {
    console.error(
      "[uazapi/webhook] falha ao validar a conversa:",
      convError.message,
    );
    return [];
  }

  const ownedIds = new Set((owned ?? []).map((c: { id: string }) => c.id));
  return (messages as OwnedMessageRow[]).filter(
    (m) => m.conversation_id !== null && ownedIds.has(m.conversation_id),
  );
}

/** Avança o status de entrega (enviada/entregue/lida/etc.) das mensagens dadas. */
async function applyMessageStatus(
  channel: WhatsAppChannel,
  messageIds: string[],
  status: CrmMessageStatus,
): Promise<void> {
  const rows = await findOwnedMessages(channel, messageIds);
  if (rows.length === 0) return;

  const { error: updateError } = await supabaseAdmin()
    .from("messages")
    .update({ status })
    .in(
      "id",
      rows.map((r) => r.id),
    );

  if (updateError) {
    console.error(
      "[uazapi/webhook] falha ao atualizar status da mensagem:",
      updateError.message,
    );
  }
}

/**
 * Marca `deleted_at` nas mensagens apagadas pelo PRÓPRIO PARTICIPANTE
 * no WhatsApp dele (não pelo botão do CRM — essa via já existe em
 * `POST /api/whatsapp/messages/[id]/delete`). NUNCA toca
 * `content_text` — mesma garantia da rota manual. `deleted_by` fica
 * nulo: não há usuário do CRM para atribuir.
 */
async function applyMessageDeletion(
  channel: WhatsAppChannel,
  messageIds: string[],
): Promise<void> {
  const rows = await findOwnedMessages(channel, messageIds);
  if (rows.length === 0) return;

  const { error: updateError } = await supabaseAdmin()
    .from("messages")
    .update({ deleted_at: new Date().toISOString() })
    .in(
      "id",
      rows.map((r) => r.id),
    );

  if (updateError) {
    console.error(
      "[uazapi/webhook] falha ao marcar mensagem apagada:",
      updateError.message,
    );
  }
}

/**
 * Aplica uma edição feita pelo PRÓPRIO PARTICIPANTE no WhatsApp dele.
 * Confirmado ao vivo (2026-09-11): a uazapi manda a versão editada
 * como um evento "messages" comum, com `edited` preenchido com o
 * `messageid` da mensagem ORIGINAL — nunca documentado, só descoberto
 * testando.
 *
 * Devolve `true` se achou e atualizou a mensagem original (mesmo
 * canal/conta); `false` se não achou — o chamador deixa cair pro fluxo
 * normal de ingestão, que trata como mensagem nova. Mostrar a mensagem
 * é melhor que perdê-la.
 */
async function applyMessageEdit(
  channel: WhatsAppChannel,
  originalMessageId: string,
  newMessageId: string,
  newText: string,
): Promise<boolean> {
  const rows = await findOwnedMessages(channel, [originalMessageId]);
  const row = rows[0];
  if (!row) return false;

  const { error: updateError } = await supabaseAdmin()
    .from("messages")
    .update({
      content_text: newText,
      message_id: newMessageId,
      edited_at: new Date().toISOString(),
      original_content_text: row.original_content_text ?? row.content_text,
    })
    .eq("id", row.id);

  if (updateError) {
    console.error(
      "[uazapi/webhook] falha ao aplicar edição:",
      updateError.message,
    );
    return false;
  }
  return true;
}

/**
 * IDs alvo de um evento `messages_update`. Confirmado ao vivo
 * (2026-09-11): a uazapi manda `MessageIDs` (PascalCase, sempre lista,
 * mesmo pra 1 mensagem) dentro de `event` — não `messageid` (singular)
 * como a doc original sugeria. O singular fica como fallback barato.
 */
function extractMessageIds(payload: Record<string, unknown>): string[] {
  if (Array.isArray(payload.MessageIDs)) {
    return payload.MessageIDs.filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    );
  }
  if (typeof payload.messageid === "string" && payload.messageid) {
    return [payload.messageid];
  }
  return [];
}

export async function handleEvent(channel: WhatsAppChannel, body: unknown) {
  if (!body || typeof body !== "object") return;
  const envelope = body as Record<string, unknown>;
  const eventName = extractEventType(envelope);

  // "connection" foi capturado ao vivo (payload simples, {status}).
  // "messages_update" TAMBÉM foi (2026-09-11, evento de exclusão) — o
  // corpo mora em `event`, não em `data`/`message` como a doc original
  // sugeria; os três vocabulários convivem aqui porque não há motivo
  // pra assumir que um evento segue o formato de outro só porque a doc
  // dizia isso (e a doc já errou antes — ver normalize.ts).
  const payload =
    (envelope.data && typeof envelope.data === "object"
      ? (envelope.data as Record<string, unknown>)
      : null) ??
    (envelope.message && typeof envelope.message === "object"
      ? (envelope.message as Record<string, unknown>)
      : null) ??
    (envelope.event && typeof envelope.event === "object"
      ? (envelope.event as Record<string, unknown>)
      : null) ??
    {};

  if (eventName === "connection") {
    const raw = typeof payload.status === "string" ? payload.status : undefined;
    await supabaseAdmin()
      .from("whatsapp_channels")
      .update({ status: mapInstanceStatus(raw) })
      .eq("id", channel.id);
    return;
  }

  if (eventName === "messages_update" || eventName === "status") {
    const messageIds = extractMessageIds(payload);
    // `Type` (PascalCase) é o campo confirmado ao vivo para exclusão
    // ("Deleted"); `status` é o campo do vocabulário antigo, nunca
    // confirmado, mantido como fallback. Só "Deleted" foi observado —
    // os demais valores de status de entrega (Delivered/Read/etc.) são
    // inferidos por extensão do mesmo campo, ainda não confirmados ao
    // vivo.
    const rawState =
      (typeof payload.Type === "string" && payload.Type) ||
      (typeof payload.status === "string" && payload.status) ||
      null;

    if (rawState && rawState.trim().toUpperCase() === "DELETED") {
      if (messageIds.length > 0) {
        await applyMessageDeletion(channel, messageIds);
      }
      return;
    }

    const status = mapUazapiMessageStatus(rawState);
    if (messageIds.length > 0 && status) {
      await applyMessageStatus(channel, messageIds, status);
    }
    return;
  }

  // Edição feita pelo próprio participante no WhatsApp dele: chega
  // como um evento "messages" comum, com `edited` apontando pro
  // `messageid` da mensagem original (confirmado ao vivo, 2026-09-11).
  // `fromMe`/`wasSentByApi` excluem o eco de uma edição que O PRÓPRIO
  // CRM disparou via `POST .../messages/[id]/edit` — essa via já
  // atualiza o banco direto, não precisa (nem deve) passar por aqui de novo.
  if (
    (eventName === "message" || eventName === "messages") &&
    payload.fromMe !== true &&
    payload.wasSentByApi !== true &&
    typeof payload.edited === "string" &&
    payload.edited
  ) {
    const newMessageId =
      (typeof payload.messageid === "string" && payload.messageid) ||
      (typeof payload.id === "string" && payload.id) ||
      null;
    const newText =
      (typeof payload.text === "string" && payload.text) ||
      (typeof payload.content === "string" && payload.content) ||
      undefined;

    if (newMessageId && newText !== undefined) {
      const applied = await applyMessageEdit(
        channel,
        payload.edited,
        newMessageId,
        newText,
      );
      if (applied) return;
      // Mensagem original não encontrada (fora do nosso histórico, ou
      // o evento dela se perdeu) — cai pro fluxo normal abaixo, que
      // trata como mensagem nova. Mostrar é melhor que perder.
    }
  }

  const normalized = normalizeUazapiEvent(body);
  if (!normalized) return;

  // Mídia recebida é baixada para o Storage — as URLs do WhatsApp
  // expiram e deixariam o histórico quebrado.
  //
  // getProviderForChannel/buildProvider recusa canais cujo status
  // espelhado no banco não seja "connected" (guarda pensada para
  // envios). Esse status é atualizado por um evento "connection"
  // separado, sem garantia de ordem em relação a "messages" — então
  // uma mensagem pode chegar durante uma oscilação breve de status.
  // Como a resposta 200 já foi enviada antes do after() rodar, a
  // UAZAPI não reentrega: deixar o erro subir aqui derrubaria a
  // mensagem inteira (texto incluído), não só a mídia. Por isso o
  // erro é contido localmente e a mídia degrada para undefined.
  let content = normalized.content;
  if (content.mediaUrl) {
    try {
      const provider = await getProviderForChannel(supabaseAdmin(), channel.id);
      const stored = await provider.resolveInboundMediaUrl(content.mediaUrl);
      content = { ...content, mediaUrl: stored ?? undefined };
    } catch (err) {
      console.error(
        "[uazapi/webhook] falha ao resolver mídia recebida:",
        err instanceof Error ? err.message : err,
      );
      content = { ...content, mediaUrl: undefined };
    }
  }

  await ingestInboundMessage(supabaseAdmin(), {
    channel,
    from: normalized.from,
    pushName: normalized.pushName,
    providerMessageId: normalized.providerMessageId,
    timestamp: normalized.timestamp,
    content,
    replyToProviderMessageId: normalized.replyToProviderMessageId,
    group: normalized.group,
  });
}
