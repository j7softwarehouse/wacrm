import { describe, expect, it } from "vitest";
import { resolveParticipantName } from "./participant-names";

describe("resolveParticipantName", () => {
  it("prioriza o nome salvo em Contatos sobre o nome do WhatsApp", () => {
    const contactNames = new Map([["553196897681", "Fulana da Escola"]]);
    const localNames = new Map([["553196897681", "Apelido do WhatsApp"]]);

    expect(resolveParticipantName("553196897681", contactNames, localNames)).toBe(
      "Fulana da Escola",
    );
  });

  it("casa o contato mesmo salvo sem o DDI 55", () => {
    // Contato salvo como "3196897681" (sem 55); o participante do
    // grupo vem da uazapi como "553196897681" (com 55). A busca usa as
    // variantes de brazilianPhoneLookupVariants, então tem que casar.
    const contactNames = new Map([["3196897681", "Fulana sem DDI"]]);
    const localNames = new Map<string, string>();

    expect(resolveParticipantName("553196897681", contactNames, localNames)).toBe(
      "Fulana sem DDI",
    );
  });

  it("casa o contato mesmo salvo com o nono dígito quando o participante veio sem", () => {
    const contactNames = new Map([["5531996897681", "Fulana com o 9"]]);
    const localNames = new Map<string, string>();

    expect(resolveParticipantName("553196897681", contactNames, localNames)).toBe(
      "Fulana com o 9",
    );
  });

  it("cai para o nome local do WhatsApp quando não há contato salvo", () => {
    const contactNames = new Map<string, string>();
    const localNames = new Map([["553196897681", "Apelido do WhatsApp"]]);

    expect(resolveParticipantName("553196897681", contactNames, localNames)).toBe(
      "Apelido do WhatsApp",
    );
  });

  it("cai para o telefone puro quando não há contato nem nome local", () => {
    const contactNames = new Map<string, string>();
    const localNames = new Map<string, string>();

    expect(resolveParticipantName("553196897681", contactNames, localNames)).toBe(
      "553196897681",
    );
  });

  it("não deixa um DDD diferente casar por coincidência dos 8 dígitos finais", () => {
    // "*** Vaga" (DDD 31) não pode aparecer pro participante que na
    // verdade é do DDD 27 — mesmo caso real de produção corrigido em
    // phonesMatch/brazilianPhoneLookupVariants.
    const contactNames = new Map([["553196897681", "*** Vaga (DDD errado)"]]);
    const localNames = new Map<string, string>();

    expect(resolveParticipantName("5527996897681", contactNames, localNames)).toBe(
      "5527996897681",
    );
  });
});
