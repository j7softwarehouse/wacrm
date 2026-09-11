// ============================================================
// Provider UAZAPI.
//
// Traduz a interface do CRM para os endpoints da UAZAPI. Duas
// diferenças de vocabulário merecem atenção porque não são
// adivinháveis:
//   - a legenda de mídia vai em `text`, não em `caption`
//   - em /message/react o emoji vai em `text` e o alvo em `id`
// ============================================================

import { createUazapiClient } from "@/lib/whatsapp/uazapi/client";
import type { EncryptedMediaReference } from "@/lib/whatsapp/uazapi/normalize";
import {
  storeEncryptedInboundMedia,
  storeInboundMedia,
} from "@/lib/storage/store-inbound-media";

import {
  ProviderUnsupportedError,
  type CreateGroupArgs,
  type CreateGroupResult,
  type GroupParticipant,
  type SendInteractiveButtonsArgs,
  type SendInteractiveListArgs,
  type SendMediaArgs,
  type SendReactionArgs,
  type SendResult,
  type SendTextArgs,
  type UpdateGroupParticipantsArgs,
  type WhatsAppProvider,
} from "./types";

export interface UazapiProviderConfig {
  baseUrl: string;
  token: string;
  /** Necessário para gravar mídia recebida no bucket certo. */
  accountId: string;
}

/** A UAZAPI devolve `messageid`; o CRM usa `messageId`. */
interface UazapiSendResponse {
  messageid?: string;
  id?: string;
}

function toSendResult(response: UazapiSendResponse): SendResult {
  return { messageId: response.messageid ?? response.id ?? "" };
}

/**
 * Schema real de `GET /group/list` (Go/Baileys, PascalCase — confirmado
 * contra a instância j7softwarehouse.uazapi.com). Só os campos usados
 * no mapeamento estão listados; a resposta tem mais (Participants,
 * OwnerJID, ParticipantCount, ...) que o CRM ainda não consome.
 */
interface UazapiGroup {
  JID: string;
  Name?: string;
  Participants?: Array<{ JID?: string; PhoneNumber?: string; IsAdmin?: boolean }>;
}

interface UazapiGroupListResponse {
  groups: UazapiGroup[];
}

interface UazapiUpdateParticipantsResponse {
  groupUpdated?: Array<{
    PhoneNumber?: string;
    IsAdmin?: boolean;
    /** 0 = sucesso; qualquer outro valor = falha (ex.: 409 = já é participante). */
    Error: number;
    /**
     * Presente quando `action: "add"` não adiciona direto — o WhatsApp
     * manda um convite por causa da configuração de privacidade "quem
     * pode me adicionar a grupos" da pessoa. Vem com `Error: 403`, mas
     * não é uma falha de verdade: um convite foi enviado de fato.
     */
    AddRequest?: { Code?: string; Expiration?: string } | null;
  }>;
}

/**
 * Schema real de `POST /group/create` (mesmo formato de `Group` devolvido
 * por `/group/list`, com `Participants` incluindo `Error`/`AddRequest`
 * por pessoa — igual à resposta de `/group/updateParticipants`).
 */
interface UazapiCreateGroupResponse {
  JID: string;
  Name?: string;
  Participants?: Array<{
    PhoneNumber?: string;
    AddRequest?: { Code?: string; Expiration?: string } | null;
  }>;
}

