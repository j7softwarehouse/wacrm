// ============================================================
// Retenção de vídeo do chat: 48h.
//
// Vídeo é a única mídia que chega a dezenas de MB, e o plano free do
// Supabase dá 1 GB de storage no total — a ~30 MB por arquivo, algumas
// dezenas de vídeos enchem a cota e o upload de TODA mídia passa a
// falhar. Esta varredura apaga o objeto do bucket `chat-media` depois
// de 48h e zera o `media_url` da mensagem.
//
// O contato não perde nada: o WhatsApp guarda a própria cópia
// criptografada da mídia entregue, então apagar o nosso arquivo não
// afeta o que ele recebeu — só a reprodução dentro do CRM. A bolha
// passa a renderizar "Vídeo indisponível" (`MediaUnavailable`), que já
// existe para mídia ausente; nenhuma mudança de UI é necessária.
//
// O bucket `flow-media` fica DE FORA de propósito: vídeo configurado
// num Fluxo é ativo permanente, reutilizado a cada execução, e apagá-lo
// quebraria o fluxo. Por isso a varredura filtra pelo caminho do
// `chat-media` em vez de confiar só no tipo da mensagem.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'chat-media';

/** Janela de retenção do vídeo no nosso storage, em horas. */
export const VIDEO_RETENTION_HOURS = 48;

/**
 * Teto por execução. A varredura roda uma vez ao dia; o limite existe
 * para a invocação não estourar o tempo da função num acúmulo grande
 * (uma migração de volume antiga, por exemplo). O que sobrar sai na
 * execução seguinte.
 */
const MAX_PER_RUN = 200;

/** Marcador que identifica uma URL pública do bucket `chat-media`. */
const CHAT_MEDIA_MARKER = `/object/public/${BUCKET}/`;

/**
 * Converte a URL pública de um objeto do `chat-media` no caminho que a
 * API de Storage espera (`account-<uuid>/<arquivo>`).
 *
 * Devolve `null` para qualquer coisa que não seja comprovadamente um
 * objeto desse bucket — URL externa (mídia enviada via API pública
 * apontando para fora), objeto do `flow-media`, ou entrada malformada.
 * É a trava que impede a retenção de apagar arquivo que não é nosso
 * para apagar.
 */
export function chatMediaPathFromPublicUrl(url: string): string | null {
  if (!url) return null;
  const marker = url.indexOf(CHAT_MEDIA_MARKER);
  if (marker === -1) return null;
  const path = url
    .slice(marker + CHAT_MEDIA_MARKER.length)
    .split('?')[0]
    .trim();
  return path.length > 0 ? path : null;
}

export interface PurgeResult {
  /** Mensagens cujo vídeo foi apagado e `media_url` zerado. */
  purged: number;
  /** Mensagens em que a remoção falhou; ficam para a próxima execução. */
  failed: number;
}

/**
 * Apaga os vídeos do chat com mais de `VIDEO_RETENTION_HOURS` e zera o
 * `media_url` das mensagens correspondentes.
 *
 * Idempotente sem coluna de controle: uma linha já purgada tem
 * `media_url` nulo e nunca é recapturada pela consulta.
 *
 * O `media_url` só é zerado DEPOIS de a remoção no Storage dar certo —
 * se zerássemos antes, uma falha no Storage deixaria o arquivo órfão
 * para sempre, sem nenhuma linha que o aponte.
 */
export async function purgeExpiredChatVideos(
  admin: SupabaseClient,
  now: Date = new Date(),
): Promise<PurgeResult> {
  const cutoff = new Date(
    now.getTime() - VIDEO_RETENTION_HOURS * 60 * 60 * 1000,
  ).toISOString();

  const { data: expired, error } = await admin
    .from('messages')
    .select('id, media_url')
    .eq('content_type', 'video')
    .not('media_url', 'is', null)
    // Restringe já na consulta ao nosso bucket, para uma URL externa não
    // voltar em toda execução sem nunca poder ser tratada.
    .like('media_url', `%${CHAT_MEDIA_MARKER}%`)
    .lt('created_at', cutoff)
    .limit(MAX_PER_RUN);

  if (error) throw new Error(`purge query failed: ${error.message}`);
  if (!expired || expired.length === 0) return { purged: 0, failed: 0 };

  let purged = 0;
  let failed = 0;

  for (const row of expired) {
    const path = chatMediaPathFromPublicUrl(row.media_url as string);
    if (!path) {
      failed += 1;
      continue;
    }

    const { error: rmError } = await admin.storage.from(BUCKET).remove([path]);
    if (rmError) {
      console.error(
        `[purge-video] falha ao remover ${path}: ${rmError.message}`,
      );
      failed += 1;
      continue;
    }

    // Só zera DEPOIS de o arquivo sair. Zerar antes deixaria um órfão no
    // bucket para sempre, sem nenhuma linha que o aponte.
    const { error: upError } = await admin
      .from('messages')
      .update({ media_url: null })
      .eq('id', row.id);

    if (upError) {
      // O arquivo já saiu; a linha ainda aponta para ele e volta na
      // próxima execução. `remove` de objeto ausente não é erro, então
      // a varredura converge.
      console.error(
        `[purge-video] arquivo removido mas media_url nao zerado (${row.id}): ${upError.message}`,
      );
      failed += 1;
      continue;
    }

    purged += 1;
  }

  return { purged, failed };
}
