-- ============================================================
-- set_member_channel_scope(p_user_id, p_scope)
-- set_member_channels(p_user_id, p_channel_ids)
--
-- Mesmo padrão de segurança de set_member_conversation_scope
-- (20260915000004): a tela de Membros não pode fazer UPDATE direto em
-- profiles de outra pessoa nem INSERT/DELETE direto em
-- channel_members (sem política de escrita de propósito), então as
-- duas RPCs SECURITY DEFINER fazem as checagens — chamador precisa
-- ser admin+, alvo precisa estar na mesma conta, ninguém mexe na
-- própria configuração por aqui, e não se aplica a admin/owner.
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_member_channel_scope(
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
    RAISE EXCEPTION 'Cannot change your own channel scope'
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

  IF v_target_role IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Channel scope does not apply to admin/owner'
      USING ERRCODE = '22023';
  END IF;

  UPDATE profiles
  SET channel_scope = p_scope
  WHERE user_id = p_user_id;
END;
$$;

ALTER FUNCTION public.set_member_channel_scope(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_channel_scope(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_channel_scope(UUID, TEXT) TO authenticated;

-- Substitui a lista INTEIRA de channel_members daquele usuário pelos
-- ids informados, numa transação só — evita duas chamadas de rede
-- (uma pra remover, uma pra adicionar) por clique de checkbox na tela
-- de Membros, e evita ficar com estado parcial se a segunda falhar.
CREATE OR REPLACE FUNCTION public.set_member_channels(
  p_user_id UUID,
  p_channel_ids UUID[]
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
  v_foreign_channel_count INT;
BEGIN
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
    RAISE EXCEPTION 'Cannot change your own channels'
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

  IF v_target_role IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Channel assignment does not apply to admin/owner'
      USING ERRCODE = '22023';
  END IF;

  -- Todo id informado precisa pertencer à MESMA conta do chamador —
  -- sem isso um admin poderia (por erro de UI ou chamada direta)
  -- atribuir um usuário a um canal de outra conta.
  IF p_channel_ids IS NOT NULL AND array_length(p_channel_ids, 1) > 0 THEN
    SELECT count(*) INTO v_foreign_channel_count
    FROM whatsapp_channels wc
    WHERE wc.id = ANY(p_channel_ids)
      AND wc.account_id <> v_caller_account_id;

    IF v_foreign_channel_count > 0 THEN
      RAISE EXCEPTION 'One or more channels do not belong to your account'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  DELETE FROM channel_members WHERE user_id = p_user_id;

  IF p_channel_ids IS NOT NULL AND array_length(p_channel_ids, 1) > 0 THEN
    INSERT INTO channel_members (channel_id, user_id)
    SELECT DISTINCT unnest(p_channel_ids), p_user_id;
  END IF;
END;
$$;

ALTER FUNCTION public.set_member_channels(UUID, UUID[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_channels(UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_channels(UUID, UUID[]) TO authenticated;
