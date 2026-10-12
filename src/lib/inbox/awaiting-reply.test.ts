import { describe, expect, it } from "vitest";

import {
  AWAITING_REPLY_FETCH_MS,
  AWAITING_REPLY_RECOMPUTE_MS,
  buildAwaitingReplyMap,
  type AwaitingReplyItem,
} from "./awaiting-reply";

// A RPC conversations_awaiting_reply devolve uma linha por conversa
// aberta (~900 em produção, 124 KB por chamada) — buscada a cada 60 s
// em toda Inbox aberta, era o maior gasto de egress do Supabase. Agora
// a busca é espaçada e o selo é recalculado localmente; o que impede o
// selo de ficar velho entre uma busca e outra é a lista de conversas
// (atualizada em tempo real) dizer que já chegou mensagem mais nova.

const NOW = new Date("2026-10-13T15:00:00.000Z");
// Mais de 7 dias corridos antes de NOW: isAwaitingReply devolve true
// direto, sem depender do cálculo de minutos de expediente.
const OLD = "2026-10-01T12:00:00.000Z";

const row = (over: Partial<AwaitingReplyItem> = {}): AwaitingReplyItem => ({
  conversation_id: "c1",
  last_message_at: OLD,
  last_sender_type: "customer",
  ...over,
});

describe("buildAwaitingReplyMap", () => {
  it("inclui conversa cuja última mensagem é do cliente e passou do limite", () => {
    const map = buildAwaitingReplyMap([row()], new Map(), NOW);
    expect([...map.keys()]).toEqual(["c1"]);
    expect(map.get("c1")?.last_message_at).toBe(OLD);
  });

  it("exclui conversa cuja última mensagem é do atendente", () => {
    const map = buildAwaitingReplyMap([row({ last_sender_type: "agent" })], new Map(), NOW);
    expect(map.size).toBe(0);
  });

  it("exclui quando a lista em tempo real já tem mensagem mais nova que a da RPC (respondida ou relógio reiniciado)", () => {
    const lastMessageAt = new Map([["c1", "2026-10-13T14:59:00.000Z"]]);
    const map = buildAwaitingReplyMap([row()], lastMessageAt, NOW);
    expect(map.size).toBe(0);
  });

  it("mantém quando a lista tem o MESMO instante da RPC (é a própria mensagem do cliente)", () => {
    const lastMessageAt = new Map([["c1", OLD]]);
    const map = buildAwaitingReplyMap([row()], lastMessageAt, NOW);
    expect(map.has("c1")).toBe(true);
  });

  it("mantém quando a conversa não está na lista carregada ou não tem last_message_at", () => {
    const lastMessageAt = new Map<string, string | null>([["c2", null]]);
    const map = buildAwaitingReplyMap(
      [row(), row({ conversation_id: "c2" })],
      lastMessageAt,
      NOW,
    );
    expect([...map.keys()].sort()).toEqual(["c1", "c2"]);
  });
});

describe("cadência", () => {
  it("busca no banco a cada 5 minutos e recalcula localmente a cada minuto", () => {
    expect(AWAITING_REPLY_FETCH_MS).toBe(5 * 60_000);
    expect(AWAITING_REPLY_RECOMPUTE_MS).toBe(60_000);
  });
});
