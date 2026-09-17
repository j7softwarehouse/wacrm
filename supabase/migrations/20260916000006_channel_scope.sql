-- ============================================================
-- Restrição por canal WhatsApp — segundo eixo, independente do
-- escopo de conversas. Ver
-- docs/superpowers/specs/2026-09-16-restricao-por-canal-design.md
--
-- `conversation_scope` diz SOBRE QUAIS conversas (por atribuição);
-- `channel_scope` diz SOBRE QUAIS CANAIS. Os dois são checados juntos,
-- dentro das mesmas três funções (`can_see_conversation`,
-- `can_write_conversation`, `can_start_conversation`) — não duas
-- funções separadas, porque a RLS chama isso por linha e duplicar a
-- chamada dobraria o custo de listar a Inbox.
--
-- Padrão `all`: nenhum usuário existente muda de comportamento, e
-- nenhuma migração de preenchimento é necessária (diferente do desenho
-- de 2026-07-31, onde a presença em `channel_members` ERA a permissão
-- — aqui a tabela só é consultada quando `channel_scope = 'assigned'`).
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS channel_scope TEXT NOT NULL DEFAULT 'all'
  CHECK (channel_scope IN ('all', 'assigned'));

COMMENT ON COLUMN profiles.channel_scope IS
  'Alcance de canais: all = todos os canais da conta; assigned = somente os listados em channel_members. Ignorado para admin/owner.';

CREATE TABLE IF NOT EXISTS channel_members (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id  UUID NOT NULL REFERENCES whatsapp_channels(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (channel_id, user_id)
);

-- Sem account_id denormalizado: a tenancy é verificada através de
-- whatsapp_channels, mesmo padrão de contact_tags.
CREATE INDEX IF NOT EXISTS idx_channel_members_channel ON channel_members(channel_id);
-- Sentido inverso: "quais canais este usuário atende" — usado pra
-- popular a UI de Membros e pelo filtro de GET /api/whatsapp/channels.
CREATE INDEX IF NOT EXISTS idx_channel_members_user ON channel_members(user_id);

ALTER TABLE channel_members ENABLE ROW LEVEL SECURITY;

-- Só leitura direta pra qualquer membro da conta (a tela de Membros
-- precisa mostrar quem atende o quê). Toda escrita passa pelas RPCs
-- SECURITY DEFINER (set_member_channel_scope / set_member_channels) —
-- não há política de INSERT/UPDATE/DELETE de propósito.
DROP POLICY IF EXISTS channel_members_select ON channel_members;
CREATE POLICY channel_members_select ON channel_members FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM whatsapp_channels wc
    WHERE wc.id = channel_members.channel_id
      AND is_account_member(wc.account_id)
  )
);

-- ============================================================
-- Funções de RLS estendidas — mesma assinatura de antes, mais
-- `target_channel_id`. Toda política que já chamava uma destas três
-- (conversations, messages, message_markers) precisa passar a incluir
-- o canal — feito nesta mesma migração pra não deixar políticas
-- inconsistentes entre si no meio da aplicação.
-- ============================================================

CREATE OR REPLACE FUNCTION can_see_conversation(
  target_account_id UUID,
  assigned UUID,
  target_channel_id UUID
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
      AND (
        p.account_role IN ('admin', 'owner')
        -- 'all' cobre os dois casos de "não restrito por canal" de uma
        -- vez, canal removido incluso (target_channel_id nulo não
        -- precisa de tratamento especial). Um usuário restrito
        -- ('assigned') cai direto no EXISTS abaixo, que nunca casa
        -- contra channel_id nulo — é assim que uma conversa órfã fica
        -- invisível pra quem nunca atendeu aquele canal.
        OR p.channel_scope = 'all'
        OR EXISTS (
          SELECT 1 FROM channel_members cm
          WHERE cm.channel_id = target_channel_id AND cm.user_id = auth.uid()
        )
      )
  );
$$;

-- Escrever exige o papel `agent` para cima E estar dentro dos dois escopos.
CREATE OR REPLACE FUNCTION can_write_conversation(
  target_account_id UUID,
  assigned UUID,
  target_channel_id UUID
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
      AND (
        p.account_role IN ('admin', 'owner')
        OR p.channel_scope = 'all'
        OR EXISTS (
          SELECT 1 FROM channel_members cm
          WHERE cm.channel_id = target_channel_id AND cm.user_id = auth.uid()
        )
      )
  );
