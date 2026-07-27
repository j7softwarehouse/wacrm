-- ============================================================
-- 037_whatsapp_channels
--
-- Troca "uma config de WhatsApp por conta" por "N canais por conta".
--
-- Por que renomear em vez de só adicionar colunas: `whatsapp_config`
-- no singular afirma a premissa que estamos removendo. As constraints
-- e políticas RLS precisam ser reescritas de qualquer forma
-- (UNIQUE(account_id) cai), então o rename não acrescenta risco.
--
-- Idempotente — seguro re-executar.
-- ============================================================

-- ─── 1. Rename ──────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'whatsapp_config')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'whatsapp_channels')
  THEN
    ALTER TABLE whatsapp_config RENAME TO whatsapp_channels;
  END IF;
END $$;

-- ─── 2. Colunas novas ───────────────────────────────────────
ALTER TABLE whatsapp_channels
  ADD COLUMN IF NOT EXISTS provider           TEXT,
  ADD COLUMN IF NOT EXISTS label              TEXT,
  ADD COLUMN IF NOT EXISTS phone_e164         TEXT,
  ADD COLUMN IF NOT EXISTS last_error         TEXT,
  ADD COLUMN IF NOT EXISTS uazapi_base_url    TEXT,
  ADD COLUMN IF NOT EXISTS uazapi_token       TEXT,
  ADD COLUMN IF NOT EXISTS uazapi_instance_id TEXT,
  ADD COLUMN IF NOT EXISTS webhook_secret     TEXT;

-- Toda linha pré-existente é Meta por definição.
UPDATE whatsapp_channels SET provider = 'meta' WHERE provider IS NULL;
ALTER TABLE whatsapp_channels ALTER COLUMN provider SET NOT NULL;

-- `phone_number_id` e `access_token` eram NOT NULL: agora são nulos
-- em canais UAZAPI.
ALTER TABLE whatsapp_channels ALTER COLUMN phone_number_id DROP NOT NULL;
ALTER TABLE whatsapp_channels ALTER COLUMN access_token    DROP NOT NULL;

-- `status` ganha os estados de sessão da UAZAPI.
ALTER TABLE whatsapp_channels DROP CONSTRAINT IF EXISTS whatsapp_config_status_check;
ALTER TABLE whatsapp_channels DROP CONSTRAINT IF EXISTS whatsapp_channels_status_check;
ALTER TABLE whatsapp_channels
  ADD CONSTRAINT whatsapp_channels_status_check
  CHECK (status IN ('connected','disconnected','connecting','hibernated'));

-- ─── 3. Constraints ─────────────────────────────────────────

-- A mudança central: um canal deixa de ser único por conta.
ALTER TABLE whatsapp_channels DROP CONSTRAINT IF EXISTS whatsapp_config_account_id_key;
ALTER TABLE whatsapp_channels DROP CONSTRAINT IF EXISTS whatsapp_config_user_id_key;

-- UNIQUE(phone_number_id) passa a ser parcial: sem o WHERE, todos os
-- canais UAZAPI colidiriam em NULL. O raciocínio da 013 (um número
-- Meta por conta, para o webhook não ficar ambíguo) segue valendo.
ALTER TABLE whatsapp_channels DROP CONSTRAINT IF EXISTS whatsapp_config_phone_number_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_phone_number_id
  ON whatsapp_channels (phone_number_id)
  WHERE phone_number_id IS NOT NULL;

-- Duas contas não podem reivindicar a mesma instância UAZAPI, ou o
-- inbound fica ambíguo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_uazapi_instance
  ON whatsapp_channels (uazapi_base_url, uazapi_instance_id)
  WHERE uazapi_base_url IS NOT NULL AND uazapi_instance_id IS NOT NULL;

-- Chave de roteamento do webhook de entrada.
CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_webhook_secret
  ON whatsapp_channels (webhook_secret)
  WHERE webhook_secret IS NOT NULL;

