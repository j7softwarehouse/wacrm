import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { isAuthorizedCronRequest, cronSecret } from '@/lib/cron/auth'
import {
  purgeExpiredChatVideos,
  purgeExpiredOtherChatMedia,
  VIDEO_RETENTION_HOURS,
  OTHER_MEDIA_RETENTION_HOURS,
} from '@/lib/storage/purge-expired-video'

/**
 * Retenção de mídia do chat: apaga do bucket `chat-media` o que passou
 * da janela de cada tipo e zera o `media_url` da mensagem — vídeo em
 * 48h, foto/PDF/documento em 14 dias; áudio fica de fora, por decisão
 * do usuário (ver purge-expired-video.ts para o porquê: Storage Size
 * estourou o 1 GB do plano grátis em 20/10/2026 porque só vídeo tinha
 * retenção).
 *
 * O contato não perde nada — o WhatsApp guarda a própria cópia da mídia
 * entregue. Some apenas a reprodução dentro do CRM, que passa a exibir
 * "indisponível".
 *
 * Agendamento: `vercel.json` (diário). No plano Hobby a Vercel só
 * permite crons diárias, folgado para as duas janelas.
 */
export async function GET(request: Request) {
  const expected = cronSecret()
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  if (!isAuthorizedCronRequest(request, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = supabaseAdmin()
    const video = await purgeExpiredChatVideos(admin)
    const other = await purgeExpiredOtherChatMedia(admin)
    return NextResponse.json({
      video: { retention_hours: VIDEO_RETENTION_HOURS, ...video },
      other_media: { retention_hours: OTHER_MEDIA_RETENTION_HOURS, ...other },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[purge-media] varredura falhou:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
