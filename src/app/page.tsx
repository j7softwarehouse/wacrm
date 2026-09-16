import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { isAccountRole } from '@/lib/auth/roles'
import { isConversationScope } from '@/lib/auth/conversation-scope'

export default async function RootPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Sem usuário: cai em /dashboard como sempre — o middleware (que
  // protege /dashboard, não /) manda pro /login a partir daí.
  if (user) {
    const { data } = await supabase
      .from('profiles')
      .select('account_role, conversation_scope')
      .eq('user_id', user.id)
      .maybeSingle()

    const role = isAccountRole(data?.account_role) ? data.account_role : null
    const scope = isConversationScope(data?.conversation_scope)
      ? data.conversation_scope
      : 'all'
    // Mesma regra de `useBlockRestrictedScope`: quem só responde o que
    // lhe foi atribuído não tem nada pra fazer no Dashboard — cairia
    // numa tela que não pode ver, só pra ser redirecionado de novo.
    const restricted = !!role && role !== 'admin' && role !== 'owner' && scope === 'assigned'

    if (restricted) redirect('/notifications')
  }

  redirect('/dashboard')
}
