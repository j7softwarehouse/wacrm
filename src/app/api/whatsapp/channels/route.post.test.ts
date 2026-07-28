import { describe, expect, it } from "vitest";
import { generateWebhookSecret } from "./route";

describe("generateWebhookSecret", () => {
  it("gera um segredo longo o bastante para ser inadivinhável", () => {
    // Ele é a única autenticação do webhook de entrada: a UAZAPI não
    // assina o corpo como a Meta faz com HMAC.
    const secret = generateWebhookSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gera um valor diferente a cada chamada", () => {
    const secrets = new Set(
      Array.from({ length: 50 }, () => generateWebhookSecret()),
    );
    expect(secrets.size).toBe(50);
  });
});
