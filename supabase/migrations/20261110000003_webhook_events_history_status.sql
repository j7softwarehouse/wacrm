-- ============================================================
-- 20261110000003_webhook_events_history_status
--
-- Registra o status do lote de sincronização (evento `history`) e a
-- quantidade de mensagens recebidas. Só código curto e contador, sem
-- conteúdo de mensagem. Aditiva.
-- ============================================================

ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS history_status TEXT,
  ADD COLUMN IF NOT EXISTS history_received INTEGER;