-- Impede meia-configuração gravada no banco.
ALTER TABLE whatsapp_channels DROP CONSTRAINT IF EXISTS whatsapp_channels_provider_fields_check;
ALTER TABLE whatsapp_channels
  ADD CONSTRAINT whatsapp_channels_provider_fields_check
  CHECK (
    (provider = 'meta'   AND phone_number_id IS NOT NULL AND access_token IS NOT NULL)
    OR
    (provider = 'uazapi' AND uazapi_base_url IS NOT NULL AND uazapi_token IS NOT NULL)
  );

ALTER TABLE whatsapp_channels DROP CONSTRAINT IF EXISTS whatsapp_channels_provider_check;
ALTER TABLE whatsapp_channels
  ADD CONSTRAINT whatsapp_channels_provider_check
  CHECK (provider IN ('meta','uazapi'));

-- ─── 4. channel_id em conversations ─────────────────────────
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES whatsapp_channels(id) ON DELETE SET NULL;

-- Backfill: hoje existe no máximo um canal por conta, então a escolha
-- é determinística — não há ambiguidade a resolver.
UPDATE conversations c
SET channel_id = ch.id
FROM whatsapp_channels ch
WHERE ch.account_id = c.account_id
  AND c.channel_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_channel ON conversations(channel_id);

-- A UNIQUE da 036 passa a incluir o canal: o mesmo contato pode falar
-- com dois números da conta, e são conversas distintas.
--
-- NULLS NOT DISTINCT é obrigatório. Sem ele, conversas órfãs
-- (channel_id NULL, após remoção de um canal) voltariam a duplicar —
-- exatamente o bug #363 que a 036 corrigiu, já que num índice único
-- comum o Postgres trata cada NULL como distinto.
DROP INDEX IF EXISTS idx_conversations_account_contact;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_channel
  ON conversations (account_id, contact_id, channel_id) NULLS NOT DISTINCT;

-- ─── 5. channel_id em broadcasts ────────────────────────────
-- Nullable de propósito: uma conta que apagou sua config antes desta
-- migração tem broadcasts históricos sem canal resolvível, e um
-- SET NOT NULL abortaria a migração inteira. Obrigatoriedade para
-- novos disparos vive na aplicação.
ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES whatsapp_channels(id) ON DELETE SET NULL;

UPDATE broadcasts b
SET channel_id = ch.id
FROM whatsapp_channels ch
WHERE ch.account_id = b.account_id
  AND b.channel_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_broadcasts_channel ON broadcasts(channel_id);

-- ─── 6. RLS ─────────────────────────────────────────────────
-- Espelha o padrão da 017: membros leem, admins+ escrevem — via o
-- helper is_account_member(), o mesmo usado por toda política desde
-- a 017. `profiles.role` é legado/não usado para tenancy (ver 017,
-- linhas 31-32); a role real vive em `profiles.account_role`.
ALTER TABLE whatsapp_channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own config" ON whatsapp_channels;
DROP POLICY IF EXISTS "members read channels"       ON whatsapp_channels;
DROP POLICY IF EXISTS "admins write channels"       ON whatsapp_channels;

-- As quatro políticas granulares da 017 sobrevivem ao RENAME (ligadas
-- por OID, não por nome) e duplicariam a autorização abaixo — dropadas
-- para restar exatamente uma política de leitura e uma de escrita.
DROP POLICY IF EXISTS whatsapp_config_select ON whatsapp_channels;
DROP POLICY IF EXISTS whatsapp_config_insert ON whatsapp_channels;
DROP POLICY IF EXISTS whatsapp_config_update ON whatsapp_channels;
DROP POLICY IF EXISTS whatsapp_config_delete ON whatsapp_channels;

CREATE POLICY "members read channels" ON whatsapp_channels
  FOR SELECT USING (is_account_member(account_id));

CREATE POLICY "admins write channels" ON whatsapp_channels
  FOR ALL USING (is_account_member(account_id, 'admin'));
