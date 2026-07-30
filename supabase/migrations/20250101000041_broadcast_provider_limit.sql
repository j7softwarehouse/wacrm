-- ============================================================
-- 041_broadcast_provider_limit
--
-- Novo status para disparos interrompidos por limite do provedor.
--
-- O WhatsApp devolve 463 (WHATSAPP_REACHOUT_TIMELOCK) quando a conta
-- está temporariamente impedida de iniciar novas conversas. Continuar
-- enviando queima a reputação do número e escala para banimento, então
-- o disparo para e espera decisão humana — não é um erro de que se
-- possa tentar novamente sozinho.
--
-- Idempotente.
-- ============================================================

-- Os cinco primeiros valores são exatamente os da migração 001
-- (verificado); o sexto é o novo.
ALTER TABLE broadcasts DROP CONSTRAINT IF EXISTS broadcasts_status_check;
ALTER TABLE broadcasts
  ADD CONSTRAINT broadcasts_status_check
  CHECK (status IN (
    'draft', 'scheduled', 'sending', 'sent', 'failed',
    'paused_provider_limit'
  ));

-- Guarda a mensagem do provedor (já em pt-BR) para o operador entender
-- por que o disparo parou.
ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS provider_limit_message TEXT;
