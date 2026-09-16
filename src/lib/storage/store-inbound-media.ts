// ============================================================
// Baixa uma mídia recebida e a guarda no bucket `chat-media`.
//
// Existe separado de `upload-media.ts` porque aquele módulo roda no
// cliente (resolve a conta pela sessão do navegador). Aqui não há
// sessão: o chamador é o webhook, então usamos o service-role e
// recebemos o `accountId` explicitamente.
// ============================================================

import { createClient } from "@supabase/supabase-js";

import { isDeliverableUrl } from "@/lib/webhooks/ssrf";
import {
  decryptWhatsAppMedia,
  type WhatsAppMediaType,
} from "@/lib/whatsapp/uazapi/media-crypto";

import { buildMediaPath } from "./upload-media";

const BUCKET = "chat-media";

/**
 * Teto de segurança: mídia recebida não pode encher o bucket. Acompanha
 * o teto de envio (30 MB) para que um vídeo que o contato consegue
 * mandar pelo WhatsApp também caiba aqui — senão ele chegaria na
 * conversa como "indisponível". A retenção de 48h
 * (`/api/media/cron`) é o que segura a cota de storage.
 */
const MAX_INBOUND_BYTES = 30 * 1024 * 1024;

/**
 * `allowed_mime_types` do bucket `chat-media` faz correspondência
 * EXATA (migração 023). O WhatsApp manda nota de voz como
 * `audio/ogg; codecs=opus` — o tipo base (`audio/ogg`) está na lista,
 * mas com o parâmetro sobrando o Storage recusa o upload inteiro,
 * silenciosamente (o erro só aparece no log do servidor, nunca na UI).
 * Mesma armadilha vale para qualquer `Content-Type` com parâmetro
 * (`; charset=`, `; boundary=`), então a limpeza é geral, não só para
 * áudio.
 */
export function stripMimeTypeParams(contentType: string): string {
  return contentType.split(";")[0]?.trim() || contentType;
}

/**
 * `sourceUrl` vem de um evento de webhook — ou seja, de quem quer que
 * conheça o `webhook_secret` do canal, o que inclui TODO tenant para o
 * próprio canal (a URL completa é exibida na UI de canais). Sem
 * validação isto seria um SSRF com exfiltração embutida: o atacante
 * aponta a URL para um serviço interno (o endpoint de metadados da
 * nuvem, por exemplo), nós baixamos com a rede do servidor e
 * republicamos os bytes num bucket PÚBLICO, cuja URL esta função
 * devolve.
 *
 * Duas barreiras: só https (o token/o conteúdo não podem trafegar em
 * claro) e host que resolva exclusivamente para IP público —
 * `isDeliverableUrl` faz a resolução DNS de verdade, porque conferir só
 * a string do hostname não impede um nome que aponte para 127.0.0.1.
 */
async function isSafeMediaSource(rawUrl: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return isDeliverableUrl(rawUrl);
}

/** Redirecionamentos seguidos manualmente (ver `fetchValidated`). */
const MAX_REDIRECTS = 3;

/**
 * `fetch` com validação em CADA salto.
 *
 * `redirect: "manual"` é obrigatório: com o follow automático, uma URL
 * pública aprovada acima poderia responder 302 para `127.0.0.1` e o
 * runtime seguiria sem passar pela validação de novo — a checagem
 * inicial viraria decoração. Seguir à mão, revalidando o `Location`,
 * mantém a garantia sem quebrar CDNs que legitimamente redirecionam.
 */
async function fetchValidated(url: string): Promise<Response | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await isSafeMediaSource(current))) {
      console.warn(
        "[store-inbound-media] URL de origem recusada (esquema ou destino não público)",
      );
      return null;
    }

    const response = await fetch(current, {
      signal: AbortSignal.timeout(30_000),
      redirect: "manual",
    });

    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    try {
      current = new URL(location, current).toString();
    } catch {
      return null;
    }
  }
  console.warn("[store-inbound-media] redirecionamentos demais");
  return null;
}

/** Sobe bytes já prontos (decifrados, se for o caso) pro bucket público. */
async function uploadBytes(
  accountId: string,
  bytes: Uint8Array,
  filename: string,
  contentType: string,
): Promise<string | null> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_INBOUND_BYTES) {
    console.warn(
      `[store-inbound-media] tamanho fora do aceitável: ${bytes.byteLength} bytes`,
    );
    return null;
  }

  // `buildMediaPath` já produz o caminho `account-<id>/…` que as
  // políticas RLS do bucket esperam (migração 023).
  const path = buildMediaPath(accountId, filename);

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType: stripMimeTypeParams(contentType),
    upsert: false,
    cacheControl: "3600",
  });
  if (error) {
    console.error("[store-inbound-media] upload falhou:", error.message);
    return null;
  }

  const {
    data: { publicUrl },
  } = admin.storage.from(BUCKET).getPublicUrl(path);
  return publicUrl;
}

/** Mídia já em texto claro na origem — sem chave, sem descriptografia. */
export async function storeInboundMedia(
  accountId: string,
  sourceUrl: string,
): Promise<string | null> {
  try {
    const response = await fetchValidated(sourceUrl);
    if (!response || !response.ok) return null;

    const bytes = new Uint8Array(await response.arrayBuffer());
    const contentType =
      response.headers.get("content-type") ?? "application/octet-stream";
    const filename = new URL(sourceUrl).pathname.split("/").pop() || "media";

    return await uploadBytes(accountId, bytes, filename, contentType);
  } catch (err) {
    console.error(
      "[store-inbound-media] erro ao baixar mídia:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Mídia do WhatsApp: o CDN (`encryptedUrl`) serve o arquivo CIFRADO — o
 * WhatsApp criptografa toda mídia ponta-a-ponta. Baixa, descriptografa
 * com a `mediaKey` do próprio evento (ver `media-crypto.ts`) e só então
 * guarda no Storage. Um MAC que não confere é tratado como qualquer
 * outra falha de mídia: loga e devolve `null`, nunca lança — a mensagem
 * (texto incluído) já foi confirmada ao provedor antes deste ponto.
 */
export async function storeEncryptedInboundMedia(
  accountId: string,
  encryptedUrl: string,
  mediaKeyBase64: string,
  mediaType: WhatsAppMediaType,
  mimetype: string,
): Promise<string | null> {
  try {
    const response = await fetchValidated(encryptedUrl);
    if (!response || !response.ok) return null;

    const encrypted = new Uint8Array(await response.arrayBuffer());
    const plaintext = decryptWhatsAppMedia(encrypted, mediaKeyBase64, mediaType);

    const ext = stripMimeTypeParams(mimetype).split("/")[1] || "bin";
    return await uploadBytes(accountId, plaintext, `media.${ext}`, mimetype);
  } catch (err) {
    console.error(
      "[store-inbound-media] erro ao descriptografar mídia:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
