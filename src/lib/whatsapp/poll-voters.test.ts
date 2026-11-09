import { describe, expect, it } from "vitest";
import { formatVoterLabel, groupVotersByOption } from "./poll-voters";

describe("formatVoterLabel", () => {
  it("usa o nome do contato quando existe", () => {
    expect(formatVoterLabel("Ramon -J7 tecnologia", "553183839660@s.whatsapp.net")).toBe(
      "Ramon -J7 tecnologia",
    );
  });
  it("cai para o telefone quando não há nome", () => {
    expect(formatVoterLabel(null, "553183839660@s.whatsapp.net")).toBe("+553183839660");
  });
  it("mostra Participante para @lid sem telefone", () => {
    expect(formatVoterLabel(" ", "192268724080890@lid")).toBe("Participante");
  });
});

describe("groupVotersByOption", () => {
  it("agrupa por opção, na ordem em que votaram, e ignora opção inexistente", () => {
    const votes = [
      { voter_jid: "2@s.whatsapp.net", voter_name: "Bia", options: ["Sexta"], voted_at: "2026-11-09T10:02:00Z" },
      { voter_jid: "1@s.whatsapp.net", voter_name: "Ana", options: ["Segunda", "Sexta"], voted_at: "2026-11-09T10:01:00Z" },
      { voter_jid: "3@s.whatsapp.net", voter_name: null, options: ["Domingo"], voted_at: "2026-11-09T10:03:00Z" },
    ];
    expect(groupVotersByOption(["Segunda", "Sexta"], votes)).toEqual({
      Segunda: ["Ana"],
      Sexta: ["Ana", "Bia"],
    });
  });
});
