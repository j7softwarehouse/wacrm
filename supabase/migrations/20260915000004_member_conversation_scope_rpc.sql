-- ============================================================
-- set_member_conversation_scope(p_user_id, p_scope)
--
-- Mesmo padrão de segurança de `set_member_role` (migração
-- 20250101000018_account_member_rpcs.sql): a tela de Membros da
-- equipe não pode fazer UPDATE direto em `profiles` de outra pessoa
-- (a RLS de `profiles` não permite), então o ajuste de escopo passa
-- por uma RPC SECURITY DEFINER que faz as mesmas checagens —
-- chamador precisa ser admin+, alvo precisa estar na mesma conta, e
-- ninguém mexe no próprio escopo por aqui.
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_member_conversation_scope(
  p_user_id UUID,
  p_scope TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
BEGIN
  IF p_scope NOT IN ('all', 'assigned') THEN
    RAISE EXCEPTION 'p_scope must be ''all'' or ''assigned''' USING ERRCODE = '22023';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own conversation scope'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role
  INTO v_target_account_id, v_target_role
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  -- Escopo não se aplica a admin/owner (as funções de RLS já os
  -- ignoram) — recusa explicitamente em vez de aceitar um valor sem
  -- efeito nenhum, que confundiria quem está mexendo na tela.
  IF v_target_role IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Conversation scope does not apply to admin/owner'
      USING ERRCODE = '22023';
  END IF;

  UPDATE profiles
  SET conversation_scope = p_scope
  WHERE user_id = p_user_id;
END;
$$;

ALTER FUNCTION public.set_member_conversation_scope(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_conversation_scope(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_conversation_scope(UUID, TEXT) TO authenticated;
