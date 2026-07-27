import { describe, expect, it } from "vitest";
import {
  ProviderError,
  ProviderNotConnectedError,
  ProviderRateLimitError,
  ProviderUnsupportedError,
} from "./types";

describe("ProviderUnsupportedError", () => {
  it("nomeia a capacidade ausente e o provedor", () => {
    const err = new ProviderUnsupportedError("uazapi", "sendTemplate");
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.provider).toBe("uazapi");
    expect(err.capability).toBe("sendTemplate");
    expect(err.message).toContain("sendTemplate");
    expect(err.message).toContain("uazapi");
  });
});

describe("ProviderRateLimitError", () => {
  it("carrega o error_key e o código do provedor", () => {
    // O 463 do WhatsApp: a conta está temporariamente impedida de
    // iniciar novas conversas. Um broadcast que receba isso deve
    // parar, não repetir.
    const err = new ProviderRateLimitError("uazapi", {
      errorKey: "WHATSAPP_REACHOUT_TIMELOCK",
      providerCode: 463,
      providerMessage: "WhatsApp reported a temporary restriction.",
    });
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.errorKey).toBe("WHATSAPP_REACHOUT_TIMELOCK");
    expect(err.providerCode).toBe(463);
  });

  it("aceita ausência de detalhes do provedor", () => {
    const err = new ProviderRateLimitError("meta", {});
    expect(err.errorKey).toBeUndefined();
    expect(err.providerCode).toBeUndefined();
  });
});

describe("ProviderNotConnectedError", () => {
  it("identifica o canal para a UI conseguir apontar o problema", () => {
    const err = new ProviderNotConnectedError("uazapi", "chan-123", "hibernated");
    expect(err.channelId).toBe("chan-123");
    expect(err.status).toBe("hibernated");
  });
});
