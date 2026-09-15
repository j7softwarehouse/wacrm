import { describe, expect, it } from "vitest";
import {
  canSeeConversation,
  canStartConversation,
  canWriteConversation,
  isConversationScope,
} from "./conversation-scope";
import type { AccountRole } from "./roles";

const ME = "user-1";
const OTHER = "user-2";

describe("isConversationScope", () => {
  it("aceita 'all' e 'assigned'", () => {
    expect(isConversationScope("all")).toBe(true);
    expect(isConversationScope("assigned")).toBe(true);
  });

  it("rejeita qualquer outro valor", () => {
    expect(isConversationScope("restricted")).toBe(false);
    expect(isConversationScope("")).toBe(false);
    expect(isConversationScope(null)).toBe(false);
    expect(isConversationScope(undefined)).toBe(false);
  });
});

describe("canSeeConversation", () => {
  // admin/owner sempre enxergam tudo, escopo é ignorado de propósito —
  // um admin marcado como restrito por engano não pode se trancar fora
  // da própria conta.
  it("admin e owner enxergam mesmo com escopo 'assigned' e conversa de outro", () => {
    expect(canSeeConversation("admin", "assigned", OTHER, ME)).toBe(true);
    expect(canSeeConversation("owner", "assigned", OTHER, ME)).toBe(true);
  });

  it.each<[AccountRole]>([["agent"], ["viewer"]])(
    "%s com escopo 'all' enxerga qualquer conversa da conta",
    (role) => {
      expect(canSeeConversation(role, "all", OTHER, ME)).toBe(true);
      expect(canSeeConversation(role, "all", null, ME)).toBe(true);
    },
  );

  it.each<[AccountRole]>([["agent"], ["viewer"]])(
    "%s com escopo 'assigned' só enxerga a conversa atribuída a ele",
    (role) => {
      expect(canSeeConversation(role, "assigned", ME, ME)).toBe(true);
      expect(canSeeConversation(role, "assigned", OTHER, ME)).toBe(false);
      // Conversa sem ninguém atribuído: também fica fora do alcance.
      expect(canSeeConversation(role, "assigned", null, ME)).toBe(false);
    },
  );
});

describe("canWriteConversation", () => {
  it("viewer nunca escreve, nenhum escopo", () => {
    expect(canWriteConversation("viewer", "all", ME, ME)).toBe(false);
    expect(canWriteConversation("viewer", "assigned", ME, ME)).toBe(false);
  });

  it("agent com escopo 'all' escreve em qualquer conversa", () => {
    expect(canWriteConversation("agent", "all", OTHER, ME)).toBe(true);
  });

  it("agent com escopo 'assigned' só escreve na própria conversa atribuída", () => {
    expect(canWriteConversation("agent", "assigned", ME, ME)).toBe(true);
    expect(canWriteConversation("agent", "assigned", OTHER, ME)).toBe(false);
    expect(canWriteConversation("agent", "assigned", null, ME)).toBe(false);
  });

  it("admin e owner sempre escrevem, ignorando o escopo", () => {
    expect(canWriteConversation("admin", "assigned", OTHER, ME)).toBe(true);
    expect(canWriteConversation("owner", "assigned", OTHER, ME)).toBe(true);
  });
});

describe("canStartConversation", () => {
  // Iniciar (não responder) sempre exige escopo total — quem é
  // restrito responde, não inicia. Fecha o botão "Conversar" de
  // Contatos pelo lado da regra, não só pela tela.
  it("agent/admin/owner com escopo 'all' pode iniciar", () => {
    expect(canStartConversation("agent", "all")).toBe(true);
    expect(canStartConversation("admin", "all")).toBe(true);
    expect(canStartConversation("owner", "all")).toBe(true);
  });

  it("agent com escopo 'assigned' NÃO pode iniciar conversa nova", () => {
    expect(canStartConversation("agent", "assigned")).toBe(false);
  });

  it("admin/owner podem iniciar mesmo com o campo marcado 'assigned'", () => {
    expect(canStartConversation("admin", "assigned")).toBe(true);
    expect(canStartConversation("owner", "assigned")).toBe(true);
  });

  it("viewer nunca inicia, nenhum escopo", () => {
    expect(canStartConversation("viewer", "all")).toBe(false);
    expect(canStartConversation("viewer", "assigned")).toBe(false);
  });
});
