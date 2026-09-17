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
  // da própria conta. Também ignoram o escopo de canal.
  it("admin e owner enxergam mesmo com os dois escopos 'assigned' e conversa/canal de outro", () => {
    expect(canSeeConversation("admin", "assigned", OTHER, ME, "assigned", false)).toBe(true);
    expect(canSeeConversation("owner", "assigned", OTHER, ME, "assigned", false)).toBe(true);
  });

  it.each<[AccountRole]>([["agent"], ["viewer"]])(
    "%s com os dois escopos 'all' enxerga qualquer conversa da conta",
    (role) => {
      expect(canSeeConversation(role, "all", OTHER, ME, "all", false)).toBe(true);
      expect(canSeeConversation(role, "all", null, ME, "all", false)).toBe(true);
    },
  );

  it.each<[AccountRole]>([["agent"], ["viewer"]])(
    "%s com escopo de conversa 'assigned' só enxerga a conversa atribuída a ele (canal 'all')",
    (role) => {
      expect(canSeeConversation(role, "assigned", ME, ME, "all", false)).toBe(true);
      expect(canSeeConversation(role, "assigned", OTHER, ME, "all", false)).toBe(false);
      // Conversa sem ninguém atribuído: também fica fora do alcance.
      expect(canSeeConversation(role, "assigned", null, ME, "all", false)).toBe(false);
    },
  );

  it.each<[AccountRole]>([["agent"], ["viewer"]])(
    "%s com escopo de canal 'assigned' só enxerga conversas do canal que atende (conversa 'all')",
    (role) => {
      expect(canSeeConversation(role, "all", OTHER, ME, "assigned", true)).toBe(true);
      expect(canSeeConversation(role, "all", OTHER, ME, "assigned", false)).toBe(false);
    },
  );

  it.each<[AccountRole]>([["agent"], ["viewer"]])(
    "%s com os dois escopos 'assigned' precisa passar nos dois ao mesmo tempo",
    (role) => {
      // Atribuída a ele E no canal que ele atende — passa.
      expect(canSeeConversation(role, "assigned", ME, ME, "assigned", true)).toBe(true);
      // Atribuída a ele, mas fora do canal que ele atende — bloqueado.
      expect(canSeeConversation(role, "assigned", ME, ME, "assigned", false)).toBe(false);
      // No canal certo, mas atribuída a outra pessoa — bloqueado.
      expect(canSeeConversation(role, "assigned", OTHER, ME, "assigned", true)).toBe(false);
    },
  );

  it("canal removido (isMemberOfChannel sempre false pra ele) fica fora do alcance de quem tem escopo de canal restrito", () => {
    // O chamador computa isMemberOfChannel a partir do channel_id da
    // conversa — um channel_id nulo nunca bate contra nenhuma
    // membership, então isMemberOfChannel chega aqui como false.
    expect(canSeeConversation("agent", "all", OTHER, ME, "assigned", false)).toBe(false);
  });
});

describe("canWriteConversation", () => {
  it("viewer nunca escreve, nenhum escopo", () => {
    expect(canWriteConversation("viewer", "all", ME, ME, "all", true)).toBe(false);
    expect(canWriteConversation("viewer", "assigned", ME, ME, "assigned", true)).toBe(false);
  });

  it("agent com os dois escopos 'all' escreve em qualquer conversa", () => {
    expect(canWriteConversation("agent", "all", OTHER, ME, "all", false)).toBe(true);
  });

  it("agent com escopo de conversa 'assigned' só escreve na própria conversa atribuída", () => {
    expect(canWriteConversation("agent", "assigned", ME, ME, "all", false)).toBe(true);
    expect(canWriteConversation("agent", "assigned", OTHER, ME, "all", false)).toBe(false);
    expect(canWriteConversation("agent", "assigned", null, ME, "all", false)).toBe(false);
  });

  it("agent com escopo de canal 'assigned' só escreve em conversas do canal que atende", () => {
    expect(canWriteConversation("agent", "all", OTHER, ME, "assigned", true)).toBe(true);
    expect(canWriteConversation("agent", "all", OTHER, ME, "assigned", false)).toBe(false);
  });

  it("admin e owner sempre escrevem, ignorando os dois escopos", () => {
    expect(canWriteConversation("admin", "assigned", OTHER, ME, "assigned", false)).toBe(true);
    expect(canWriteConversation("owner", "assigned", OTHER, ME, "assigned", false)).toBe(true);
  });
});

describe("canStartConversation", () => {
  // Iniciar (não responder) sempre exige escopo de conversa total —
  // quem é restrito responde, não inicia. Fecha o botão "Conversar" de
  // Contatos pelo lado da regra, não só pela tela.
  it("agent/admin/owner com os dois escopos 'all' pode iniciar", () => {
    expect(canStartConversation("agent", "all", "all", false)).toBe(true);
    expect(canStartConversation("admin", "all", "all", false)).toBe(true);
    expect(canStartConversation("owner", "all", "all", false)).toBe(true);
  });

  it("agent com escopo de conversa 'assigned' NÃO pode iniciar conversa nova", () => {
    expect(canStartConversation("agent", "assigned", "all", false)).toBe(false);
  });

  it("agent com escopo de canal 'assigned' só pode iniciar se tiver ao menos um canal permitido", () => {
    expect(canStartConversation("agent", "all", "assigned", true)).toBe(true);
    expect(canStartConversation("agent", "all", "assigned", false)).toBe(false);
  });

  it("admin/owner podem iniciar mesmo com os dois campos marcados 'assigned'", () => {
    expect(canStartConversation("admin", "assigned", "assigned", false)).toBe(true);
    expect(canStartConversation("owner", "assigned", "assigned", false)).toBe(true);
  });

  it("viewer nunca inicia, nenhum escopo", () => {
    expect(canStartConversation("viewer", "all", "all", true)).toBe(false);
    expect(canStartConversation("viewer", "assigned", "assigned", true)).toBe(false);
  });
});