export function createUazapiProvider(
  config: UazapiProviderConfig,
): WhatsAppProvider {
  const client = createUazapiClient({
    baseUrl: config.baseUrl,
    token: config.token,
  });

  return {
    kind: "uazapi",

    async sendText(args: SendTextArgs): Promise<SendResult> {
      const body: Record<string, unknown> = { number: args.to, text: args.text };
      if (args.contextMessageId) body.replyid = args.contextMessageId;
      return toSendResult(await client.post<UazapiSendResponse>("/send/text", body));
    },

    async sendMedia(args: SendMediaArgs): Promise<SendResult> {
      const body: Record<string, unknown> = {
        number: args.to,
        type: args.kind,
        file: args.link,
      };
      if (args.caption) body.text = args.caption;
      if (args.filename) body.docName = args.filename;
      if (args.contextMessageId) body.replyid = args.contextMessageId;
      return toSendResult(await client.post<UazapiSendResponse>("/send/media", body));
    },

    async sendInteractiveButtons(
      args: SendInteractiveButtonsArgs,
    ): Promise<SendResult> {
      // /send/menu recebe `choices` como títulos. O id estável dos
      // botões do CRM não tem equivalente: a resposta do cliente volta
      // em `buttonOrListid` com o título tocado, e é isso que a
      // normalização usa para casar com o botão.
      const body: Record<string, unknown> = {
        number: args.to,
        type: "button",
        text: args.bodyText,
        choices: args.buttons.map((b) => b.title),
      };
      if (args.footerText) body.footerText = args.footerText;
      if (args.contextMessageId) body.replyid = args.contextMessageId;
      return toSendResult(await client.post<UazapiSendResponse>("/send/menu", body));
    },

    async sendInteractiveList(args: SendInteractiveListArgs): Promise<SendResult> {
      const choices = args.sections.flatMap((section) =>
        section.rows.map((row) => row.title),
      );
      const body: Record<string, unknown> = {
        number: args.to,
        type: "list",
        text: args.bodyText,
        listButton: args.buttonLabel,
        choices,
      };
      if (args.footerText) body.footerText = args.footerText;
      if (args.contextMessageId) body.replyid = args.contextMessageId;
      return toSendResult(await client.post<UazapiSendResponse>("/send/menu", body));
    },

    async sendReaction(args: SendReactionArgs): Promise<SendResult> {
      return toSendResult(
        await client.post<UazapiSendResponse>("/message/react", {
          number: args.to,
          id: args.targetMessageId,
          text: args.emoji,
        }),
      );
    },

    async editMessage(args: { messageId: string; text: string }): Promise<void> {
      await client.post("/message/edit", { id: args.messageId, text: args.text });
    },

    async deleteMessage(args: { messageId: string }): Promise<void> {
      await client.post("/message/delete", { id: args.messageId });
    },

    async sendTemplate(): Promise<SendResult> {
      // Templates aprovados são um conceito exclusivo da Meta. A UI
      // esconde a funcionalidade em canais UAZAPI; isto é a rede de
      // proteção para um caminho que não deveria ser alcançável.
      throw new ProviderUnsupportedError("uazapi", "sendTemplate");
    },

    async resolveInboundMediaUrl(ref: string): Promise<string | null> {
      // O WhatsApp criptografa toda mídia ponta-a-ponta: `ref` é a
      // referência empacotada por `normalize.ts`
      // (`EncryptedMediaReference` — URL do CDN + mediaKey + tipo +
      // mimetype), nunca uma URL crua utilizável direto. Além disso,
      // URLs de mídia do WhatsApp expiram — guardar o link cru deixaria
      // o histórico quebrado em poucas horas de qualquer forma, então
      // baixamos, descriptografamos e guardamos no Storage uma vez.
      if (!ref) return null;

      let parsed: EncryptedMediaReference;
      try {
        parsed = JSON.parse(ref) as EncryptedMediaReference;
      } catch {
        // Não deveria acontecer — `normalize.ts` só produz o formato
        // empacotado — mas um `ref` que não é o JSON esperado degrada
        // pro caminho antigo (sem descriptografia) em vez de derrubar a
        // mensagem inteira.
        return storeInboundMedia(config.accountId, ref);
      }

      return storeEncryptedInboundMedia(
        config.accountId,
        parsed.url,
        parsed.mediaKey,
        parsed.mediaType,
        parsed.mimetype,
      );
    },

    async listGroups() {
      const response = await client.get<UazapiGroupListResponse>("/group/list");
      return response.groups.map((group) => ({
        groupJid: group.JID,
        name: group.Name,
        // O endpoint não devolve foto/avatar — não é uma lacuna do
        // mapeamento, é a API real.
        avatarUrl: undefined,
      }));
    },

    async createGroup(args: CreateGroupArgs): Promise<CreateGroupResult> {
      const response = await client.post<UazapiCreateGroupResponse>("/group/create", {
        name: args.name,
        participants: args.participantPhones,
      });
      // PhoneNumber do participante recebido vs. AddRequest presente —
      // mesma leitura de "convite em vez de adição direta" já usada em
      // updateGroupParticipants.
      const invitedPhones = (response.Participants ?? [])
        .filter((p) => p.AddRequest)
        .map((p) => p.PhoneNumber)
        .filter((phone): phone is string => !!phone);
      return {
        groupJid: response.JID,
        name: response.Name,
        invitedPhones,
      };
    },

    async leaveGroup(groupJid: string): Promise<void> {
      // Sem retorno útil — a UAZAPI responde "successful" mesmo se nada
      // mudou (confirmado empiricamente contra a instância real — ver
      // spec da Fase 3, seção 1). O chamador confirma via
      // listGroups()/getGroupParticipants() antes de considerar a
      // saída bem-sucedida.
      await client.post("/group/leave", { groupjid: groupJid });
    },

    async updateGroupParticipants(
      args: UpdateGroupParticipantsArgs,
    ): Promise<void> {
      const result = await client.post<UazapiUpdateParticipantsResponse>(
        "/group/updateParticipants",
        {
          groupjid: args.groupJid,
          action: args.action,
          participants: [args.phone],
        },
      );
      // HTTP 200 não significa sucesso — confirmado empiricamente: o
      // resultado real vem aninhado por telefone. Pega pelo ÍNDICE (um
      // telefone enviado -> uma entrada devolvida), não por valor: um
      // participante identificado só por JID @lid tem seu telefone
      // REAL resolvido na resposta (ex.: "5531...@s.whatsapp.net"),
      // que nunca bate com ".startsWith(jidEnviado)" quando o valor
      // enviado é o próprio "@lid" — confirmado empiricamente contra a
      // instância real ao remover um participante assim.
      const entry = result.groupUpdated?.[0];
      if (entry?.AddRequest) {
        // Não é uma falha de verdade: o WhatsApp mandou um convite em
        // vez de adicionar direto (configuração de privacidade "quem
        // pode me adicionar a grupos" da pessoa) — confirmado
        // empiricamente contra a instância real. Mensagem clara em vez
        // do "Error: 403" genérico, que confundia o usuário.
        throw new Error(
          `${args.phone} recebeu um convite para entrar no grupo (não foi adicionado direto porque a configuração de privacidade dele no WhatsApp exige aceitar o convite).`,
        );
      }
      if (!entry || entry.Error !== 0) {
        throw new Error(
          `uazapi recusou a ação "${args.action}" para ${args.phone} (Error: ${entry?.Error ?? "ausente"})`,
        );
      }
    },

    async updateGroupName(groupJid: string, name: string): Promise<void> {
      await client.post("/group/updateName", { groupjid: groupJid, name });
    },

    async getConnectedNumber(): Promise<string> {
      const status = await client.get<{ instance?: { owner?: string } }>(
        "/instance/status",
      );
      if (!status.instance?.owner) {
        throw new Error("uazapi não devolveu o número do WhatsApp conectado.");
      }
      return status.instance.owner;
    },

    async getGroupParticipants(
      groupJid: string,
    ): Promise<GroupParticipant[]> {
      // Mesmo endpoint de listGroups(), mas este método lê o campo
      // Participants que listGroups() descarta deliberadamente (ver
      // comentário em UazapiGroup) — método próprio para não misturar
      // responsabilidades com o contrato leve já testado de
      // listGroups().
      const response = await client.get<UazapiGroupListResponse>("/group/list");
      const group = response.groups.find((g) => g.JID === groupJid);
      if (!group) {
        throw new Error(`Grupo ${groupJid} não encontrado na lista da uazapi.`);
      }
      const mapped = (group.Participants ?? []).map((p) => ({
        // Participante identificado só por JID opaco (@lid, modo de
        // privacidade do WhatsApp) tem PhoneNumber vazio em
        // /group/list logo após ser adicionado — confirmado em
        // homolog. Sem o fallback pro JID, esse participante fica sem
        // identificador nenhum: não aparece na tela e não dá pra
        // remover/promover (updateParticipants aceita o JID @lid
        // completo como identificador, confirmado empiricamente).
        phoneNumber: p.PhoneNumber
          ? p.PhoneNumber.replace("@s.whatsapp.net", "")
          : (p.JID ?? ""),
        isAdmin: !!p.IsAdmin,
      }));
      // A uazapi às vezes devolve o MESMO participante duas vezes logo
      // após um "add" (confirmado repetindo a consulta contra a
      // instância real) — sem deduplicar, a tela mostra duas linhas
      // para a mesma pessoa, e remover pela primeira faz a segunda
      // falhar com "Error: 404" ao ser clicada (já não é mais
      // participante), parecendo um bug de remoção. Mantém a primeira
      // ocorrência de cada identificador.
      const seen = new Set<string>();
      return mapped.filter((p) => {
        if (seen.has(p.phoneNumber)) return false;
        seen.add(p.phoneNumber);
        return true;
      });
    },
  };
}
