-- ============================================================
-- 20261110000002_webhook_events_payload_keys
--
-- Guarda só os NOMES das chaves do payload recebido (sem valores),
-- para descobrir o formato de eventos ainda não documentados
-- (ex.: messages_update, history). Aditiva: não altera linhas existentes.
-- ============================================================

ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS payload_keys TEXT;