$$;

-- Iniciar (ou apagar) uma conversa NUM CANAL ESPECÍFICO: exige escopo
-- de conversa total (quem é restrito responde, não inicia) E que o
-- canal informado esteja dentro do escopo de canal do usuário.
CREATE OR REPLACE FUNCTION can_start_conversation(
  target_account_id UUID,
  target_channel_id UUID
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
      AND (
        p.account_role IN ('admin', 'owner')
        OR p.channel_scope = 'all'
        OR EXISTS (
          SELECT 1 FROM channel_members cm
          WHERE cm.channel_id = target_channel_id AND cm.user_id = auth.uid()
        )
      )
  );
$$;

-- ============================================================
-- Políticas — conversations (mesmas de 20260915000003, com o canal
-- da própria linha passado como terceiro argumento)
-- ============================================================

DROP POLICY IF EXISTS conversations_select ON conversations;
CREATE POLICY conversations_select ON conversations FOR SELECT
  USING (can_see_conversation(account_id, assigned_agent_id, channel_id));

DROP POLICY IF EXISTS conversations_insert ON conversations;
CREATE POLICY conversations_insert ON conversations FOR INSERT
  WITH CHECK (can_start_conversation(account_id, channel_id));

DROP POLICY IF EXISTS conversations_update ON conversations;
CREATE POLICY conversations_update ON conversations FOR UPDATE
  USING (can_write_conversation(account_id, assigned_agent_id, channel_id));

DROP POLICY IF EXISTS conversations_delete ON conversations;
CREATE POLICY conversations_delete ON conversations FOR DELETE
  USING (can_start_conversation(account_id, channel_id));

-- ============================================================
-- Políticas — messages (seguem a conversa a que pertencem)
-- ============================================================

DROP POLICY IF EXISTS messages_select ON messages;
CREATE POLICY messages_select ON messages FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND can_see_conversation(c.account_id, c.assigned_agent_id, c.channel_id)
  )
);

DROP POLICY IF EXISTS messages_modify ON messages;
CREATE POLICY messages_modify ON messages FOR ALL USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND can_write_conversation(c.account_id, c.assigned_agent_id, c.channel_id)
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND can_write_conversation(c.account_id, c.assigned_agent_id, c.channel_id)
  )
);

-- ============================================================
-- Políticas — message_markers (20260916000005 tinha 2 argumentos)
-- ============================================================

DROP POLICY IF EXISTS message_markers_select ON message_markers;
CREATE POLICY message_markers_select ON message_markers FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = message_markers.conversation_id
      AND can_see_conversation(c.account_id, c.assigned_agent_id, c.channel_id)
  )
);

DROP POLICY IF EXISTS message_markers_insert ON message_markers;
CREATE POLICY message_markers_insert ON message_markers FOR INSERT WITH CHECK (
  assigned_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = message_markers.conversation_id
      AND can_write_conversation(c.account_id, c.assigned_agent_id, c.channel_id)
      AND EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.user_id = message_markers.created_by
          AND p.account_id = c.account_id
      )
  )
);

-- ============================================================
-- Trava de troca de canal — mesmo gatilho de
-- guard_conversation_assignment (20260915000003), estendido pra
-- também impedir quem tem channel_scope = 'assigned' de mudar
-- conversations.channel_id. Sem isso, a política de UPDATE libera a
-- linha inteira e nada impediria escapar da restrição reatribuindo o
-- canal.
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

  IF NEW.channel_id IS DISTINCT FROM OLD.channel_id
     AND auth.uid() IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM profiles p
       WHERE p.user_id = auth.uid()
         AND p.account_id = OLD.account_id
         AND p.account_role NOT IN ('admin', 'owner')
         AND p.channel_scope = 'assigned'
     )
  THEN
    RAISE EXCEPTION 'Usuário com escopo restrito não pode alterar o canal da conversa';
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger já existe (20260915000003); CREATE OR REPLACE na função
-- acima já é suficiente, mas recriar o trigger também é idempotente e
-- documenta a dependência explicitamente.
DROP TRIGGER IF EXISTS trg_guard_conversation_assignment ON conversations;
CREATE TRIGGER trg_guard_conversation_assignment
  BEFORE UPDATE ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION guard_conversation_assignment();
