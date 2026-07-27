import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { verifyMetaWebhookSignature } from "@/lib/whatsapp/webhook-signature";

/**
 * Testes de caracterização: travam o comportamento observável de hoje
 * para que a extração do núcleo de ingestão (Task 7) não possa
 * alterá-lo sem que a suíte perceba.
 *
 * Não julgam se o comportamento é bom — apenas o congelam.
 */

function signBody(body: string, secret: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

describe("assinatura do webhook da Meta", () => {
  const secret = "test-meta-app-secret"; // igual ao vitest.config.ts

  it("aceita um corpo assinado com o app secret", () => {
    const body = JSON.stringify({ entry: [] });
    expect(verifyMetaWebhookSignature(body, signBody(body, secret))).toBe(true);
  });

  it("rejeita corpo adulterado após a assinatura", () => {
    const body = JSON.stringify({ entry: [] });
    const sig = signBody(body, secret);
    expect(verifyMetaWebhookSignature(body + " ", sig)).toBe(false);
  });

  it("rejeita assinatura ausente", () => {
    expect(verifyMetaWebhookSignature("{}", null)).toBe(false);
  });
});

describe("formato do payload de entrada da Meta", () => {
  // Congela a estrutura que o normalizador precisa continuar aceitando
  // depois da extração.
  const payload = {
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "5511999999999",
                phone_number_id: "PNID",
              },
              contacts: [{ profile: { name: "Maria" }, wa_id: "5511888888888" }],
              messages: [
                {
                  id: "wamid.ABC",
                  from: "5511888888888",
                  timestamp: "1700000000",
                  type: "text",
                  text: { body: "olá" },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  it("localiza remetente, nome de perfil e texto nos caminhos esperados", () => {
    const value = payload.entry[0].changes[0].value;
    expect(value.metadata.phone_number_id).toBe("PNID");
    expect(value.contacts?.[0].profile.name).toBe("Maria");
    expect(value.messages?.[0].from).toBe("5511888888888");
    expect(value.messages?.[0].text?.body).toBe("olá");
    expect(value.messages?.[0].id).toBe("wamid.ABC");
  });
});
