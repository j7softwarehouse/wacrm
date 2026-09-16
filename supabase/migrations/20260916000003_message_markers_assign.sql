-- ============================================================
-- MARCADORES ATRIBUÍDOS A OUTRA PESSOA
-- Qualquer atendente pode marcar um ponto da conversa em nome de um
-- colega (não só de si mesmo). `created_by` continua sendo o DONO do
-- marcador (quem aparece no chip, quem vê em "Meus marcadores"),
-- `assigned_by` guarda quem de fato atribuiu — precisa pra notificar
-- e pra deixar quem atribuiu desfazer se errar a pessoa.
-- ============================================================

ALTER TABLE message_markers
  ADD COLUMN assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Backfill: marcadores já existentes foram todos auto-marcados.
UPDATE message_markers SET assigned_by = created_by WHERE assigned_by IS NULL;

-- INSERT: continua exigindo que o autor da linha (auth.uid()) seja
-- agent+ da conta, mas agora `created_by` pode ser qualquer OUTRO
-- membro da mesma conta — desde que `assigned_by` seja sempre quem
-- está autenticado (não dá pra fingir que foi outra pessoa quem
-- atribuiu).
DROP POLICY IF EXISTS message_markers_insert ON message_markers;
CREATE POLICY message_markers_insert ON message_markers FOR INSERT WITH CHECK (
  assigned_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = message_markers.conversation_id
      AND is_account_member(c.account_id, 'agent')
      AND EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.user_id = message_markers.created_by
          AND p.account_id = c.account_id
      )
  )
);

-- UPDATE: dono do marcador OU quem atribuiu podem corrigir o rótulo.
DROP POLICY IF EXISTS message_markers_update ON message_markers;
CREATE POLICY message_markers_update ON message_markers FOR UPDATE USING (
  created_by = auth.uid() OR assigned_by = auth.uid()
);

-- DELETE: dono, quem atribuiu, ou admin+.
DROP POLICY IF EXISTS message_markers_delete ON message_markers;
CREATE POLICY message_markers_delete ON message_markers FOR DELETE USING (
  created_by = auth.uid()
  OR assigned_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = message_markers.conversation_id
      AND is_account_member(c.account_id, 'admin')
  )
);

-- ============================================================
-- NOTIFICAÇÃO — "Fulano marcou um assunto pra você"
-- Só quando é de fato uma atribuição pra outra pessoa; marcar pra si
-- mesmo (o uso original da feature) continua silencioso.
-- ============================================================

ALTER TABLE notifications
  ADD COLUMN message_id UUID REFERENCES messages(id) ON DELETE SET NULL;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'marker_assigned'));

CREATE OR REPLACE FUNCTION notify_marker_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_name TEXT;
  v_actor_name TEXT;
  v_account_id UUID;
  v_contact_id UUID;
BEGIN
  IF NEW.assigned_by IS NULL OR NEW.assigned_by = NEW.created_by THEN
    RETURN NEW;
  END IF;

  SELECT c.account_id, c.contact_id, COALESCE(NULLIF(ct.name, ''), ct.phone)
    INTO v_account_id, v_contact_id, v_contact_name
  FROM conversations c
  LEFT JOIN contacts ct ON ct.id = c.contact_id
  WHERE c.id = NEW.conversation_id;

  SELECT full_name INTO v_actor_name
  FROM profiles WHERE user_id = NEW.assigned_by;

  INSERT INTO notifications (
    account_id, user_id, type, conversation_id, contact_id,
    message_id, actor_user_id, title, body
  ) VALUES (
    v_account_id,
    NEW.created_by,
    'marker_assigned',
    NEW.conversation_id,
    v_contact_id,
    NEW.message_id,
    NEW.assigned_by,
    'Novo marcador pra você',
    COALESCE(v_actor_name, 'Alguém') || ' marcou um assunto pra você em '
      || COALESCE(v_contact_name, 'uma conversa')
      || COALESCE(' — ' || NULLIF(NEW.label, ''), '')
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Nunca deixar uma falha na notificação bloquear o marcador em si.
  RAISE WARNING 'Failed to create marker-assigned notification for marker %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION notify_marker_assigned() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_marker_assigned ON message_markers;
CREATE TRIGGER on_marker_assigned
  AFTER INSERT ON message_markers
  FOR EACH ROW EXECUTE FUNCTION notify_marker_assigned();
