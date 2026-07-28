import { describe, expect, it } from "vitest";
import { toPublicChannel } from "./route";

const rowCompleta = {
  id: "chan-1",
  account_id: "acc-1",
  user_id: "user-1",
  provider: "uazapi" as const,
  label: "Recepção",
  phone_e164: "5511999999999",
  status: "connected" as const,
  connected_at: "2026-07-27T12:00:00Z",
  last_error: undefined,
  access_token: "ciphertext-meta",
  verify_token: "ciphertext-verify",
  uazapi_token: "ciphertext-uazapi",
  uazapi_base_url: "https://x.uazapi.com",
  webhook_secret: "segredo-do-webhook",
  // Não-secretos: identificadores/metadados de registro da Meta que a
  // UI de configurações exibe ao admin.
  phone_number_id: "1002345678901",
  waba_id: "1009876543210",
  registered_at: "2026-07-20T09:00:00Z",
  last_registration_error: "some previous error",
};

describe("toPublicChannel", () => {
  it("expõe os campos que a UI precisa", () => {
    expect(toPublicChannel(rowCompleta)).toEqual({
      id: "chan-1",
      provider: "uazapi",
      label: "Recepção",
      phone_e164: "5511999999999",
      status: "connected",
      connected_at: "2026-07-27T12:00:00Z",
      last_error: undefined,
      phone_number_id: "1002345678901",
      waba_id: "1009876543210",
      registered_at: "2026-07-20T09:00:00Z",
      last_registration_error: "some previous error",
    });
  });

  it("não vaza nenhum campo sensível", () => {
    // Antes desta mudança a UI lia a tabela direto do browser e
    // recebia as colunas de token — criptografadas, mas ainda assim.
    // Com N canais isso multiplicaria.
    const serialized = JSON.stringify(toPublicChannel(rowCompleta));
    expect(serialized).not.toContain("ciphertext");
    expect(serialized).not.toContain("segredo-do-webhook");
    expect(serialized).not.toContain("uazapi.com");
  });
});
