-- ============================================================
-- 20261012000001_awaiting_reply_only_customer
--
-- conversations_awaiting_reply devolvia a última mensagem de TODA
-- conversa aberta (~900 linhas, 124 KB por chamada) e quem chamava
-- descartava no cliente as que tinham o atendente como último
-- remetente (isAwaitingReply: só `customer` conta). Polling a cada
-- minuto em cada Inbox/Dashboard aberto, isso era o maior gasto de
-- egress do Supabase (plano grátis, 5 GB/mês).
--
-- Agora o corte por remetente acontece no banco, DEPOIS de escolher a
-- última mensagem de cada conversa — mesma ordem que a migration
-- original explica (filtrar antes traria a última mensagem DO CLIENTE,
-- não a última DA CONVERSA). O que sai daqui é exatamente o que
-- isAwaitingReply já descartava, então a tela não muda. O corte por
-- tempo continua no cliente: conversa parada há mais de 7 dias ainda
-- conta como pendente, não dá pra cortar por data aqui.
--
-- Mesma assinatura e mesmo retorno: CREATE OR REPLACE mantém os
-- GRANTs. Idempotente — seguro re-executar.
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
  SELECT last_msg.conversation_id, last_msg.created_at, last_msg.sender_type
  FROM (
    SELECT DISTINCT ON (m.conversation_id)
           m.conversation_id,
           m.created_at,
           m.sender_type
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.account_id = p_account_id
      AND c.status = 'open'
    ORDER BY m.conversation_id, m.created_at DESC
  ) AS last_msg
  WHERE last_msg.sender_type = 'customer'
$$;

COMMENT ON FUNCTION public.conversations_awaiting_reply(UUID) IS
  'Conversas abertas da conta cuja ÚLTIMA mensagem é do cliente, com o '
  'instante dela. Quem chama filtra pelo tempo de expediente decorrido.';
