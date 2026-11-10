-- ============================================================
-- 20261110000001_webhook_events_log
--
-- Registro de auditoria dos eventos recebidos da UAZAPI. Serve para
-- diagnosticar entrega e recuperação de mensagens (ex.: um pedido de
-- history-sync que não voltou). Guarda só metadados — ver
-- src/lib/whatsapp/uazapi/webhook-log.ts. Sem texto de mensagem.
--
-- Acesso só pelo service role (o webhook grava com ele). Sem policy
-- para usuários: RLS ligado e nenhuma policy = ninguém lê pelo cliente.
-- ============================================================

CREATE TABLE IF NOT EXISTS webhook_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  channel_id         UUID REFERENCES whatsapp_channels(id) ON DELETE SET NULL,
  event_type         TEXT,
  message_id         TEXT,
  chat_id            TEXT,
  message_type       TEXT,
  message_timestamp  TIMESTAMPTZ,
  from_me            BOOLEAN,
  is_group           BOOLEAN,
  error              TEXT
);

CREATE INDEX IF NOT EXISTS webhook_events_received_at_idx
  ON webhook_events (received_at DESC);
CREATE INDEX IF NOT EXISTS webhook_events_message_id_idx
  ON webhook_events (message_id);

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
