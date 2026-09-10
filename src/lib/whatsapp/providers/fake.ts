// ============================================================
// Provider em memória para testes.
//
// Existe para que send-message, broadcasts e flows possam ser
// testados sem mockar `fetch` — que é como os testes atuais sofrem.
// ============================================================

import type {
  GroupParticipant,
  SendInteractiveButtonsArgs,
  SendInteractiveListArgs,
  SendMediaArgs,
  SendReactionArgs,
  SendResult,
  SendTemplateArgs,
  SendTextArgs,
  UpdateGroupParticipantsArgs,
  WhatsAppProvider,
} from "./types";

export interface FakeCall {
  method: string;
  args: unknown;
}

export interface FakeProvider extends WhatsAppProvider {
  /** Toda chamada recebida, em ordem. */
  readonly calls: FakeCall[];
}

export interface FakeProviderOptions {
  /** Id devolvido por qualquer envio. Default: "fake-message-id". */
  messageId?: string;
  /** Se definido, todo envio rejeita com este erro. */
  failWith?: Error;
}

export function createFakeProvider(
  options: FakeProviderOptions = {},
): FakeProvider {
  const { messageId = "fake-message-id", failWith } = options;
  const calls: FakeCall[] = [];

  const record = async (method: string, args: unknown): Promise<SendResult> => {
    calls.push({ method, args });
    if (failWith) throw failWith;
    return { messageId };
  };

  return {
    kind: "meta",
    calls,
    sendText: (args: SendTextArgs) => record("sendText", args),
    sendMedia: (args: SendMediaArgs) => record("sendMedia", args),
    sendInteractiveButtons: (args: SendInteractiveButtonsArgs) =>
      record("sendInteractiveButtons", args),
    sendInteractiveList: (args: SendInteractiveListArgs) =>
      record("sendInteractiveList", args),
    sendReaction: (args: SendReactionArgs) => record("sendReaction", args),
    sendTemplate: (args: SendTemplateArgs) => record("sendTemplate", args),
    async resolveInboundMediaUrl(ref: string) {
      calls.push({ method: "resolveInboundMediaUrl", args: ref });
      return `/fake-media/${ref}`;
    },
    async listGroups() {
      calls.push({ method: "listGroups", args: undefined });
      return [{ groupJid: "1111@g.us", name: "Grupo Fake" }];
    },
    async leaveGroup(groupJid: string) {
      calls.push({ method: "leaveGroup", args: groupJid });
    },
    async updateGroupParticipants(args: UpdateGroupParticipantsArgs) {
      calls.push({ method: "updateGroupParticipants", args });
    },
    async updateGroupName(groupJid: string, name: string) {
      calls.push({ method: "updateGroupName", args: { groupJid, name } });
    },
    async getConnectedNumber() {
      calls.push({ method: "getConnectedNumber", args: undefined });
      return "5511999999999";
    },
    async getGroupParticipants(groupJid: string): Promise<GroupParticipant[]> {
      calls.push({ method: "getGroupParticipants", args: groupJid });
      return [{ phoneNumber: "5511999999999", isAdmin: true }];
    },
  };
}
