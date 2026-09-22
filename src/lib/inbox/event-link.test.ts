import { describe, expect, it } from "vitest";

import { buildEventWhatsAppMessage, buildGoogleCalendarLink } from "./event-link";

describe("buildGoogleCalendarLink", () => {
  it("monta o link basico com 1h de duracao quando nao ha hora de fim", () => {
    const url = buildGoogleCalendarLink({
      title: "Reunião de pais",
      startLocal: "2026-09-25T14:00",
    });
    const parsed = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe(
      "https://calendar.google.com/calendar/render",
    );
    expect(parsed.searchParams.get("action")).toBe("TEMPLATE");
    expect(parsed.searchParams.get("text")).toBe("Reunião de pais");
    // 14:00 em America/Sao_Paulo (UTC-3 fixo, sem horario de verao desde
    // 2019) = 17:00 UTC. Sem hora de fim informada, dura 1h -> 18:00 UTC.
    expect(parsed.searchParams.get("dates")).toBe(
      "20260925T170000Z/20260925T180000Z",
    );
  });

  it("usa a hora de fim informada em vez do padrao de 1h", () => {
    const url = buildGoogleCalendarLink({
      title: "Reunião",
      startLocal: "2026-09-25T14:00",
      endLocal: "2026-09-25T16:30",
    });
    const parsed = new URL(url);

    expect(parsed.searchParams.get("dates")).toBe(
      "20260925T170000Z/20260925T193000Z",
    );
  });

  it("inclui location so quando informado", () => {
    const comLocal = new URL(
      buildGoogleCalendarLink({
        title: "Reunião",
        startLocal: "2026-09-25T14:00",
        location: "Instituto Emanuel",
      }),
    );
    expect(comLocal.searchParams.get("location")).toBe("Instituto Emanuel");

    const semLocal = new URL(
      buildGoogleCalendarLink({ title: "Reunião", startLocal: "2026-09-25T14:00" }),
    );
    expect(semLocal.searchParams.has("location")).toBe(false);
  });

  it("vira o dia em UTC quando o horario local perto da meia-noite exige", () => {
    const url = buildGoogleCalendarLink({
      title: "Plantão noturno",
      startLocal: "2026-09-25T22:00",
      endLocal: "2026-09-25T23:30",
    });
    const parsed = new URL(url);
    // 22:00 SP -> 01:00 UTC do dia seguinte; 23:30 SP -> 02:30 UTC do dia seguinte.
    expect(parsed.searchParams.get("dates")).toBe(
      "20260926T010000Z/20260926T023000Z",
    );
  });
});

describe("buildEventWhatsAppMessage", () => {
  it("formata titulo, data e hora em pt-BR", () => {
    const msg = buildEventWhatsAppMessage({
      title: "Reunião de pais",
      startLocal: "2026-09-25T14:00",
    });
    expect(msg).toContain("*Reunião de pais*");
    expect(msg).toContain("25/09/2026");
    expect(msg).toContain("14:00");
  });

  it("inclui uma linha de local so quando informado", () => {
    const comLocal = buildEventWhatsAppMessage({
      title: "Reunião",
      startLocal: "2026-09-25T14:00",
      location: "Instituto Emanuel",
    });
    expect(comLocal).toContain("Instituto Emanuel");

    const semLocal = buildEventWhatsAppMessage({
      title: "Reunião",
      startLocal: "2026-09-25T14:00",
    });
    expect(semLocal.toLowerCase()).not.toContain("local");
  });
});
