// ============================================================
// Gravação de verdade da recuperação de mensagens perdidas numa queda
// de produção (ver recovery-preview.ts pra prévia só-leitura).
//
// Reaproveita o MESMO caminho de ingestão que o webhook ao vivo usa
// (`normalizeUazapiEvent` + `ingestInboundMessage`) — a mensagem crua
// da UAZAPI é empacotada no mesmo formato de envelope que o webhook
// recebe (`{ EventType: "messages", message: <raw> }`), então toda a
// lógica de resolver contato/conversa/grupo/mídia/resposta já testada
// pro caminho ao vivo vale aqui sem duplicar nada.
//
// `suppressEngines: true` em TODA chamada — ver o comentário em
// `IngestParams` (ingest.ts): mensagem horas atrasada não pode
// disparar automação, fluxo, IA nem o webhook público.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ingestInboundMessage as realIngestInboundMessage,
  type IngestParams,
  type IngestResult,
} from "@/lib/whatsapp/inbound/ingest";
import { isGroupEnabled as realIsGroupEnabled } from "@/lib/whatsapp/groups/resolve-group-conversation";
import type { WhatsAppProvider } from "@/lib/whatsapp/providers/types";
import { normalizeUazapiEvent } from "@/lib/whatsapp/uazapi/normalize";
import type { WhatsAppChannel } from "@/types";

import {
  findMessagesInWindow,
  type ReadOnlyUazapiClient,
  type RecoveryWindow,
} from "./recovery-preview";

export type RecoveryOutcomeStatus =
  | "inserted"
  | "already_existed"
  | "skipped_unparseable"
  | "skipped_not_ingested"
  | "error";

export interface RecoveryOutcome {
  providerMessageId: string;
  chatid: string;
  status: RecoveryOutcomeStatus;
  error?: string;
}

export interface RecoverMessagesResult {
  chatsScanned: number;
  truncated: boolean;
  outcomes: RecoveryOutcome[];
  inserted: number;
  alreadyExisted: number;
  skippedUnparseable: number;
  /** O ingest devolveu null: grupo desabilitado, contato/conversa que
   *  não resolveram, ou erro de banco já logado — nada foi gravado. */
  skippedNotIngested: number;
  errors: number;
}

export interface RecoverMessagesOptions {
  /** Pula a listagem geral de chats e varre só este — pra rodar num
   *  lote pequeno antes de confiar na conta inteira. */
  onlyChatid?: string;
  onlyIsGroup?: boolean;
  /** Injeção pra teste — produção usa sempre o `ingestInboundMessage`
   *  real (ver o default no final deste arquivo). */
  isGroupEnabled?: (
    db: SupabaseClient,
    accountId: string,
    channelId: string,
    groupJid: string,
  ) => Promise<boolean>;
  ingestInboundMessage?: (
    db: SupabaseClient,
    params: IngestParams,
  ) => Promise<IngestResult | null>;
}

export async function recoverMessages(
  db: SupabaseClient,
  client: ReadOnlyUazapiClient,
  provider: Pick<WhatsAppProvider, "resolveInboundMediaUrl">,
  channel: WhatsAppChannel,
  window: RecoveryWindow,
  options: RecoverMessagesOptions = {},
): Promise<RecoverMessagesResult> {
  const ingest = options.ingestInboundMessage ?? realIngestInboundMessage;
  const groupEnabled = options.isGroupEnabled ?? realIsGroupEnabled;

  const scan = await findMessagesInWindow(client, window, {
    onlyChatid: options.onlyChatid,
    onlyIsGroup: options.onlyIsGroup,
  });

  const outcomes: RecoveryOutcome[] = [];

  for (const chat of scan.byChat) {
    // Idempotência: `messages.message_id` ainda NÃO tem índice único
    // (ver o comentário de `isDuplicateMessage` em ingest.ts) — esta
    // checagem explícita é a única proteção real contra duplicar numa
    // segunda rodada sobre a mesma janela.
    const candidateIds = chat.messages
      .map((m) => m.messageid || m.id)
      .filter((id): id is string => !!id);
    const existing = new Set<string>();
    if (candidateIds.length > 0) {
      const { data: rows } = await db
        .from("messages")
        .select("message_id")
        .in("message_id", candidateIds);
      for (const row of (rows ?? []) as { message_id: string }[]) {
        existing.add(row.message_id);
      }
    }

    for (const raw of chat.messages) {
      const providerMessageId = raw.messageid || raw.id || "";
      if (!providerMessageId) continue;

      if (existing.has(providerMessageId)) {
        outcomes.push({ providerMessageId, chatid: chat.chatid, status: "already_existed" });
        continue;
      }

      const normalized = normalizeUazapiEvent({ EventType: "messages", message: raw });
      if (!normalized) {
        outcomes.push({ providerMessageId, chatid: chat.chatid, status: "skipped_unparseable" });
        continue;
      }

      // Mídia recebida é baixada/descriptografada/guardada no Storage,
      // mesmo padrão e mesmo motivo do webhook ao vivo (route.ts): a
      // URL do WhatsApp expira. Falha aqui (link JÁ expirado, comum
      // numa recuperação de horas depois) degrada pra mensagem sem
      // mídia — nunca derruba a recuperação inteira por causa de UM
      // arquivo.
      let content = normalized.content;
      // Grupo desabilitado: o ingest descarta a mensagem, então baixar a
      // mídia só gastaria CPU e deixaria arquivo órfão (mesma regra do
      // webhook ao vivo).
      const skipMedia =
        !!normalized.group &&
        !(await groupEnabled(db, channel.account_id, channel.id, normalized.group.groupJid));
      if (content.mediaUrl && skipMedia) {
        content = { ...content, mediaUrl: undefined };
      } else if (content.mediaUrl) {
        try {
          const stored = await provider.resolveInboundMediaUrl(content.mediaUrl);
          content = { ...content, mediaUrl: stored ?? undefined };
        } catch (err) {
          console.error(
            "[recovery] falha ao resolver mídia (provavelmente link expirado):",
            err instanceof Error ? err.message : err,
          );
          content = { ...content, mediaUrl: undefined };
        }
      }

      try {
        const ingested = await ingest(db, {
          channel,
          from: normalized.from,
          pushName: normalized.pushName,
          providerMessageId: normalized.providerMessageId,
          timestamp: normalized.timestamp,
          content,
          replyToProviderMessageId: normalized.replyToProviderMessageId,
          group: normalized.group,
          suppressEngines: true,
        });
        outcomes.push({
          providerMessageId,
          chatid: chat.chatid,
          status: ingested ? "inserted" : "skipped_not_ingested",
        });
      } catch (err) {
        outcomes.push({
          providerMessageId,
          chatid: chat.chatid,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return {
    chatsScanned: scan.chatsScanned,
    truncated: scan.truncated,
    outcomes,
    inserted: outcomes.filter((o) => o.status === "inserted").length,
    alreadyExisted: outcomes.filter((o) => o.status === "already_existed").length,
    skippedUnparseable: outcomes.filter((o) => o.status === "skipped_unparseable").length,
    skippedNotIngested: outcomes.filter((o) => o.status === "skipped_not_ingested").length,
    errors: outcomes.filter((o) => o.status === "error").length,
  };
}
