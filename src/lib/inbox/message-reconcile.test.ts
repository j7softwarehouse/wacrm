import { describe, expect, it } from "vitest";
import type { Message } from "@/types";
import { reconcileIncomingMessage } from "./message-reconcile";

function msg(overrides: Partial<Message>): Message {
  return {
    id: "id-base",
    conversation_id: "conv-1",
    sender_type: "agent",
    content_type: "text",
    status: "sent",
    created_at: "2026-09-25T10:00:00.000Z",
    ...overrides,
  };
}

describe("reconcileIncomingMessage", () => {
  it("acrescenta a mensagem quando não há nenhuma bolha otimista pendente", () => {
    const prev = [msg({ id: "real-1" })];
    const real = msg({ id: "real-2" });

    expect(reconcileIncomingMessage(prev, real)).toEqual([...prev, real]);
  });

  it("substitui só a bolha otimista mais antiga da mesma conversa (caso de 1 envio, comportamento de sempre)", () => {
    const prev = [msg({ id: "temp-1", status: "sending" })];
    const real = msg({ id: "real-1" });

    expect(reconcileIncomingMessage(prev, real)).toEqual([real]);
  });

  it("NÃO apaga as outras bolhas otimistas de um lote — só troca a mais antiga", () => {
    // Reprodução do bug: 3 fotos "enviando" ao mesmo tempo; a
    // confirmação da primeira não pode varrer as outras duas.
    const prev = [
      msg({ id: "temp-1", status: "sending" }),
      msg({ id: "temp-2", status: "sending" }),
      msg({ id: "temp-3", status: "sending" }),
    ];
    const real = msg({ id: "real-1" });

    expect(reconcileIncomingMessage(prev, real)).toEqual([
      real,
      msg({ id: "temp-2", status: "sending" }),
      msg({ id: "temp-3", status: "sending" }),
    ]);
  });

  it("preserva a posição da bolha trocada em vez de mover a mensagem para o fim", () => {
    const prev = [
      msg({ id: "real-0" }),
      msg({ id: "temp-1", status: "sending" }),
      msg({ id: "real-2" }),
    ];
    const real = msg({ id: "real-1" });

    expect(reconcileIncomingMessage(prev, real)).toEqual([
      msg({ id: "real-0" }),
      real,
      msg({ id: "real-2" }),
    ]);
  });

  it("ignora bolhas otimistas de OUTRA conversa", () => {
    const prev = [msg({ id: "temp-1", conversation_id: "conv-OUTRA", status: "sending" })];
    const real = msg({ id: "real-1", conversation_id: "conv-1" });

    expect(reconcileIncomingMessage(prev, real)).toEqual([
      msg({ id: "temp-1", conversation_id: "conv-OUTRA", status: "sending" }),
      real,
    ]);
  });

  it("é idempotente: evento repetido do realtime não duplica nem re-substitui", () => {
    const prev = [msg({ id: "real-1" }), msg({ id: "temp-2", status: "sending" })];
    const real = msg({ id: "real-1" });

    expect(reconcileIncomingMessage(prev, real)).toEqual(prev);
  });
});
