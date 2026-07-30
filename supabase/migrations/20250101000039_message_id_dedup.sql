-- ============================================================
-- 039_message_id_dedup
--
-- Torna real a garantia de idempotência que o design já afirmava:
-- uma reentrega do webhook não pode gravar uma segunda linha em
-- `messages`.
--
-- O QUE FALTAVA
-- A 001 cria apenas `idx_messages_message_id`, NÃO-único — e a 009
-- documenta o porquê: ids da Meta não são únicos entre números de
-- telefone diferentes, então `UNIQUE (message_id)` sozinho seria
-- errado. O par que É realmente único é
-- `(conversation_id, message_id)` — exatamente por ele que o próprio
-- `ingest.ts` re-resolve a linha existente quando pega um 23505.
--
-- Sem essa constraint, o ramo `isDuplicateMessage` do ingest nunca é
-- alcançado (nada levanta 23505) e cada reentrega grava uma duplicata.
-- Webhooks da Meta são at-least-once, então produção quase certamente
-- já acumulou duplicatas — daí esta migração ser também de DADOS, não
-- só de schema.
--
-- Espelha a forma da 036 (dedup de conversas), um nível abaixo:
--   1. função SECURITY DEFINER, re-executável, que funde duplicatas
--      re-apontando os filhos antes de apagar os perdedores;
--   2. chama a função;
--   3. cria o índice único.
--
-- Idempotente. **Sem perda de dados** — as linhas perdedoras são
-- fundidas, não descartadas: tudo que aponta para elas passa a apontar
-- para a sobrevivente antes do DELETE.
-- ============================================================

-- 1) Fusão (re-executável) das duplicatas existentes.
--    SECURITY DEFINER para re-apontar linhas entre tabelas
--    independentemente da RLS de quem chama; só colapsa mensagens que
--    compartilham o MESMO (conversation_id, message_id), então nunca
--    mistura conversas.
CREATE OR REPLACE FUNCTION public.merge_duplicate_messages()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group    RECORD;
  v_survivor UUID;
  v_losers   UUID[];
  v_all      UUID[];
  v_merged   INTEGER := 0;
BEGIN
  FOR v_group IN
    SELECT conversation_id,
           message_id,
           array_agg(id ORDER BY created_at ASC, id ASC) AS ids
    FROM messages
    WHERE message_id IS NOT NULL
    GROUP BY conversation_id, message_id
    HAVING count(*) > 1
  LOOP
    v_all      := v_group.ids;
    v_survivor := v_all[1];
    v_losers   := v_all[2:array_length(v_all, 1)];

    -- Re-aponta TODAS as FKs que referenciam messages(id) antes do
    -- DELETE. São três (confirmadas por
    -- `grep -rn "REFERENCES messages" supabase/migrations/*.sql`):
    --
    --   messages.reply_to_message_id      (009, auto-referência, SET NULL)
    --   message_reactions.message_id      (009, CASCADE)
    --   flow_runs.last_prompt_message_id  (010, SET NULL)
    --
    -- Fazer isto ANTES do DELETE é o que impede o CASCADE de
    -- message_reactions de levar reações junto, e o SET NULL das outras
    -- duas de apagar silenciosamente o vínculo de resposta / o prompt
    -- do flow.
    -- `AND id <> v_survivor` evita criar uma auto-referência
    -- (`reply_to_message_id = id`) no caso degenerado de a
    -- sobrevivente "responder" a uma duplicata dela mesma. Nesse caso a
    -- FK ON DELETE SET NULL zera o ponteiro, que é o resultado sensato.
    UPDATE messages   SET reply_to_message_id     = v_survivor WHERE reply_to_message_id     = ANY(v_losers) AND id <> v_survivor;
    UPDATE flow_runs  SET last_prompt_message_id  = v_survivor WHERE last_prompt_message_id  = ANY(v_losers);

    -- message_reactions tem UNIQUE (message_id, actor_type, actor_id),
    -- então re-apontar às cegas pode violar a constraint de DUAS
    -- formas: uma perdedora colidindo com a sobrevivente, e — menos
    -- óbvio — duas PERDEDORAS colidindo entre si depois de ambas
    -- passarem a apontar para a sobrevivente. (O caminho de reação do
    -- webhook resolve o alvo por message_id, então entregas diferentes
    -- podem ter registrado a mesma reação em linhas duplicadas
    -- diferentes.)
    --
    -- Por isso a deduplicação é feita sobre o GRUPO INTEIRO
    -- (sobrevivente + perdedoras) de uma vez: mantém-se uma reação por
    -- (actor_type, actor_id), preferindo a que já está na sobrevivente
    -- e, entre as demais, a mais antiga. Todas expressam o mesmo estado
    -- lógico — mesmo alvo, mesmo autor — então nada de significativo se
    -- perde.
    --
    -- `actor_id IS NOT NULL` porque a UNIQUE é NULLS DISTINCT: linhas
    -- com actor_id nulo nunca colidem, e colapsá-las seria perda de
    -- dado sem motivo.
    DELETE FROM message_reactions
    WHERE id IN (
      SELECT id FROM (
        SELECT id,
               row_number() OVER (
                 PARTITION BY actor_type, actor_id
                 ORDER BY (message_id = v_survivor) DESC, created_at ASC, id ASC
               ) AS rn
        FROM message_reactions
        WHERE (message_id = v_survivor OR message_id = ANY(v_losers))
          AND actor_id IS NOT NULL
      ) ranked
      WHERE ranked.rn > 1
    );
    UPDATE message_reactions SET message_id = v_survivor WHERE message_id = ANY(v_losers);

    DELETE FROM messages WHERE id = ANY(v_losers);

    v_merged := v_merged + COALESCE(array_length(v_losers, 1), 0);
  END LOOP;

  RETURN v_merged;
END;
$$;

ALTER FUNCTION public.merge_duplicate_messages() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.merge_duplicate_messages() FROM PUBLIC;

-- Colapsa o que existir de duplicata agora. No-op seguro quando não há
-- nenhuma: o FOR simplesmente não itera e a função devolve 0.
SELECT public.merge_duplicate_messages();

-- 2) A garantia autoritativa. Parcial porque `messages.message_id` é
--    NULLABLE no schema (001) e linhas históricas podem tê-lo nulo;
--    o WHERE mantém o índice fora delas em vez de indexar NULLs à toa.
--    (Todo caminho de SAÍDA atual — send-message.ts, flows/send.ts,
--    automations/send.ts — só insere depois que o provedor devolveu um
--    id, então grava sempre preenchido; a parcialidade é sobre o
--    histórico e sobre a coluna continuar nullable, não sobre o
--    presente.)
--
--    Se a fusão acima tiver deixado passar alguma duplicata, este
--    CREATE falha e aborta a migração — é o comportamento desejado
--    (mesma postura de 013/022/036): melhor falhar alto do que seguir
--    sem a garantia que o código de dedup assume existir.
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_conversation_message_id
  ON messages (conversation_id, message_id)
  WHERE message_id IS NOT NULL;
