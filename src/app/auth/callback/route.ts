import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

// ============================================================
// GET /auth/callback
//
// Troca o `code` do link de e-mail do Supabase (recuperação de senha,
// confirmação de cadastro) por uma sessão de verdade, gravando os
// cookies pelo mesmo createClient() de servidor usado em toda rota de
// API do projeto. Sem esta rota, o link do e-mail nunca completava
// nada: forgot-password/page.tsx já apontava `redirectTo` pra cá, mas
// a rota nunca existia — achado ao investigar por que "esqueci minha
// senha" dava 404 (2026-09-25).
// ============================================================

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Sem `code`, ou o Supabase recusou (link expirado ou já usado) —
  // manda pro login com um aviso em vez de deixar a pessoa num erro
  // genérico do Next.
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
