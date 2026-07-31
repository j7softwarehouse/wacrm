import crypto from "node:crypto";

// ============================================================
// Descriptografia de mídia recebida do WhatsApp.
//
// O WhatsApp criptografa TODA mídia ponta-a-ponta. O evento de webhook
// da UAZAPI entrega `message.content.URL` (o CDN, ex.: mmg.whatsapp.net)
// e `message.content.mediaKey` (base64, 32 bytes) — mas os bytes que a
// URL serve são o ciphertext, não a imagem/vídeo/áudio em si.
//
// O esquema (confirmado byte a byte contra um evento real capturado em
// 2026-07-30 — o MAC bateu e o resultado começou com FF D8 FF, magic
// bytes de JPEG) é o mesmo usado por toda a comunidade de bibliotecas
// não-oficiais do WhatsApp (Baileys, whatsmeow etc.):
//
//   1. mediaKey (32 bytes) expande via HKDF-SHA256 (salt = 32 bytes
//      zerados, info = string específica do tipo de mídia) em 112
//      bytes: IV (16) + chave AES (32) + chave de MAC (32) + refKey
//      (32, não usada aqui).
//   2. O download é `ciphertext || mac`, onde os últimos 10 bytes são
//      HMAC-SHA256(IV || ciphertext, macKey) truncado.
//   3. O ciphertext decripta com AES-256-CBC usando a chave e o IV
//      derivados.
// ============================================================

export type WhatsAppMediaType = "image" | "video" | "audio" | "document" | "sticker";

// Sticker é WebP mas usa a mesma derivação de chave de imagem — é assim
// que o próprio protocolo do WhatsApp trata (herda de imageMessage).
const MEDIA_KEY_INFO: Record<WhatsAppMediaType, string> = {
  image: "WhatsApp Image Keys",
  video: "WhatsApp Video Keys",
  audio: "WhatsApp Audio Keys",
  document: "WhatsApp Document Keys",
  sticker: "WhatsApp Image Keys",
};

const HKDF_SALT = Buffer.alloc(32);
const MAC_LENGTH = 10;
const MEDIA_KEY_LENGTH = 32;

/** HKDF-SHA256 (RFC 5869), etapa de expansão. */
function hkdfExpand(prk: Buffer, length: number, info: string): Buffer {
  const infoBuf = Buffer.from(info, "utf8");
  let t = Buffer.alloc(0);
  let okm = Buffer.alloc(0);
  let counter = 1;
  while (okm.length < length) {
    t = crypto
      .createHmac("sha256", prk)
      .update(Buffer.concat([t, infoBuf, Buffer.from([counter])]))
      .digest();
    okm = Buffer.concat([okm, t]);
    counter += 1;
  }
  return okm.subarray(0, length);
}

function deriveMediaKeys(mediaKey: Buffer, mediaType: WhatsAppMediaType) {
  const prk = crypto.createHmac("sha256", HKDF_SALT).update(mediaKey).digest();
  const expanded = hkdfExpand(prk, 112, MEDIA_KEY_INFO[mediaType]);
  return {
    iv: expanded.subarray(0, 16),
    cipherKey: expanded.subarray(16, 48),
    macKey: expanded.subarray(48, 80),
  };
}

/**
 * Decripta um arquivo de mídia baixado do CDN do WhatsApp.
 *
 * Lança se a `mediaKey` tiver tamanho errado, se os bytes baixados
 * forem curtos demais para conter o MAC, ou se o MAC não conferir
 * (mídia corrompida ou chave incompatível) — nunca devolve bytes sem
 * verificar a integridade primeiro.
 */
export function decryptWhatsAppMedia(
  downloaded: Uint8Array,
  mediaKeyBase64: string,
  mediaType: WhatsAppMediaType,
): Buffer {
  const mediaKey = Buffer.from(mediaKeyBase64, "base64");
  if (mediaKey.length !== MEDIA_KEY_LENGTH) {
    throw new Error(
      `mediaKey com tamanho inesperado: ${mediaKey.length} bytes (esperado ${MEDIA_KEY_LENGTH})`,
    );
  }

  const buf = Buffer.from(downloaded);
  if (buf.length <= MAC_LENGTH) {
    throw new Error("mídia baixada menor que o MAC esperado");
  }

  const { iv, cipherKey, macKey } = deriveMediaKeys(mediaKey, mediaType);

  const ciphertext = buf.subarray(0, buf.length - MAC_LENGTH);
  const mac = buf.subarray(buf.length - MAC_LENGTH);

  const expectedMac = crypto
    .createHmac("sha256", macKey)
    .update(Buffer.concat([iv, ciphertext]))
    .digest()
    .subarray(0, MAC_LENGTH);

  if (!crypto.timingSafeEqual(mac, expectedMac)) {
    throw new Error("MAC da mídia não confere — possível corrupção ou chave errada");
  }

  const decipher = crypto.createDecipheriv("aes-256-cbc", cipherKey, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
