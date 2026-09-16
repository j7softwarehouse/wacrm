import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { isAuthorizedCronRequest, cronSecret } from '@/lib/cron/auth'
import {
  purgeExpiredChatVideos,
  VIDEO_RETENTION_HOURS,
} from '@/lib/storage/purge-expired-video'

/**
 * Retenção de vídeo do chat: apaga do bucket `chat-media` os vídeos com
 * mais de 48h e zera o `media_url` da mensagem.
 *
 * O plano free do Supabase dá 1 GB de storage no total; a até 30 MB por
 * vídeo, algumas dezenas de arquivos enchem a cota e o upload de TODA
 * mídia passa a falhar silenciosamente. Esta varredura é o que mantém
 * o limite de 30 MB sustentável.
 *
 * O contato não perde nada — o WhatsApp guarda a própria cópia da mídia
 * entregue. Some apenas a reprodução dentro do CRM, que passa a exibir
 * "Vídeo indisponível".
 *
 * Agendamento: `vercel.json` (diário). No plano Hobby a Vercel só
 * permite crons diárias, o que é folgado para uma janela de 48h.
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
    const result = await purgeExpiredChatVideos(supabaseAdmin())
    return NextResponse.json({
      retention_hours: VIDEO_RETENTION_HOURS,
      ...result,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[purge-video] varredura falhou:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
