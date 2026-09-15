-- ============================================================
-- Escopo de conversas — papel e alcance como eixos separados.
-- Ver docs/superpowers/specs/2026-09-15-escopo-de-conversas-design.md
--
-- O papel (`account_role`) diz O QUE a pessoa pode fazer; o escopo
-- (`conversation_scope`) diz SOBRE QUAIS conversas aquilo vale.
--
-- Por que não é um quinto papel: o perfil pedido (responder só o que lhe
-- foi atribuído) ESCREVE MAIS que o `viewer` e ENXERGA MENOS. Numa
-- hierarquia ordinal, onde quem está acima herda tudo de quem está
-- abaixo, isso não tem posição possível — acima do `viewer` daria a ele
-- todas as conversas, abaixo tiraria a escrita. São duas dimensões.
--
-- Padrão `all`: nenhum usuário existente muda de comportamento.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS conversation_scope TEXT NOT NULL DEFAULT 'all'
  CHECK (conversation_scope IN ('all', 'assigned'));

COMMENT ON COLUMN profiles.conversation_scope IS
  'Alcance das conversas: all = todas as da conta; assigned = somente as atribuídas a este usuário. Ignorado para admin/owner.';

-- A lista do usuário restrito filtra por este campo a cada carga.
CREATE INDEX IF NOT EXISTS idx_conversations_assigned_agent
  ON conversations(assigned_agent_id)
  WHERE assigned_agent_id IS NOT NULL;

-- ============================================================
-- Funções auxiliares.
--
-- Mesmo espírito de `is_account_member`: a regra mora num lugar só e
-- todas as políticas a consultam, para que TypeScript e banco nunca
-- divirjam. SECURITY DEFINER para poder ler `profiles` sem depender da
-- RLS da própria tabela.
--
-- `admin`/`owner` ignoram o escopo de propósito: um administrador
-- marcado como restrito por engano se trancaria fora da própria conta.
-- ============================================================

CREATE OR REPLACE FUNCTION can_see_conversation(
  target_account_id UUID,
  assigned UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND (
        p.account_role IN ('admin', 'owner')
        OR p.conversation_scope = 'all'
        OR assigned = auth.uid()
      )
  );
$$;

-- Escrever exige o papel `agent` para cima E estar dentro do escopo.
CREATE OR REPLACE FUNCTION can_write_conversation(
  target_account_id UUID,
  assigned UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND CASE p.account_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END >= 2
      AND (
        p.account_role IN ('admin', 'owner')
        OR p.conversation_scope = 'all'
        OR assigned = auth.uid()
      )
  );
$$;

-- Iniciar (ou apagar) conversa exige escopo total: quem é restrito
-- responde, não inicia. Isto fecha o botão "Conversar" de Contatos pelo
-- lado do banco, não só pela tela.
CREATE OR REPLACE FUNCTION can_start_conversation(
  target_account_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND CASE p.account_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END >= 2
      AND (p.account_role IN ('admin', 'owner') OR p.conversation_scope = 'all')
  );
$$;

-- ============================================================
-- Políticas — conversations
-- ============================================================

DROP POLICY IF EXISTS conversations_select ON conversations;
CREATE POLICY conversations_select ON conversations FOR SELECT
  USING (can_see_conversation(account_id, assigned_agent_id));

DROP POLICY IF EXISTS conversations_insert ON conversations;
CREATE POLICY conversations_insert ON conversations FOR INSERT
  WITH CHECK (can_start_conversation(account_id));

DROP POLICY IF EXISTS conversations_update ON conversations;
CREATE POLICY conversations_update ON conversations FOR UPDATE
  USING (can_write_conversation(account_id, assigned_agent_id));

DROP POLICY IF EXISTS conversations_delete ON conversations;
CREATE POLICY conversations_delete ON conversations FOR DELETE
  USING (can_start_conversation(account_id));

-- ============================================================
-- Políticas — messages (seguem a conversa a que pertencem)
-- ============================================================

DROP POLICY IF EXISTS messages_select ON messages;
CREATE POLICY messages_select ON messages FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND can_see_conversation(c.account_id, c.assigned_agent_id)
  )
);

DROP POLICY IF EXISTS messages_modify ON messages;
CREATE POLICY messages_modify ON messages FOR ALL USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND can_write_conversation(c.account_id, c.assigned_agent_id)
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND can_write_conversation(c.account_id, c.assigned_agent_id)
  )
);

-- ============================================================
-- Trava de atribuição.
--
-- Sem isto, quem tem escopo restrito poderia se desatribuir (fazendo a
-- conversa sumir da própria lista, sem volta, já que deixaria de
-- enxergá-la) ou repassá-la a outra pessoa. A regra vale por LINHA na
-- RLS, que não sabe distinguir "mudou o status" de "mudou o dono" —
-- por isso a checagem é um gatilho.
--
-- `auth.uid()` nulo (webhook/service role) não cai na trava: aquele
-- caminho não representa um usuário restrito.
-- ============================================================

CREATE OR REPLACE FUNCTION guard_conversation_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id
     AND auth.uid() IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM profiles p
       WHERE p.user_id = auth.uid()
         AND p.account_id = OLD.account_id
         AND p.account_role NOT IN ('admin', 'owner')
         AND p.conversation_scope = 'assigned'
     )
  THEN
    RAISE EXCEPTION 'Usuário com escopo restrito não pode alterar a atribuição da conversa';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_conversation_assignment ON conversations;
CREATE TRIGGER trg_guard_conversation_assignment
  BEFORE UPDATE ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION guard_conversation_assignment();
