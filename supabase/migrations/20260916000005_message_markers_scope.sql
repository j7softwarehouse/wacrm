-- ============================================================
-- MARCADORES RESPEITAM O ESCOPO DE CONVERSAS
-- Migration 20260916000001 usava `is_account_member` (checagem
-- multiusuário básica) porque a feature de escopo de conversas
-- (20260915000003) ainda não estava em produção. Agora que vai junto,
-- SELECT/INSERT de message_markers passam a usar
-- `can_see_conversation`/`can_write_conversation` — um agente com
-- escopo restrito não pode ver nem marcar em conversas que não são
-- dele. UPDATE/DELETE não mudam: já são donos-ou-admin, o que já é
-- coerente com qualquer escopo.
-- ============================================================

DROP POLICY IF EXISTS message_markers_select ON message_markers;
CREATE POLICY message_markers_select ON message_markers FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = message_markers.conversation_id
      AND can_see_conversation(c.account_id, c.assigned_agent_id)
  )
);

DROP POLICY IF EXISTS message_markers_insert ON message_markers;
CREATE POLICY message_markers_insert ON message_markers FOR INSERT WITH CHECK (
  assigned_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = message_markers.conversation_id
      AND can_write_conversation(c.account_id, c.assigned_agent_id)
      AND EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.user_id = message_markers.created_by
          AND p.account_id = c.account_id
      )
  )
);
