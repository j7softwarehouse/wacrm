-- ============================================================
-- conversations.closed_at — quando a conversa foi fechada.
--
-- `updated_at` não serve para isso: toda mensagem nova, contagem de não
-- lidas e qualquer outro UPDATE o reescrevem. Sem uma coluna própria, a
-- regra de "voltar para Aberto depois de 24h fechada" não tem em que se
-- apoiar.
--
-- Preenchido ao fechar e limpo ao sair de "fechado" (inclusive para
-- "pendente", que é manual e nunca é reaberto sozinho).
-- ============================================================

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

-- Conversas já fechadas antes desta migração não têm carimbo. `updated_at`
-- é a melhor aproximação disponível — sem isso elas ficariam fechadas
-- para sempre, já que a varredura ignora `closed_at` nulo.
UPDATE conversations
SET closed_at = updated_at
WHERE status = 'closed' AND closed_at IS NULL;

-- A varredura roda a cada carga da caixa de entrada; o índice parcial
-- mantém o custo em O(fechadas) em vez de O(todas as conversas).
CREATE INDEX IF NOT EXISTS idx_conversations_closed_at
  ON conversations(closed_at)
  WHERE status = 'closed';
