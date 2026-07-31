import { describe, expect, it } from "vitest";

import { decryptWhatsAppMedia } from "./media-crypto";

// Fixture gerado com a MESMA mediaKey capturada de um evento real de
// imagem (ver 2026-07-30, teste ao vivo contra o canal de homologação):
// o pipeline de derivação de chaves (HKDF-SHA256 + AES-256-CBC + HMAC)
// foi validado byte a byte contra a mídia real do WhatsApp antes deste
// teste existir — o conteúdo aqui é sintético só para não depender de
// rede nem de uma URL da CDN do WhatsApp, que expira.
const REAL_MEDIA_KEY = "PgLGliL1ck0OWKCtRIZhPFZLDfU/3jzzUS51hlG3mBM=";
const FIXTURE_PLAINTEXT =
  "fixture de teste — nao e uma imagem de verdade, so bytes conhecidos";
const FIXTURE_DOWNLOADED_BASE64 =
  "4Faa6wxtT7zaWmSTSv+cH6BYfsBZSe9mSwAJTeN+9maB4lJW4noBGE4rJ3FcljOHtv2fI9NJkeURfTT+wYGvqLoGW21pU4dK10u3Hx1Di7NvA+Do7MPIl/Lj";

describe("decryptWhatsAppMedia", () => {
  it("decripta mídia de imagem corretamente com a mediaKey real capturada", () => {
    const downloaded = Buffer.from(FIXTURE_DOWNLOADED_BASE64, "base64");
    const plaintext = decryptWhatsAppMedia(downloaded, REAL_MEDIA_KEY, "image");
    expect(plaintext.toString("utf8")).toBe(FIXTURE_PLAINTEXT);
  });

  it("rejeita quando o MAC não confere (mídia adulterada ou chave errada)", () => {
    const downloaded = Buffer.from(FIXTURE_DOWNLOADED_BASE64, "base64");
    downloaded[0] ^= 0xff; // corrompe o primeiro byte do ciphertext
    expect(() =>
      decryptWhatsAppMedia(downloaded, REAL_MEDIA_KEY, "image"),
    ).toThrow(/MAC/);
  });

  it("rejeita uma mediaKey de tamanho errado", () => {
    const downloaded = Buffer.from(FIXTURE_DOWNLOADED_BASE64, "base64");
    expect(() =>
      decryptWhatsAppMedia(downloaded, Buffer.from("curta demais").toString("base64"), "image"),
    ).toThrow(/mediaKey/);
  });

  it("rejeita mídia baixada menor que o MAC", () => {
    expect(() =>
      decryptWhatsAppMedia(Buffer.alloc(5), REAL_MEDIA_KEY, "image"),
    ).toThrow(/menor/);
  });
});
