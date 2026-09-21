-- ============================================================
-- conversations.pending_since — desde quando a conversa está pendente,
-- + auto-atribuição ao entrar em "pendente" sem responsável.
--
-- `updated_at` não serve para isso: toda mensagem nova, contagem de não
-- lidas e qualquer outro UPDATE o reescrevem — o mesmo problema que já
-- motivou `closed_at` (migração 20260915000002). Sem coluna própria, o
-- card de "Pendências" do Dashboard mostraria a idade errada pra
-- qualquer conversa pendente que recebeu uma mensagem nova recentemente
-- (o caso mais grave é justamente o que mais precisa aparecer certo).
--
-- Por que GATILHO, não código de aplicação (o padrão de `closed_at`,
-- mantido em `conversationStatusPatch`): existem hoje pelo menos dois
-- caminhos que escrevem `status = 'pending'` direto, sem passar pelo
-- helper compartilhado (`executeHandoff` em src/lib/flows/engine.ts,
-- linha ~443) — um gatilho de banco cobre TODO caminho de escrita,
-- independente de qual código lembrou (ou não) de manter o campo
-- coerente.
--
-- Auto-atribuição: ao entrar em pendente sem NINGUÉM responsável (nem
-- `assigned_agent_id`, nem nenhum marcador na conversa), atribui a quem
-- fez a mudança (`auth.uid()`). Pedido do usuário (2026-09-21): evita
-- pendência "órfã" por esquecimento, sem exigir nenhum campo obrigatório
-- na tela. Nunca sobrescreve uma atribuição já presente na mesma escrita
-- (ex.: um nó de handoff de Fluxo que já define `assigned_agent_id`
-- explicitamente). `auth.uid() IS NULL` (automação/service role, sem
-- sessão de usuário) deixa a conversa sem responsável de propósito —
-- atribuir a alguém aleatório seria pior que deixar em aberto.
-- ============================================================

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pending_since TIMESTAMPTZ;

-- Conversas já pendentes antes desta migração não têm carimbo.
-- `updated_at` é a melhor aproximação disponível.
UPDATE conversations
SET pending_since = updated_at
WHERE status = 'pending' AND pending_since IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_pending_since
  ON conversations(pending_since)
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION conversations_pending_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pending' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'pending') THEN
    NEW.pending_since := NOW();

    IF NEW.assigned_agent_id IS NULL AND auth.uid() IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM message_markers m WHERE m.conversation_id = NEW.id
      ) THEN
        NEW.assigned_agent_id := auth.uid();
      END IF;
    END IF;
  ELSIF NEW.status IS DISTINCT FROM 'pending' THEN
    NEW.pending_since := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_conversation_pending_lifecycle ON conversations;
CREATE TRIGGER on_conversation_pending_lifecycle
  BEFORE INSERT OR UPDATE OF status ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION conversations_pending_lifecycle();

COMMENT ON FUNCTION conversations_pending_lifecycle() IS
  'Carimba/limpa conversations.pending_since ao entrar/sair de "pendente" '
  'e auto-atribui ao autor da mudança quando ninguém (nem marcador, nem '
  'responsável) já cobre a conversa. Cobre todo caminho de escrita, '
  'inclusive os que não passam por conversationStatusPatch (app).';

ALTER FUNCTION conversations_pending_lifecycle() OWNER TO postgres;
