-- ============================================================
-- message_markers — "onde eu parei" pessoal dentro de uma conversa.
--
-- Ver docs/superpowers/specs/2026-09-16-marcadores-de-mensagem-design.md.
--
-- Problema real (não é sobre quem responde a conversa — várias pessoas
-- já podem responder o mesmo chat hoje): um atendente está tratando um
-- assunto ainda pendente numa conversa longa, outra pessoa entra pra
-- tratar OUTRO assunto, e o primeiro atendente perde o ponto onde
-- estava — precisa garimpar a conversa inteira pra achar de novo.
--
-- Cada marcador é: uma mensagem + quem marcou + um rótulo curto
-- opcional do assunto ("Financeiro"). Visível a toda a conta (é isso
-- que também avisa "a Aline já está tratando isso daqui"); só quem
-- marcou (ou admin) apaga — ninguém some com a referência de outra
-- pessoa sem querer.
--
-- `conversation_id` denormalizado por conta de Realtime, que não faz
-- join — mesmo motivo de `message_reactions` (migração
-- 20250101000009_message_actions.sql).
--
-- Nota para quando o escopo de conversas (spec
-- 2026-09-15-escopo-de-conversas-design.md) for promovido pra
-- produção: as políticas abaixo usam `is_account_member`, o padrão
-- ESTÁVEL de hoje — precisam ser atualizadas para
-- `can_see_conversation`/`can_write_conversation` na mesma migração
-- que ligar o escopo restrito em produção, senão um usuário restrito
-- enxergaria marcador de conversa que a regra nova diz que ele não
-- deveria ver.
-- ============================================================

CREATE TABLE IF NOT EXISTS message_markers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Rótulo curto do assunto ("Financeiro", "Rematrícula"). Opcional —
  -- sem ele a etiqueta mostra só o nome de quem marcou.
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Uma pessoa marca a MESMA mensagem uma vez só; marcar de novo edita
  -- o rótulo (UPSERT), não empilha uma segunda linha.
  UNIQUE (message_id, created_by)
);

CREATE INDEX IF NOT EXISTS idx_message_markers_conversation
  ON message_markers(conversation_id);

-- Sustenta a lista "Meus marcadores" (todas as conversas, mais recente
-- primeiro) sem escanear a tabela inteira.
CREATE INDEX IF NOT EXISTS idx_message_markers_created_by
  ON message_markers(created_by, created_at DESC);

ALTER TABLE message_markers ENABLE ROW LEVEL SECURITY;

CREATE POLICY message_markers_select ON message_markers FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = message_markers.conversation_id
      AND is_account_member(c.account_id)
  )
);

CREATE POLICY message_markers_insert ON message_markers FOR INSERT WITH CHECK (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = message_markers.conversation_id
      AND is_account_member(c.account_id, 'agent')
  )
);

-- Só quem marcou edita o próprio rótulo.
CREATE POLICY message_markers_update ON message_markers FOR UPDATE USING (
  created_by = auth.uid()
);

-- Só quem marcou, ou admin+, remove.
CREATE POLICY message_markers_delete ON message_markers FOR DELETE USING (
  created_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = message_markers.conversation_id
      AND is_account_member(c.account_id, 'admin')
  )
);

-- Realtime — o chip no balão aparece pra quem já está com a conversa
-- aberta, sem recarregar.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'message_markers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE message_markers;
  END IF;
END $$;
