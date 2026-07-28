import { describe, expect, it } from "vitest";
import { ProviderRateLimitError } from "@/lib/whatsapp/providers/types";
import { normalizeBaseUrl, parseUazapiError } from "./client";

describe("normalizeBaseUrl", () => {
  it("aceita o subdomínio puro e monta a URL completa", () => {
    expect(normalizeBaseUrl("minhaempresa")).toBe("https://minhaempresa.uazapi.com");
  });

  it("aceita a URL completa e a mantém", () => {
    expect(normalizeBaseUrl("https://minhaempresa.uazapi.com")).toBe(
      "https://minhaempresa.uazapi.com",
    );
  });

  it("remove a barra final — senão as URLs saem com barra dupla", () => {
    expect(normalizeBaseUrl("https://x.uazapi.com/")).toBe("https://x.uazapi.com");
  });

  it("força https: o token trafega no header e não pode ir em claro", () => {
    expect(normalizeBaseUrl("http://x.uazapi.com")).toBe("https://x.uazapi.com");
  });

  it("rejeita entrada vazia", () => {
    expect(() => normalizeBaseUrl("")).toThrow();
  });
});

describe("parseUazapiError", () => {
  it("reconhece o 463 do WhatsApp como limite de envio", () => {
    // A conta está temporariamente impedida de iniciar novas conversas.
    // Um broadcast que receba isso precisa PARAR — repetir queima a
    // reputação do número e escala para banimento.
    const body = {
      error: "WhatsApp server error 463: ...",
      error_source: "whatsapp_server",
      provider_code: 463,
      error_key: "WHATSAPP_REACHOUT_TIMELOCK",
      message_ptbr: "O servidor do WhatsApp recusou esta mensagem.",
      provider_message_ptbr:
        "O WhatsApp informou que a conta está sob restrição temporária.",
    };
    const err = parseUazapiError(500, body);
    expect(err).toBeInstanceOf(ProviderRateLimitError);
    const rate = err as ProviderRateLimitError;
    expect(rate.providerCode).toBe(463);
    expect(rate.errorKey).toBe("WHATSAPP_REACHOUT_TIMELOCK");
  });

  it("prefere a mensagem em português — este deployment roda em pt", () => {
    const err = parseUazapiError(500, {
      provider_code: 463,
      provider_message: "temporary restriction",
      provider_message_ptbr: "restrição temporária",
    }) as ProviderRateLimitError;
    expect(err.providerMessage).toBe("restrição temporária");
  });

  it("trata 401 como erro comum, não como limite", () => {
    const err = parseUazapiError(401, { error: "Invalid token" });
    expect(err).not.toBeInstanceOf(ProviderRateLimitError);
    expect(err.message).toContain("Invalid token");
  });

  it("não quebra com corpo inesperado", () => {
    const err = parseUazapiError(500, "erro em texto puro");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBeTruthy();
  });
});
