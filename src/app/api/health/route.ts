import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'

export const dynamic = 'force-dynamic'

// Endereço de saúde para o monitor externo. Faz uma consulta mínima ao
// banco: o Supabase do plano grátis pausa sozinho, e checar só a página
// de login não detectaria isso. Sem autenticação e sem dados na resposta.
export async function GET() {
  try {
    const { error } = await supabaseAdmin().from('accounts').select('id').limit(1)
    if (error) {
      return NextResponse.json({ ok: false }, { status: 503 })
    }
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 })
  }
}
