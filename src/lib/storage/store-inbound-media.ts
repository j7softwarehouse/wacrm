// ============================================================
// Baixa uma mídia recebida e a guarda no bucket `chat-media`.
//
// Existe separado de `upload-media.ts` porque aquele módulo roda no
// cliente (resolve a conta pela sessão do navegador). Aqui não há
// sessão: o chamador é o webhook, então usamos o service-role e
// recebemos o `accountId` explicitamente.
// ============================================================

import { createClient } from "@supabase/supabase-js";

import { buildMediaPath } from "./upload-media";

const BUCKET = "chat-media";

/** Teto de segurança: mídia recebida não pode encher o bucket. */
const MAX_INBOUND_BYTES = 16 * 1024 * 1024;

export async function storeInboundMedia(
  accountId: string,
  sourceUrl: string,
): Promise<string | null> {
  try {
    const response = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return null;

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_INBOUND_BYTES) {
      console.warn(
        `[store-inbound-media] tamanho fora do aceitável: ${bytes.byteLength} bytes`,
      );
      return null;
    }

    const contentType =
      response.headers.get("content-type") ?? "application/octet-stream";

    // `buildMediaPath` já produz o caminho `account-<id>/…` que as
    // políticas RLS do bucket esperam (migração 023).
    const filename = new URL(sourceUrl).pathname.split("/").pop() || "media";
    const path = buildMediaPath(accountId, filename);

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { error } = await admin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType, upsert: false, cacheControl: "3600" });
    if (error) {
      console.error("[store-inbound-media] upload falhou:", error.message);
      return null;
    }

    const {
      data: { publicUrl },
    } = admin.storage.from(BUCKET).getPublicUrl(path);
    return publicUrl;
  } catch (err) {
    console.error(
      "[store-inbound-media] erro ao baixar mídia:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
