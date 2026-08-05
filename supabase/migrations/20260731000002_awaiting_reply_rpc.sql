-- ============================================================
-- 20260731000002_awaiting_reply_rpc
--
-- Conversas abertas cuja ÚLTIMA mensagem é do contato — ou seja, a
-- organização é quem está devendo resposta.
--
-- Vive no banco porque "a última mensagem de cada conversa" é um
-- DISTINCT ON, que o PostgREST não expõe: pelo cliente sairia uma
-- consulta por conversa. A função devolve o instante daquela última
-- mensagem e deixa a conta de minutos de expediente para a aplicação,
-- que é onde o fuso é tratado explicitamente.
--
-- SECURITY INVOKER (padrão): as políticas de `conversations` e
-- `messages` continuam valendo para quem chama, então a função não
-- amplia acesso.
--
-- Idempotente — seguro re-executar.
-- ============================================================

CREATE OR REPLACE FUNCTION public.conversations_awaiting_reply(p_account_id UUID)
RETURNS TABLE (
  conversation_id  UUID,
  last_message_at  TIMESTAMPTZ,
  last_sender_type TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT ON (m.conversation_id)
         m.conversation_id,
         m.created_at,
         m.sender_type
  FROM messages m
  JOIN conversations c ON c.id = m.conversation_id
  WHERE c.account_id = p_account_id
    AND c.status = 'open'
  ORDER BY m.conversation_id, m.created_at DESC
$$;

-- Por que o DISTINCT ON não filtra por remetente: filtrar antes traria
-- a última mensagem DO CLIENTE, não a última mensagem DA CONVERSA — e
-- uma conversa já respondida voltaria a contar como pendente. O filtro
-- por remetente precisa vir depois de escolher a última mensagem, e
-- por isso fica do lado da aplicação (loadAwaitingReply).

COMMENT ON FUNCTION public.conversations_awaiting_reply(UUID) IS
  'Última mensagem de cada conversa aberta da conta, com o tipo de '
  'remetente. Quem chama filtra por remetente e pelo tempo de '
  'expediente decorrido.';

ALTER FUNCTION public.conversations_awaiting_reply(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.conversations_awaiting_reply(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conversations_awaiting_reply(UUID) TO authenticated;
