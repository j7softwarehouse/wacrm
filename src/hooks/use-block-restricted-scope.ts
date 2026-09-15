"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/hooks/use-auth";

/**
 * Redireciona pra /notifications quem tem escopo de conversas restrito
 * — Dashboard, Funil, Broadcasts, Automações, Fluxos e Agentes IA não
 * fazem parte do trabalho dele (responde só o que foi atribuído, pela
 * notificação). Esconder o link do menu (`sidebar.tsx`) é cosmético;
 * este hook é o que efetivamente barra quem digitar a URL na mão.
 *
 * Não se aplica à própria Caixa de Entrada: é lá que a notificação
 * abre a conversa (`/inbox?c=<id>`) — a RLS (`can_see_conversation`)
 * já garante que ele só enxerga a conversa atribuída a ele mesmo
 * chegando por essa URL.
 *
 * Mesmo padrão já usado pelo módulo de vendas em `pipelines/page.tsx`
 * (`salesEnabled` + `router.replace`).
 */
export function useBlockRestrictedScope(): void {
  const { profileLoading, hasRestrictedScope } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // `hasRestrictedScope` é `false` durante o carregamento (accountRole
    // ainda nulo) — espera `!profileLoading` pra não redirecionar um
    // admin/agent normal por engano antes do papel resolver.
    if (profileLoading) return;
    if (hasRestrictedScope) router.replace("/notifications");
  }, [profileLoading, hasRestrictedScope, router]);
}
