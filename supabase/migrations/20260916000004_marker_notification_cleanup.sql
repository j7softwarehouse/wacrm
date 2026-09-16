-- Quando um marcador atribuído a alguém é removido, a notificação
-- "Novo marcador pra você" que ele gerou fica órfã — clicar nela leva
-- pra conversa, mas não existe mais nada marcado lá. Apaga a
-- notificação junto com o marcador.
CREATE OR REPLACE FUNCTION cleanup_marker_assigned_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM notifications
  WHERE type = 'marker_assigned'
    AND user_id = OLD.created_by
    AND conversation_id = OLD.conversation_id
    AND message_id = OLD.message_id;
  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  -- Nunca deixar a limpeza da notificação bloquear a remoção do marcador.
  RAISE WARNING 'Failed to clean up marker-assigned notification for marker %: %', OLD.id, SQLERRM;
  RETURN OLD;
END;
$$;

ALTER FUNCTION cleanup_marker_assigned_notification() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_marker_deleted ON message_markers;
CREATE TRIGGER on_marker_deleted
  AFTER DELETE ON message_markers
  FOR EACH ROW EXECUTE FUNCTION cleanup_marker_assigned_notification();
